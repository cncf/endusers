// `--check-source` scores lines, and a line counts as covered when anything on
// it ran. A ternary arm, a `??` fallback or a short-circuit that the browser
// never reached therefore scores as covered whenever the rest of its line did,
// which is exactly the blind spot the unit reporter closes with its region
// columns and `--check-source-regions` gate (see summarizeRegions in
// tests/tools/coverage-report.mjs).
//
// The e2e reporter already converts V8 ranges through v8-to-istanbul, whose
// istanbul object carries every statement and branch as a located entry with
// its own count, so the data was there and only the scoring was missing. These
// tests pin the case that motivates the whole feature: a file at 100.00% lines
// whose region score is 75.00%, caught by a gate that line coverage waves
// through.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectE2ECoverage,
  main,
  renderE2ECoverageReport,
} from './tools/e2e-coverage-report.mjs';
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

// Generated line 1 is byte-for-byte the original line 1, so the map is the
// identity over the columns a segment is needed at. Column granularity is the
// point: a map that only pins column 0 would collapse the uncovered arm onto
// the start of the line, which is the very blur these tests exist to detect.
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

// Every executable line runs, so line coverage is 100%. The `else` arm of the
// ternary on line 1 never does, and it shares that line with code that did.
const SOURCE = "export const label = (on) => (on ? 'hit' : 'miss');\n";
const UNCOVERED = "'miss'";

async function subLineGapRun(
  runId = 'run-regions',
  { secondPage = null } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-regions-'));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  await mkdir(join(buildDir, 'assets/js'), { recursive: true });
  await mkdir(join(root, 'src/components/Label'), { recursive: true });
  await initCoverageRun(runDir, runId, { project: 'chromium' });

  const start = SOURCE.indexOf(UNCOVERED);
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
      mappings: identityMappings([0, start, start + UNCOVERED.length]),
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
                startOffset: start,
                endOffset: start + UNCOVERED.length,
                count: 0,
              },
            ],
          },
        ],
      },
    ],
  });
  if (secondPage) {
    // 'covered' reaches the arm the first page missed; 'missed' agrees with it.
    const ranges = [{ startOffset: 0, endOffset: scriptText.length, count: 1 }];
    if (secondPage === 'missed') {
      ranges.push({
        startOffset: start,
        endOffset: start + UNCOVERED.length,
        count: 0,
      });
    }
    await writeCoverageArtifact(runDir, 'worker-0-page-1', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId,
      result: [
        {
          url: 'http://localhost:3000/assets/js/app.js',
          scriptId: '1',
          functions: [{ functionName: '', isBlockCoverage: true, ranges }],
        },
      ],
    });
  }
  await sealCoverageRun(runDir, 'passed');
  return { root, runDir, buildDir };
}

function reportArgs(fixture, extra = []) {
  return [
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
    ...extra,
  ];
}

test('a sub-line gap scores 100% lines and less than 100% regions', async () => {
  const fixture = await subLineGapRun();
  try {
    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.deepEqual(report.sources, [
      {
        file: 'src/components/Label/index.js',
        executableLines: 1,
        coveredLines: 1,
        linePercent: 100,
        uncoveredLines: [],
        regions: 4,
        coveredRegions: 3,
        regionPercent: 75,
        uncoveredRegions: [1],
      },
    ]);
    assert.deepEqual(report.summary, {
      executableLines: 1,
      coveredLines: 1,
      linePercent: 100,
      regions: 4,
      coveredRegions: 3,
      regionPercent: 75,
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('the rendered report names the uncovered region the line column hides', async () => {
  const fixture = await subLineGapRun();
  try {
    const text = renderE2ECoverageReport(
      await collectE2ECoverage(fixture.runDir, {
        root: fixture.root,
        buildDir: fixture.buildDir,
      }),
    );
    assert.match(
      text,
      /file \| line % \| region % \| uncovered lines \| uncovered regions/,
    );
    assert.match(
      text,
      /src\/components\/Label\/index\.js \| 100\.00 \| 75\.00 \|\s+\| 1/,
    );
    assert.match(
      text,
      /src files \| 100\.00 \| 75\.00 \| 1\/1 lines \| 3\/4 regions/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('--check-source-regions fails the sub-line gap --check-source waves through', async () => {
  const fixture = await subLineGapRun();
  try {
    // The same run, gated only on lines, is green at the strictest floor there
    // is: without the region gate the gap cannot be caught.
    await main(reportArgs(fixture, ['--check-source', '100']));
    await assert.rejects(
      main(reportArgs(fixture, ['--check-source-regions', '100'])),
      /Source region coverage 75\.00% is below the required 100%\./,
    );
    // The artifacts outlive the gate, exactly as they do for --check-source:
    // the CI step that publishes the summary runs after the threshold fails.
    const json = JSON.parse(
      await readFile(join(fixture.root, 'report.json'), 'utf8'),
    );
    assert.equal(json.status, 'ok');
    assert.equal(json.summary.regionPercent, 75);
    assert.match(
      await readFile(join(fixture.root, 'report.txt'), 'utf8'),
      /3\/4 regions/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('--check-source-regions passes at the floor and is off when omitted', async () => {
  const fixture = await subLineGapRun();
  try {
    const gated = await main(
      reportArgs(fixture, ['--check-source-regions', '75']),
    );
    assert.equal(gated.summary.regionPercent, 75);
    const ungated = await main(reportArgs(fixture));
    assert.equal(ungated.summary.regionPercent, 75);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('--check-source-regions rejects thresholds that are not a percentage', async () => {
  const fixture = await subLineGapRun();
  try {
    for (const value of ['', ' ', 'ninety', '-1', '101']) {
      await assert.rejects(
        main(reportArgs(fixture, ['--check-source-regions', value])),
        /--check-source-regions expects a percentage between 0 and 100/,
      );
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('region counts union across the artifacts that observed one file', async () => {
  const fixture = await subLineGapRun('run-regions-union', {
    secondPage: 'covered',
  });
  try {
    // Regions union the same way lines do, so a gap one page left behind is
    // closed by another page that reached it rather than scored twice.
    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.equal(report.summary.coveredRegions, report.summary.regions);
    assert.equal(report.summary.regionPercent, 100);
    assert.deepEqual(report.sources[0].uncoveredRegions, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('a region every page missed stays uncovered across the whole run', async () => {
  const fixture = await subLineGapRun('run-regions-agreed', {
    secondPage: 'missed',
  });
  try {
    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.deepEqual(report.sources[0].uncoveredRegions, [1]);
    assert.ok(report.summary.regionPercent < 100);
    assert.deepEqual(report.sources[0].uncoveredLines, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
