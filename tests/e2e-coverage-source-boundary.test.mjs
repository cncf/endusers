// A bundle carries many `src/**` modules in one script, and `normalizeRanges`
// (tests/tools/e2e-coverage-report.mjs) rewrites a V8 record into the coarsest
// partition it can: one range per run of equal counts, however far that run
// reaches. A page that executes an uninterrupted stretch of the bundle
// therefore produces a single range whose start lies in one original module
// and whose end lies in another.
//
// v8-to-istanbul cannot place such a range. `offsetToOriginalRelative`
// (v8-to-istanbul lib/source.js) maps the range's start and end back through
// the source map and abandons the range outright when they disagree:
//
//   if (start.source !== end.source) {
//     return {}
//   }
//
// `applyCoverage` then returns before recording a branch, so neither module is
// credited. Because `convertScript` builds `attributedPaths` from exactly the
// branches and functions that were recorded, the multi-source guard in
// `collectE2ECoverage`
//
//   if (converted.sourceFiles.length > 1 && !converted.attributedPaths.has(path))
//
// goes on to skip *every* source of that script. Coverage that a browser
// genuinely executed is dropped on the floor, which is what made fixture pages
// and variant builds added to reach a rare arm buy nothing measurable (#1236).
//
// These tests pin the two halves of the contract: a range that spans a source
// boundary credits both modules, and a 1:1 bundle -- which has no boundaries to
// cut at -- is left exactly as it was.
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

const ALPHA = 'const alpha = 1;\nconst alphaRare = 2;\n';
const BETA = 'const beta = 1;\nconst betaRare = 2;\n';
const ALPHA_PATH = 'src/components/Alpha/index.js';
const BETA_PATH = 'src/components/Beta/index.js';

// One identity mapping per generated line, each at column 0. 'AAAA' is
// [generatedColumn 0, source 0, originalLine 0, originalColumn 0]; 'AACA'
// advances the original line by one; 'ACDA' advances the source index by one
// and rewinds the original line to zero. Generated lines 1-2 are Alpha's two
// lines and generated lines 3-4 are Beta's, so the only source boundary in the
// script is the start of generated line 3.
const TWO_SOURCE_MAPPINGS = 'AAAA;AACA;ACDA;AACA';
const ONE_SOURCE_MAPPINGS = 'AAAA;AACA';

async function fixture({ sources, mappings, generated }) {
  const root = await mkdtemp(join(tmpdir(), 'endusers-source-boundary-'));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  for (const source of sources) {
    await mkdir(join(root, source.path, '..'), { recursive: true });
    await writeFile(join(root, source.path), source.text);
  }
  const script = `${generated}\n//# sourceMappingURL=app.js.map\n`;
  await mkdir(join(buildDir, 'assets/js'), { recursive: true });
  await writeFile(join(buildDir, 'assets/js/app.js'), script);
  await writeFile(
    join(buildDir, 'assets/js/app.js.map'),
    JSON.stringify({
      version: 3,
      file: 'app.js',
      sources: sources.map((source) => `webpack://endusers/./${source.path}`),
      sourcesContent: sources.map((source) => source.text),
      names: [],
      mappings,
    }),
  );
  await initCoverageRun(runDir, 'run-1', { project: 'chromium' });
  return { root, runDir, buildDir, script };
}

async function writeWholeScriptHit(runDir, script) {
  await writeCoverageArtifact(runDir, 'capture-0', {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId: 'run-1',
    result: [
      {
        url: 'http://localhost:3000/assets/js/app.js',
        scriptId: '1',
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: script.length, count: 1 }],
          },
        ],
      },
    ],
  });
}

test('a run spanning a source boundary credits both original modules', async () => {
  const context = await fixture({
    sources: [
      { path: ALPHA_PATH, text: ALPHA },
      { path: BETA_PATH, text: BETA },
    ],
    mappings: TWO_SOURCE_MAPPINGS,
    generated: ALPHA + BETA,
  });
  await writeWholeScriptHit(context.runDir, context.script);
  await sealCoverageRun(context.runDir, 'passed');

  const report = await collectE2ECoverage(context.runDir, {
    root: context.root,
    buildDir: context.buildDir,
  });

  // Before the split this call threw `No src/** coverage was attributable`:
  // the one range covering the whole script was discarded, so neither module
  // reached `report.sources` at all.
  assert.deepEqual(report.sources.map((source) => source.file).sort(), [
    ALPHA_PATH,
    BETA_PATH,
  ]);
  for (const source of report.sources) {
    assert.equal(source.linePercent, 100, source.file);
    assert.equal(source.regionPercent, 100, source.file);
    assert.deepEqual(source.uncoveredRegions, [], source.file);
  }
});

test('a single-source bundle has no boundary to cut at and is unchanged', async () => {
  const context = await fixture({
    sources: [{ path: ALPHA_PATH, text: ALPHA }],
    mappings: ONE_SOURCE_MAPPINGS,
    generated: ALPHA,
  });
  await writeWholeScriptHit(context.runDir, context.script);
  await sealCoverageRun(context.runDir, 'passed');

  const report = await collectE2ECoverage(context.runDir, {
    root: context.root,
    buildDir: context.buildDir,
  });

  assert.equal(report.sources.length, 1);
  const [source] = report.sources;
  assert.equal(source.file, ALPHA_PATH);
  assert.equal(source.executableLines, 2);
  assert.equal(source.coveredLines, 2);
  // One range in, one region out: the split must not fragment a script that
  // maps to a single original file.
  assert.equal(source.regions, 1);
  assert.equal(source.coveredRegions, 1);
});

test('a zero-count run spanning a boundary is charged to both modules', async () => {
  const context = await fixture({
    sources: [
      { path: ALPHA_PATH, text: ALPHA },
      { path: BETA_PATH, text: BETA },
    ],
    mappings: TWO_SOURCE_MAPPINGS,
    generated: ALPHA + BETA,
  });
  // Line 2 of Alpha through line 1 of Beta never ran: one contiguous
  // zero-count run across the boundary, bracketed by executed code so the
  // surrounding ranges exist too.
  const zeroStart = ALPHA.indexOf('const alphaRare');
  const zeroEnd = ALPHA.length + BETA.indexOf('const betaRare');
  await writeCoverageArtifact(context.runDir, 'capture-0', {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId: 'run-1',
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
                startOffset: 0,
                endOffset: context.script.length,
                count: 1,
              },
              { startOffset: zeroStart, endOffset: zeroEnd, count: 0 },
            ],
          },
        ],
      },
    ],
  });
  await sealCoverageRun(context.runDir, 'passed');

  const report = await collectE2ECoverage(context.runDir, {
    root: context.root,
    buildDir: context.buildDir,
  });

  const byFile = new Map(report.sources.map((source) => [source.file, source]));
  assert.deepEqual([...byFile.keys()].sort(), [ALPHA_PATH, BETA_PATH]);
  assert.deepEqual(byFile.get(ALPHA_PATH).uncoveredLines, [2]);
  assert.deepEqual(byFile.get(BETA_PATH).uncoveredLines, [1]);
});
