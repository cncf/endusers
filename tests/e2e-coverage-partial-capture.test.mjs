// The e2e coverage reporter's tolerance for a partial capture.
//
// Playwright's `coverage.stopJSCoverage()` is a browser API reached over CDP
// in a fixture that runs per page (tests/tools/e2e-coverage.cjs). What it
// hands back is not guaranteed-shaped data: a page torn down mid-navigation
// contributes an entry with no `functions`, a script the browser knew about
// but never entered contributes a function with no `ranges`, and a worker
// that lost its context writes a `v8-coverage-error` artifact instead of a
// capture. `collectE2ECoverage()` is written to survive all three -- every
// read of those payloads goes through a `??` fallback -- and none of that was
// exercised.
//
// The distinction these tests pin is which of the three is fatal. A partial
// *capture* must not be: the artifacts are written per page by parallel
// workers, so one degenerate page would otherwise take down a run that
// measured every source file it was pointed at. A capture *error* must be,
// because it means a page's coverage is missing rather than empty, and
// scoring the run without it would report a percentage over a denominator
// that silently lost a page.
//
// The fallbacks are reachable only through collectE2ECoverage() -- none of
// the readers is exported -- so every case here is driven by writing the
// artifact a browser would have written and asking for the report.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectE2ECoverage } from './tools/e2e-coverage-report.mjs';
import {
  initCoverageRun,
  sealCoverageRun,
  writeCoverageArtifact,
} from './tools/e2e-coverage-run.mjs';

// One executable line, fully covered, so a run carrying it always has
// something attributable: the subject of each test is the *other* artifact
// beside it, and without this the run would fail on "No src/** coverage was
// attributable" before the assertion could say anything about the payload.
const SOURCE = "export const label = (on) => (on ? 'hit' : 'miss');\n";

async function fixtureRoot(runId) {
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-partial-'));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  await mkdir(join(buildDir, 'assets/js'), { recursive: true });
  await mkdir(join(root, 'src/components/Label'), { recursive: true });
  await initCoverageRun(runDir, runId, { project: 'chromium' });

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
      mappings: 'AAAA',
    }),
  );
  return { root, runDir, buildDir, scriptText };
}

function healthyEntry(scriptText) {
  return {
    url: 'http://localhost:3000/assets/js/app.js',
    scriptId: '1',
    functions: [
      {
        functionName: '',
        isBlockCoverage: true,
        ranges: [{ startOffset: 0, endOffset: scriptText.length, count: 1 }],
      },
    ],
  };
}

// Writes one artifact holding a healthy entry plus whatever degenerate
// entries the test is about, then renders the report.
async function reportWith(runId, degenerate) {
  const fixture = await fixtureRoot(runId);
  await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId,
    result: [healthyEntry(fixture.scriptText), ...degenerate],
  });
  await sealCoverageRun(fixture.runDir, 'passed');
  return {
    fixture,
    report: await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    }),
  };
}

test('a capture entry with no functions is counted and contributes nothing', async () => {
  const { report } = await reportWith('run-no-functions', [
    // A page torn down mid-navigation: the script is named, and the browser
    // had no execution record to hand back for it.
    { url: 'http://localhost:3000/assets/js/app.js', scriptId: '2' },
  ]);
  // Counted as captured and converted -- the entry was real data, just empty.
  // Dropping it from the counts would understate what the run looked at.
  assert.equal(report.scripts.captured, 2);
  assert.equal(report.summary.executableLines, 1);
  assert.equal(report.summary.coveredLines, 1);
});

test('a capture entry whose function carries no ranges is survived', async () => {
  const { report } = await reportWith('run-no-ranges', [
    {
      url: 'http://localhost:3000/assets/js/app.js',
      scriptId: '2',
      functions: [{ functionName: '', isBlockCoverage: true }],
    },
  ]);
  assert.equal(report.scripts.captured, 2);
  assert.equal(report.summary.executableLines, 1);
});

test('an artifact with no result array is counted as zero scripts', async () => {
  const fixture = await fixtureRoot('run-no-result');
  await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId: 'run-no-result',
    result: [healthyEntry(fixture.scriptText)],
  });
  // A second worker that captured nothing at all: `result` is absent rather
  // than empty, which is what a fixture that failed before stopJSCoverage()
  // leaves behind.
  await writeCoverageArtifact(fixture.runDir, 'worker-0-page-1', {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId: 'run-no-result',
  });
  await sealCoverageRun(fixture.runDir, 'passed');

  const report = await collectE2ECoverage(fixture.runDir, {
    root: fixture.root,
    buildDir: fixture.buildDir,
  });
  // The empty artifact adds nothing to the captured count and does not abort
  // the run: one worker's blank page must not discard another's measurements.
  assert.equal(report.scripts.captured, 1);
  assert.equal(report.summary.executableLines, 1);
});

