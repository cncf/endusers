// The e2e-coverage CI job renders a report and publishes it, but nothing has
// ever compared that report against a floor -- `npm run test:unit:coverage`
// gets `--check`/`--check-source`, while `npm run report:e2e:coverage` had no
// threshold flag at all. Browser coverage of src/** could therefore fall from
// 100% to nothing without any step turning red.
//
// `--check-source` closes that. The ordering is the part worth pinning: the
// threshold is evaluated after the JSON and text artifacts are on disk, so a
// failing gate still leaves the summary behind for the step that publishes it
// to the job summary. A gate that destroyed the evidence explaining why it
// failed would be worse than no gate.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from './tools/e2e-coverage-report.mjs';
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

function mapLines(entries) {
  let previousSource = 0;
  let previousLine = 0;
  return entries
    .map(([sourceIndex, originalLine]) => {
      const segment = [
        vlq(0),
        vlq(sourceIndex - previousSource),
        vlq(originalLine - previousLine),
        vlq(0),
      ].join('');
      previousSource = sourceIndex;
      previousLine = originalLine;
      return segment;
    })
    .join(';');
}

// One src file, two executable lines, the second never executed: a report whose
// summary lands on exactly 50.00%.
async function halfCoveredRun() {
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-threshold-'));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  await mkdir(join(buildDir, 'assets/js'), { recursive: true });
  await mkdir(join(root, 'src/components/Example'), { recursive: true });
  await initCoverageRun(runDir, 'run-threshold', { project: 'chromium' });

  const source = 'const hit = 1;\nconst miss = 2;\n';
  const scriptText = `${source}\n//# sourceMappingURL=app.js.map\n`;
  await writeFile(join(root, 'src/components/Example/index.js'), source);
  await writeFile(join(buildDir, 'assets/js/app.js'), scriptText);
  await writeFile(
    join(buildDir, 'assets/js/app.js.map'),
    JSON.stringify({
      version: 3,
      file: 'app.js',
      sources: ['webpack://endusers/./src/components/Example/index.js'],
      sourcesContent: [source],
      names: [],
      mappings: mapLines([
        [0, 0],
        [0, 1],
      ]),
    }),
  );
  await writeCoverageArtifact(runDir, 'worker-0-page-0', {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId: 'run-threshold',
    result: [
      {
        url: 'http://localhost:3000/assets/js/app.js',
        scriptId: '1',
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [
              {
                startOffset: source.indexOf('const miss'),
                endOffset: scriptText.length,
                count: 0,
              },
              { startOffset: 0, endOffset: scriptText.length, count: 1 },
            ],
          },
        ],
      },
    ],
  });
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

