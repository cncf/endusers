// `convertScript` (tests/tools/e2e-coverage-report.mjs) decides which of a
// bundle's original sources a script's coverage may be written to:
//
//   const attributedPaths = new Set(
//     Object.entries(converter.branches)
//       .filter(([, ranges]) => ranges.length > 0)
//       .map(([path]) => path),
//   );
//
// and `collectE2ECoverage` drops any `src/` path missing from that set when
// the bundle maps to more than one source. So "branches alone decide
// attribution" is a load-bearing claim about v8-to-istanbul, not a style
// choice: a release that stopped populating `branches` for a source would not
// fail anything -- the report would quietly stop counting that file, and the
// e2e gate would pass on a smaller denominator.
//
// These tests state the facts the single-arm form rests on. They drive the
// installed converter directly rather than a report, because a report can only
// show the consequence and these are the premises:
//
//   1. `branches` and `functions` are initialised to `{}` by the converter's
//      constructor, so neither needs a `?? {}` guard;
//   2. `functions` is populated only for a *named* block, and then only for
//      the source its first range lands in, which makes it a strictly weaker
//      signal than `branches`; and
//   3. the records `convertScript` applies are always anonymous, because
//      `normalizeRanges` rebuilds every script's coverage as one block with
//      `functionName: ''` -- which is why a `functions` arm could never have
//      contributed a path that `branches` had not.
//
// The last test is the end-to-end consequence, kept beside the premises: a
// two-source bundle attributes both of its sources, including one whose
// coverage is a single uninterrupted covered range.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import v8ToIstanbul from 'v8-to-istanbul';

import { collectE2ECoverage } from './tools/e2e-coverage-report.mjs';
import {
  initCoverageRun,
  sealCoverageRun,
  writeCoverageArtifact,
} from './tools/e2e-coverage-run.mjs';

const ALPHA = 'const alpha1 = 1;\nconst alpha2 = 2;\n';
const BETA = 'const beta1 = 1;\nconst beta2 = 2;\n';
const MAPPED_SOURCE = `${ALPHA}${BETA}`;
const SCRIPT_TEXT = `${MAPPED_SOURCE}\n//# sourceMappingURL=app.js.map\n`;
const ALPHA_PATH = 'src/components/Alpha/index.js';
const BETA_PATH = 'src/components/Beta/index.js';

// Four generated lines, all at column 0. 'AAAA' opens source 0 line 1, 'AACA'
// advances the original line, 'ACDA' switches to source 1 and steps the
// original line back to 1 (source +1, originalLine -1), 'AACA' advances it
// again. Spelled out rather than produced by a helper so the fixture states
// exactly where the source boundary falls.
const MAPPINGS = 'AAAA;AACA;ACDA;AACA';

// `normalizeSourceMap` rewrites every reference to the resolved absolute path
// of the file on disk before the converter sees it, so the premise tests use
// that shape rather than the `webpack://` form the bundler emits.
const ABSOLUTE_SOURCES = ['/virtual/src/alpha.js', '/virtual/src/beta.js'];

function premiseMap() {
  return {
    version: 3,
    file: 'app.js',
    sourceRoot: '',
    sources: [...ABSOLUTE_SOURCES],
    sourcesContent: [ALPHA, BETA],
    names: [],
    mappings: MAPPINGS,
  };
}

// One range per source, which is what `splitRangeAtBoundaries` guarantees
// `convertScript` hands to `applyCoverage`: a range that straddles the
// boundary resolves its endpoints into two different originals, and
// v8-to-istanbul abandons it, recording nothing for either source.
function blockCovering(functionName) {
  return [
    {
      functionName,
      isBlockCoverage: true,
      ranges: [
        { startOffset: 0, endOffset: ALPHA.length - 1, count: 1 },
        {
          startOffset: ALPHA.length,
          endOffset: MAPPED_SOURCE.length,
          count: 1,
        },
      ],
    },
  ];
}

function newConverter() {
  return v8ToIstanbul('/virtual/build/assets/js/app.js', 0, {
    source: MAPPED_SOURCE,
    sourceMap: { sourcemap: premiseMap() },
  });
}

