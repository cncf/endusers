// Unit coverage for the fold that makes the e2e region count mean anything:
// `getRegionCoverage` (tests/tools/e2e-coverage-report.mjs:344-365) keys a
// region on its original `line:startColumn:endLine:endColumn` and keeps the
// higher of two counts recorded against the same key.
//
//   const count = counts?.[index] ?? 0;
//   const existing = regions.get(key);
//   if (!existing || count > existing.count) {
//     regions.set(key, { line, endLine, count });
//   }
//
// Two branch locations sharing one key is not a corner case, it is what the
// pipeline produces for every file it measures. `normalizeRanges` rewrites a
// V8 record into a flat, non-overlapping run of ranges, so an inner zero-count
// range in the middle of a line splits that line into an uncovered range and a
// covered remainder. Both halves map back through the source map to the same
// original span -- the generated columns they start at carry no mapping of
// their own, so each resolves to the mapping that precedes it -- and
// v8-to-istanbul emits one branch per half. Keyed by branch id they would be
// two regions, one of them permanently zero; keyed by coordinates they are one
// region that the covered half carries.
//
// `collectE2ECoverage unions the two builds of one source file` in
// tests/e2e-coverage-report.test.mjs pins the union across *scripts*, but
// every region in that fixture lands on a key only one build emits, so the
// `count > existing.count` arm inside `getRegionCoverage` is never taken --
// `npm run test:unit:coverage` names line 360 among the uncovered regions of
// tests/tools/e2e-coverage-report.mjs on `main`, with the file at 92.89%.
//
// This file is separate from tests/e2e-coverage-report.test.mjs so the two
// bodies of work stay independent, the same way tests/e2e-coverage-run.test.mjs
// and tests/e2e-coverage-scripts.test.mjs are separate from it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectE2ECoverage } from './tools/e2e-coverage-report.mjs';
import {
  initCoverageRun,
  sealCoverageRun,
  writeCoverageArtifact,
} from './tools/e2e-coverage-run.mjs';

// One identity mapping per generated line, both at column 0: 'AAAA' is
// [generatedColumn 0, source 0, originalLine 0, originalColumn 0] and 'AACA'
// advances the original line by one with every other field unchanged. Spelled
// out rather than encoded by a helper so the fixture states exactly which
// coordinates the halves of line 2 collapse onto: there is no mapping at any
// column inside a line, which is why both halves resolve to the same span.
const IDENTITY_MAPPINGS = 'AAAA;AACA';

const SOURCE = 'const always = 1;\nconst split = 2;\n';
const SCRIPT_TEXT = `${SOURCE}\n//# sourceMappingURL=app.js.map\n`;
const SOURCE_PATH = 'src/components/Example/index.js';

// An inner zero-count range that stops short of the end of line 2, so the
// remainder of that line is a separate covered range rather than running to
// the end of the script. Those two ranges are the two same-key branches.
const SPLIT_START = SOURCE.indexOf('const split');
const SPLIT_END = SPLIT_START + 'const split'.length;

const BUILDS = [
  { dir: 'assets/js', path: '/assets/js' },
  {
    dir: 'e2e-coverage-variant/assets/js',
    path: '/e2e-coverage-variant/assets/js',
  },
];

async function fixtureRun(builds) {
  const root = await mkdtemp(join(tmpdir(), 'endusers-region-union-'));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  await mkdir(join(root, 'src/components/Example'), { recursive: true });
  await writeFile(join(root, SOURCE_PATH), SOURCE);
  for (const build of builds) {
    await mkdir(join(buildDir, build.dir), { recursive: true });
    await writeFile(join(buildDir, build.dir, 'app.js'), SCRIPT_TEXT);
    await writeFile(
      join(buildDir, build.dir, 'app.js.map'),
      JSON.stringify({
        version: 3,
        file: 'app.js',
        sources: [`webpack://endusers/./${SOURCE_PATH}`],
        sourcesContent: [SOURCE],
        names: [],
        mappings: IDENTITY_MAPPINGS,
      }),
    );
  }
  await initCoverageRun(runDir, 'run-1', { project: 'chromium' });
  return { root, runDir, buildDir };
}

async function writeBuildCoverage(runDir, artifactName, build) {
  await writeCoverageArtifact(runDir, artifactName, {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId: 'run-1',
    result: [
      {
        url: `http://localhost:3000${build.path}/app.js`,
        scriptId: '1',
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [
              { startOffset: 0, endOffset: SCRIPT_TEXT.length, count: 1 },
              { startOffset: SPLIT_START, endOffset: SPLIT_END, count: 0 },
            ],
          },
        ],
      },
    ],
  });
}

// Line 1's range and line 2's two halves, with the halves folded onto one
// key. Keyed by branch id instead, line 2 would contribute two regions and
// the report would read 3 regions / 2 covered / 66.67% and name line 2.
const EXPECTED = {
  file: SOURCE_PATH,
  executableLines: 2,
  coveredLines: 2,
  linePercent: 100,
  uncoveredLines: [],
  regions: 2,
  coveredRegions: 2,
  regionPercent: 100,
  uncoveredRegions: [],
};

async function reportFor(fixture) {
  const report = await collectE2ECoverage(fixture.runDir, {
    root: fixture.root,
    buildDir: fixture.buildDir,
  });
  assert.equal(report.status, 'ok');
  return report;
}

test('two branch locations on one original span fold to a single covered region', async () => {
  const fixture = await fixtureRun([BUILDS[0]]);
  try {
    await writeBuildCoverage(fixture.runDir, 'worker-0-page-0', BUILDS[0]);
    await sealCoverageRun(fixture.runDir, 'passed');

    const report = await reportFor(fixture);
    assert.deepEqual(report.sources, [EXPECTED]);
    // Stated against the summary as well, because the merge gate reads that
    // and not the per-file rows.
    assert.equal(report.summary.regions, 2);
    assert.equal(report.summary.coveredRegions, 2);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('the same file measured by both builds folds rather than doubling', async () => {
  const fixture = await fixtureRun(BUILDS);
  try {
    for (const [index, build] of BUILDS.entries()) {
      await writeBuildCoverage(fixture.runDir, `worker-0-page-${index}`, build);
    }
    await sealCoverageRun(fixture.runDir, 'passed');

    const report = await reportFor(fixture);
    // The real build and the data-variant build compile the same source, so
    // the second script contributes the same two keys the first did. Counted
    // per script rather than per coordinate, this would read 4 regions.
    assert.deepEqual(report.sources, [EXPECTED]);
    assert.equal(report.scripts.converted, 2);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