test('--check-source fails a report below the floor and keeps the artifacts', async () => {
  const fixture = await halfCoveredRun();
  try {
    await assert.rejects(
      () => main(reportArgs(fixture, ['--check-source', '100'])),
      /Source line coverage 50\.00% is below the required 100%\./,
    );

    // The gate must not cost the operator the report that explains it.
    const json = JSON.parse(
      await readFile(join(fixture.root, 'report.json'), 'utf8'),
    );
    assert.equal(json.status, 'ok');
    assert.equal(json.summary.linePercent, 50);
    assert.match(
      await readFile(join(fixture.root, 'report.txt'), 'utf8'),
      /src\/components\/Example\/index\.js \| 50\.00 \| 50\.00 \| 2 \| 2/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// The halfCoveredRun V8 block ranges convert to two branch regions, one per
// line, so the same fixture lands on exactly 50.00% regions as well.
test('--check-source-regions fails a report below the floor and keeps the artifacts', async () => {
  const fixture = await halfCoveredRun();
  try {
    await assert.rejects(
      () => main(reportArgs(fixture, ['--check-source-regions', '100'])),
      /Source region coverage 50\.00% is below the required 100%\./,
    );

    // The gate must not cost the operator the report that explains it.
    const json = JSON.parse(
      await readFile(join(fixture.root, 'report.json'), 'utf8'),
    );
    assert.equal(json.status, 'ok');
    assert.equal(json.summary.regionPercent, 50);
    assert.deepEqual(json.sources[0].uncoveredRegions, [2]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('--check-source-regions passes when coverage exactly meets the floor', async () => {
  const fixture = await halfCoveredRun();
  try {
    const report = await main(
      reportArgs(fixture, ['--check-source-regions', '50']),
    );
    assert.equal(report.status, 'ok');
    assert.equal(report.summary.regionPercent, 50);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// A silently-ignored bad threshold is the failure mode that matters here: it
// would read as a gate in the workflow while enforcing nothing.
test('--check-source-regions rejects thresholds that are not a percentage', async () => {
  for (const value of ['', 'ninety', '-1', '101']) {
    await assert.rejects(
      () => main(['--input', 'unused', '--check-source-regions', value]),
      /--check-source-regions expects a percentage between 0 and 100/,
    );
  }
});

test('--check-source passes when coverage exactly meets the floor', async () => {
  const fixture = await halfCoveredRun();
  try {
    const report = await main(reportArgs(fixture, ['--check-source', '50']));
    assert.equal(report.status, 'ok');
    assert.equal(report.summary.linePercent, 50);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('omitting --check-source leaves the reporter ungated', async () => {
  const fixture = await halfCoveredRun();
  try {
    const report = await main(reportArgs(fixture));
    assert.equal(report.summary.linePercent, 50);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// A silently-ignored bad threshold is the failure mode that matters here: it
// would read as a gate in the workflow while enforcing nothing.
test('--check-source rejects thresholds that are not a percentage', async () => {
  for (const value of ['', '  ', 'ninety', '-1', '101', 'NaN', 'Infinity']) {
    await assert.rejects(
      () => main(['--input', 'coverage', '--check-source', value]),
      /--check-source expects a percentage between 0 and 100/,
      `expected ${JSON.stringify(value)} to be rejected`,
    );
  }
  // The flag given as the final argument has no value to consume at all.
  await assert.rejects(
    () => main(['--input', 'coverage', '--check-source']),
    /--check-source expects a percentage between 0 and 100/,
  );
});

// The percentage above is a ratio over the files the run observed. A src
// module the bundle drops -- or that attribution loses -- contributes neither
// numerator nor denominator, so `--check-source 100` keeps passing while a
// whole file goes unmeasured (#992). `--require-source-files` is the file-set
// guarantee: every module on disk under the root's src/ must appear in the
// run, and the report records the gap either way.
test('the report lists a src file on disk the run never measured', async () => {
  const fixture = await halfCoveredRun();
  try {
    await writeFile(
      join(fixture.root, 'src/components/Example/orphan.js'),
      'export const never = 1;\n',
    );
    const report = await main(reportArgs(fixture));
    assert.deepEqual(report.missingSourceFiles, [
      'src/components/Example/orphan.js',
    ]);
    assert.match(
      await readFile(join(fixture.root, 'report.txt'), 'utf8'),
      /Source files never measured by this run:\n- src\/components\/Example\/orphan\.js/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('--require-source-files fails on the gap and keeps the artifacts', async () => {
  const fixture = await halfCoveredRun();
  try {
    await writeFile(
      join(fixture.root, 'src/components/Example/orphan.js'),
      'export const never = 1;\n',
    );
    await assert.rejects(
      () => main(reportArgs(fixture, ['--require-source-files'])),
      /--require-source-files was requested, but the run never measured:\n\s+src\/components\/Example\/orphan\.js/,
    );

    // The gate must not cost the operator the report that explains it.
    const json = JSON.parse(
      await readFile(join(fixture.root, 'report.json'), 'utf8'),
    );
    assert.deepEqual(json.missingSourceFiles, [
      'src/components/Example/orphan.js',
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('--require-source-files passes when every src module was measured', async () => {
  const fixture = await halfCoveredRun();
  try {
    const report = await main(reportArgs(fixture, ['--require-source-files']));
    assert.deepEqual(report.missingSourceFiles, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