async function applied(functionName) {
  const converter = newConverter();
  await converter.load();
  converter.applyCoverage(blockCovering(functionName));
  return converter;
}

// The same fold `convertScript` applies, so these tests read the maps exactly
// as attribution does rather than merely asserting they are non-empty.
const attributable = (map) =>
  Object.entries(map)
    .filter(([, ranges]) => ranges.length > 0)
    .map(([path]) => path)
    .sort();

test('the converter initialises branches and functions, so neither needs a ?? guard', async () => {
  const converter = newConverter();
  await converter.load();
  assert.deepEqual(converter.branches, {});
  assert.deepEqual(converter.functions, {});

  // Still object-valued once coverage has been applied. The `?? {}` guards
  // `convertScript` used to carry could only ever have fired if one of these
  // were reassigned to a nullish value, which nothing in the converter does.
  converter.applyCoverage(blockCovering(''));
  assert.equal(typeof converter.branches, 'object');
  assert.notEqual(converter.branches, null);
  assert.equal(typeof converter.functions, 'object');
  assert.notEqual(converter.functions, null);
});

test('an anonymous block attributes every source through branches and none through functions', async () => {
  const converter = await applied('');
  assert.deepEqual(attributable(converter.branches), ABSOLUTE_SOURCES);
  // The whole reason the `functions` arm of `attributedPaths` was removable:
  // `normalizeRanges` names no block, so this map is never written to.
  assert.deepEqual(converter.functions, {});
});

test('a named block populates functions, and then only for its first range', async () => {
  // Non-vacuity for the test above -- `functions` is not simply always empty --
  // and the reason it would remain the weaker arm even if it were reachable: a
  // named block records one function, against the source its first range lands
  // in, while `branches` already names both.
  const converter = await applied('render');
  assert.deepEqual(attributable(converter.functions), [ABSOLUTE_SOURCES[0]]);
  assert.deepEqual(attributable(converter.branches), ABSOLUTE_SOURCES);
});

async function fixtureRun() {
  const root = await mkdtemp(join(tmpdir(), 'endusers-attribution-'));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  for (const [path, content] of [
    [ALPHA_PATH, ALPHA],
    [BETA_PATH, BETA],
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await mkdir(join(buildDir, 'assets/js'), { recursive: true });
  await writeFile(join(buildDir, 'assets/js/app.js'), SCRIPT_TEXT);
  await writeFile(
    join(buildDir, 'assets/js/app.js.map'),
    JSON.stringify({
      version: 3,
      file: 'app.js',
      sources: [
        `webpack://endusers/./${ALPHA_PATH}`,
        `webpack://endusers/./${BETA_PATH}`,
      ],
      sourcesContent: [ALPHA, BETA],
      names: [],
      mappings: MAPPINGS,
    }),
  );
  await initCoverageRun(runDir, 'run-1', { project: 'chromium' });

  // A zero-count range inside Alpha's line 2, which is what the browser
  // records for a block that did not run. Beta is left as one uninterrupted
  // covered range, so it is the source that tests whether attribution
  // survives a file the run never split.
  const alphaSplitStart = ALPHA.indexOf('const alpha2');
  await writeCoverageArtifact(runDir, 'worker-0-page-0', {
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
              { startOffset: 0, endOffset: SCRIPT_TEXT.length, count: 1 },
              {
                startOffset: alphaSplitStart,
                endOffset: alphaSplitStart + 'const alpha2'.length,
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

test('both sources of a two-source bundle are attributed, including the unsplit one', async () => {
  const fixture = await fixtureRun();
  try {
    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.equal(report.status, 'ok');
    // `sourceFiles.length > 1` here, so a path missing from `attributedPaths`
    // is dropped from the report outright -- silently, with no diagnostic.
    assert.deepEqual(
      report.sources.map((source) => source.file).sort(),
      [ALPHA_PATH, BETA_PATH].sort(),
    );
    assert.deepEqual(report.diagnostics.errors, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