// The capture-error artifact is the opposite contract: it is the one payload
// shape that must stop the report. These assert the message degrades field by
// field, because a worker that died before it could name the test is exactly
// the case where the operator has least to go on.
const ERROR_PAYLOAD_CASES = [
  [
    'every field present',
    {
      testId: 'specs/home.spec.js:12',
      pageIndex: 2,
      error: { message: 'Target page, context or browser has been closed' },
    },
    /coverage capture failed for specs\/home\.spec\.js:12 page 2: Target page, context or browser has been closed/,
  ],
  [
    'no error message',
    { testId: 'specs/home.spec.js:12', pageIndex: 2, error: {} },
    /failed for specs\/home\.spec\.js:12 page 2: unknown error/,
  ],
  [
    'no error object at all',
    { testId: 'specs/home.spec.js:12', pageIndex: 0 },
    /failed for specs\/home\.spec\.js:12 page 0: unknown error/,
  ],
  [
    'nothing but the kind',
    {},
    /failed for <unknown test> page <unknown>: unknown error/,
  ],
];

for (const [name, fields, expected] of ERROR_PAYLOAD_CASES) {
  test(`a capture-error artifact with ${name} fails the report`, async () => {
    const runId = `run-capture-error-${name.replace(/\s+/g, '-')}`;
    const fixture = await fixtureRoot(runId);
    // Beside a perfectly good capture: a page whose coverage is *missing*
    // cannot be averaged away by the pages that did report.
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId,
      result: [healthyEntry(fixture.scriptText)],
    });
    await writeFile(
      join(fixture.runDir, 'capture-error.json'),
      JSON.stringify({
        kind: 'endusers.playwright.v8-coverage-error',
        runId,
        ...fields,
      }),
    );
    await sealCoverageRun(fixture.runDir, 'passed');

    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      (error) => {
        assert.match(error.message, expected);
        // The run id and status ride along so the failure is traceable to the
        // run directory it came from.
        assert.equal(error.runId, runId);
        assert.equal(error.runStatus, 'passed');
        return true;
      },
    );
  });
}

// Multi-line bodies so an unexecuted function leaves whole lines uncovered
// rather than a sub-line region: the report's `uncoveredLines` list is what
// the text artifact prints, and it is only readable if it is ordered.
const MULTILINE_SOURCE = [
  'export function a() {',
  '  return 1;',
  '}',
  'export function b() {',
  '  return 2;',
  '}',
  'export function c() {',
  '  return 3;',
  '}',
  '',
].join('\n');

test('uncovered lines are reported in ascending order', async () => {
  const runId = 'run-uncovered-order';
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-partial-'));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  await mkdir(join(buildDir, 'assets/js'), { recursive: true });
  await mkdir(join(root, 'src/components/Multi'), { recursive: true });
  await initCoverageRun(runDir, runId, { project: 'chromium' });

  const scriptText = `${MULTILINE_SOURCE}\n//# sourceMappingURL=app.js.map\n`;
  await writeFile(
    join(root, 'src/components/Multi/index.js'),
    MULTILINE_SOURCE,
  );
  await writeFile(join(buildDir, 'assets/js/app.js'), scriptText);
  await writeFile(
    join(buildDir, 'assets/js/app.js.map'),
    JSON.stringify({
      version: 3,
      file: 'app.js',
      sources: ['webpack://endusers/./src/components/Multi/index.js'],
      sourcesContent: [MULTILINE_SOURCE],
      names: [],
      // Identity over all nine lines, so an uncovered body lands on the
      // original line it came from.
      mappings: ['AAAA', ...Array(8).fill('AACA')].join(';'),
    }),
  );

  // `a` ran; `b` and `c` were never entered, which is two separate runs of
  // uncovered lines rather than one.
  const bBody = '{\n  return 2;\n}';
  const cBody = '{\n  return 3;\n}';
  const bStart = MULTILINE_SOURCE.indexOf(bBody);
  const cStart = MULTILINE_SOURCE.indexOf(cBody);
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
                startOffset: bStart,
                endOffset: bStart + bBody.length,
                count: 0,
              },
              {
                startOffset: cStart,
                endOffset: cStart + cBody.length,
                count: 0,
              },
            ],
          },
        ],
      },
    ],
  });
  await sealCoverageRun(runDir, 'passed');

  const report = await collectE2ECoverage(runDir, { root, buildDir });
  const [row] = report.sources;
  assert.equal(row.file, 'src/components/Multi/index.js');
  assert.deepEqual(row.uncoveredLines, [4, 5, 7, 8]);
  // Numeric, not lexicographic: a default sort would put 10 before 4 and the
  // list would be unusable on any file long enough to matter.
  assert.deepEqual(
    [...row.uncoveredLines].sort((a, b) => a - b),
    row.uncoveredLines,
  );
  assert.equal(row.executableLines, 9);
  assert.equal(row.coveredLines, 5);
});
