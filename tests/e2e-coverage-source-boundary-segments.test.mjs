// `sourceBoundaryOffsets` (tests/tools/e2e-coverage-report.mjs) walks every
// decoded source-map segment to find the generated offsets where the original
// source changes, and `convertScript` cuts each V8 range at those offsets so
// that no sub-range straddles two modules. tests/e2e-coverage-source-boundary.test.mjs
// pins the two-module case that motivated the split (#1236). These tests pin
// the two shapes of that walk which a hand-rolled two-source fixture never
// reaches, and which real bundles do:
//
//   1. A segment that carries only a generated column. Source maps are allowed
//      to emit a 1-field segment -- "this generated position maps to nothing"
//      -- and webpack/terser output contains them wherever a generated range
//      has no original counterpart. `segment[1]` is `undefined` for such a
//      segment, so without the `segment.length < 4` guard it reads as a change
//      of source: it manufactures a boundary that is not a module edge, and it
//      leaves `previousSource` at `undefined`, so the *next* genuine segment
//      looks like a change too. The fixture below places the short segment at
//      the end of a generated line so the manufactured boundary lands on the
//      following line's start, where it cuts a range that belongs entirely to
//      one module into two.
//
//   2. More than one boundary. A bundle with three modules has two, and
//      `splitRangeAtBoundaries` walks the cut list assuming it is ascending --
//      it advances `start` to each cut in turn and emits nothing for a cut it
//      has already passed. The sort at the end of `sourceBoundaryOffsets` is
//      what guarantees that order, and it cannot be exercised by a list of one.
//
// Both are asserted on the reported `regions` count rather than on percentages:
// a spurious cut splits one region into two without changing which lines ran,
// so the percentage is identical either way and only the region count shows it.
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
const GAMMA = 'const gamma = 1;\nconst gammaRare = 2;\n';
const ALPHA_PATH = 'src/components/Alpha/index.js';
const BETA_PATH = 'src/components/Beta/index.js';
const GAMMA_PATH = 'src/components/Gamma/index.js';

// Base64 VLQ, one identity mapping per generated line at column 0. 'AAAA' is
// [generatedColumn 0, source 0, originalLine 0, originalColumn 0] as deltas;
// 'AACA' advances the original line by one; 'ACDA' advances the source index
// by one and rewinds the original line to zero. 'K' on its own is a 1-field
// segment at generated column +5 -- a position mapped to no source at all.
//
// Alpha occupies generated lines 1-2 and Beta lines 3-4, so the only genuine
// boundary is the start of generated line 3. The trailing ',K' sits on line 3,
// after Beta's own mapping, which is where an unguarded walk would set
// `previousSource` to `undefined` and then read line 4 as a second boundary --
// a cut in the middle of Beta.
const SHORT_SEGMENT_MAPPINGS = 'AAAA;AACA;ACDA,K;AACA';

// Alpha on generated lines 1-2, Beta on 3-4, Gamma on 5-6: boundaries at the
// start of generated line 3 and the start of generated line 5.
const THREE_SOURCE_MAPPINGS = 'AAAA;AACA;ACDA;AACA;ACDA;AACA';

async function fixture({ sources, mappings }) {
  const root = await mkdtemp(join(tmpdir(), 'endusers-boundary-segments-'));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  for (const source of sources) {
    await mkdir(join(root, source.path, '..'), { recursive: true });
    await writeFile(join(root, source.path), source.text);
  }
  const generated = sources.map((source) => source.text).join('');
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

// One range over the whole script: every module ran, so each module should end
// up with exactly one region unless a boundary cut it.
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

test('a segment that maps to no source is not read as a module boundary', async () => {
  const context = await fixture({
    sources: [
      { path: ALPHA_PATH, text: ALPHA },
      { path: BETA_PATH, text: BETA },
    ],
    mappings: SHORT_SEGMENT_MAPPINGS,
  });
  await writeWholeScriptHit(context.runDir, context.script);
  await sealCoverageRun(context.runDir, 'passed');

  const report = await collectE2ECoverage(context.runDir, {
    root: context.root,
    buildDir: context.buildDir,
  });

  const byFile = new Map(report.sources.map((source) => [source.file, source]));
  assert.deepEqual([...byFile.keys()].sort(), [ALPHA_PATH, BETA_PATH]);
  for (const source of report.sources) {
    assert.equal(source.linePercent, 100, source.file);
    assert.equal(source.regionPercent, 100, source.file);
  }
  // The assertion the guard owns: Beta is one uninterrupted region. Drop the
  // `segment.length < 4` check and the 1-field segment on generated line 3
  // manufactures a boundary at the start of line 4, splitting Beta in two.
  assert.equal(byFile.get(ALPHA_PATH).regions, 1);
  assert.equal(byFile.get(BETA_PATH).regions, 1);
});

test('a three-module bundle is cut at both of its boundaries', async () => {
  const context = await fixture({
    sources: [
      { path: ALPHA_PATH, text: ALPHA },
      { path: BETA_PATH, text: BETA },
      { path: GAMMA_PATH, text: GAMMA },
    ],
    mappings: THREE_SOURCE_MAPPINGS,
  });
  await writeWholeScriptHit(context.runDir, context.script);
  await sealCoverageRun(context.runDir, 'passed');

  const report = await collectE2ECoverage(context.runDir, {
    root: context.root,
    buildDir: context.buildDir,
  });

  assert.deepEqual(report.sources.map((source) => source.file).sort(), [
    ALPHA_PATH,
    BETA_PATH,
    GAMMA_PATH,
  ]);
  // The middle module is the one that needs both cuts: it is credited only if
  // the range was cut at the boundary before it *and* at the boundary after
  // it, which is also what requires the cut list to be in ascending order.
  for (const source of report.sources) {
    assert.equal(source.linePercent, 100, source.file);
    assert.equal(source.regionPercent, 100, source.file);
    assert.equal(source.regions, 1, source.file);
    assert.deepEqual(source.uncoveredRegions, [], source.file);
  }
});
