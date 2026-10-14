// Pins that the per-file `uncoveredRegions` list names one entry per
// uncovered region rather than one per distinct line.
//
// V8 routinely splits a single source line into several ranges, so one line
// can hold more than one zero. The list used to be deduplicated by line while
// `regions - coveredRegions` kept counting every zero, which made the report
// disagree with itself: at main eff33b5 the e2e-coverage job's summary
// reported 18 uncovered regions across `src/**` while the per-file lists named
// only 17 lines, because src/components/GroupLinkStatus/index.js scored 15/18
// and listed lines 23 and 33 -- two entries for three zeros. The third was
// unreachable from the report, and the e2e gate's prose had to carry the
// missing multiplicity by hand as "GroupLinkStatus:33 (x2)"
// (tests/e2e-coverage-gate.test.mjs).
//
// That matters because the list is the report's only guidance about *where*
// to aim a test. A contributor closing every line the list names would have
// left the file short of its region score with nothing to explain the
// remainder, and `--check-source-file-regions` scores the counts rather than
// the list, so the gate would have stayed red without naming the cause.
//
// The invariant asserted here is the one anyone reading the two numbers
// together assumes: `uncoveredRegions.length === regions - coveredRegions`.
// The fixture is the smallest shape that can break it -- one line carrying two
// ternaries whose else arms both go unexercised -- and the companion
// assertions keep it honest, since a list that merely repeated a line would
// satisfy the length check on its own.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectE2ECoverage, main } from './tools/e2e-coverage-report.mjs';
import {
  initCoverageRun,
  sealCoverageRun,
  writeCoverageArtifact,
} from './tools/e2e-coverage-run.mjs';

const VLQ_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(value) {
  let encoded = value < 0 ? (-value << 1) | 1 : value << 1;
  let output = '';
  do {
    let digit = encoded & 31;
    encoded >>>= 5;
    if (encoded > 0) digit |= 32;
    output += VLQ_CHARS[digit];
  } while (encoded > 0);
  return output;
}

// Generated line 1 is byte-for-byte the original, so the map is the identity
// over the columns a segment is needed at. Column granularity is the point: a
// map that only pinned column 0 would collapse both arms onto the start of the
// line and the two zeros would be indistinguishable for the wrong reason.
function identityMappings(columns) {
  let previousColumn = 0;
  return columns
    .map((column, index) => {
      const delta = column - previousColumn;
      previousColumn = column;
      return [
        vlq(index === 0 ? column : delta),
        vlq(0),
        vlq(0),
        vlq(index === 0 ? column : delta),
      ].join('');
    })
    .join(',');
}

// Both ternaries are on line 1 and both else arms are missed, so the file has
// two uncovered regions that share a line while every executable line runs.
const SOURCE =
  "export const label = (a, b) => (a ? 'hit' : 'miss') + (b ? 'yes' : 'skip');\n";
const FIRST_GAP = "'miss'";
const SECOND_GAP = "'skip'";

async function twoGapsOnOneLineRun(runId = 'run-region-multiplicity') {
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-multiplicity-'));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  await mkdir(join(buildDir, 'assets/js'), { recursive: true });
  await mkdir(join(root, 'src/components/Label'), { recursive: true });
  await initCoverageRun(runDir, runId, { project: 'chromium' });

  const firstStart = SOURCE.indexOf(FIRST_GAP);
  const secondStart = SOURCE.indexOf(SECOND_GAP);
  assert.ok(firstStart > 0 && secondStart > firstStart);

  const scriptText = `${SOURCE}\n//# sourceMappingURL=app.js.map\n`;
  await writeFile(join(root, 'src/components/Label/index.js'), SOURCE);
  await writeFile(join(buildDir, 'assets/js/app.js'), scriptText);
  await writeFile(
    join(buildDir, 'assets/js/app.js.map'),
    JSON.stringify({
      version: 3,
      file: 'app.js',
      sources: ['webpack://endusers/./src/components/Label/index.js'],
      sourcesContent: [SOURCE],
      names: [],
      mappings: identityMappings([
        0,
        firstStart,
        firstStart + FIRST_GAP.length,
        secondStart,
        secondStart + SECOND_GAP.length,
      ]),
    }),
  );

  await writeCoverageArtifact(runDir, 'worker-0-page-0', {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId,
    result: [
      {
        url: 'http://localhost:3000/assets/js/app.js',
        scriptId: '1',
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [
              { startOffset: 0, endOffset: scriptText.length, count: 1 },
              {
                startOffset: firstStart,
                endOffset: firstStart + FIRST_GAP.length,
                count: 0,
              },
              {
                startOffset: secondStart,
                endOffset: secondStart + SECOND_GAP.length,
                count: 0,
              },
            ],
          },
        ],
      },
    ],
  });
  await sealCoverageRun(runDir, 'passed');
  return { root, runDir, buildDir };
}

test('two uncovered regions on one line are both listed', async () => {
  const fixture = await twoGapsOnOneLineRun();
  try {
    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    const [entry] = report.sources;
    assert.equal(entry.file, 'src/components/Label/index.js');

    // The shape the fixture exists to produce: two zeros, one line. Stated
    // before the invariant so a fixture that stopped producing two gaps fails
    // here rather than passing the length check trivially.
    assert.equal(entry.regions - entry.coveredRegions, 2);
    assert.deepEqual(entry.uncoveredRegions, [1, 1]);

    // Line coverage cannot see either gap, which is why the region list is
    // the only guidance a contributor has.
    assert.equal(entry.linePercent, 100);
    assert.deepEqual(entry.uncoveredLines, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('the uncovered region list accounts for every uncovered region', async () => {
  const fixture = await twoGapsOnOneLineRun('run-region-multiplicity-sum');
  try {
    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });

    // The invariant, asserted per file and in aggregate: the report's own two
    // numbers agree. This is what the de-duplicated list broke in production.
    let listed = 0;
    for (const source of report.sources) {
      assert.equal(
        source.uncoveredRegions.length,
        source.regions - source.coveredRegions,
        source.file,
      );
      listed += source.uncoveredRegions.length;
    }
    assert.equal(
      listed,
      report.summary.regions - report.summary.coveredRegions,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('the rendered report names both gaps on the shared line', async () => {
  const fixture = await twoGapsOnOneLineRun('run-region-multiplicity-text');
  try {
    await main([
      '--input',
      fixture.runDir,
      '--root',
      fixture.root,
      '--build',
      fixture.buildDir,
      '--json',
      join(fixture.root, 'report.json'),
      '--text',
      join(fixture.root, 'report.txt'),
    ]);
    const text = await readFile(join(fixture.root, 'report.txt'), 'utf8');
    const row = text
      .split('\n')
      .find((line) => line.startsWith('src/components/Label/index.js'));
    assert.ok(row, 'the report names the file');
    // The text report is what the job publishes to the step summary, so the
    // multiplicity has to survive rendering and not only the JSON.
    assert.match(row, /\|\s*1 1\s*$/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
