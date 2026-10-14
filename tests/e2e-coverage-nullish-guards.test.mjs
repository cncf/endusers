// The premises behind two `??` guards tests/tools/e2e-coverage-report.mjs does
// not carry.
//
// A nullish guard over a dependency's return value is a claim about that
// dependency, and an unreachable one is worse than noise: it is the only part
// of the reporter nothing can execute, so it reads as a case someone saw
// rather than a case that cannot happen, and the next reader writes the next
// guard beside it. tests/e2e-coverage-attribution.test.mjs already took this
// position for `converter.branches` and `converter.functions` -- prove the
// library initialises them, then drop the guard. These are the same shape:
//
//   normalizeSourceMap(): `const references = map.resolvedSources;`
//     carried `?? flattened.sources ?? []`. @jridgewell/trace-mapping's
//     `AnyMap` sets `resolvedSources` in its constructor, for every map shape
//     the bundler can emit.
//   collectE2ECoverage(): `Object.entries(converted.coverage)` carried
//     `?? {}`. `convertScript` has two returns and both set `coverage` to
//     `converter.toIstanbul()`, which v8-to-istanbul returns as an object
//     whether or not `applyCoverage` ran.
//
// The two `resolvedSources` arms were also not interchangeable, which is the
// stronger reason to drop rather than keep them: for an index map
// `flattened.sources` holds resolved `file://` URLs where a flat map's holds
// the raw references, so the fallback would have handed
// `sourcePathFromReference` a different shape than the arm above it -- a
// silent change of meaning on the one input nobody could reproduce.
//
// These tests drive the installed libraries directly rather than a report. A
// report can only show the consequence; a release that changed either premise
// has to fail here, by name, against the guard that is no longer there to
// absorb it.
import assert from 'node:assert/strict';
import test from 'node:test';

import { AnyMap } from '@jridgewell/trace-mapping';
import v8ToIstanbul from 'v8-to-istanbul';

const SOURCE = 'const alpha = 1;\n';
const SOURCE_PATH = '/virtual/src/alpha.js';
const SCRIPT_PATH = '/virtual/build/assets/js/app.js';
const MAP_URL = 'file:///virtual/build/assets/js/app.js.map';

const flatMap = () => ({
  version: 3,
  file: 'app.js',
  sources: [SOURCE_PATH],
  sourcesContent: [SOURCE],
  names: [],
  mappings: 'AAAA',
});

// Every shape `loadSourceMap` can hand `normalizeSourceMap`: what the bundler
// emits, what an index map emits, and the two degenerate documents a broken
// emit produces. `resolvedSources` is an array in all of them, which is what
// makes the removed arms unreachable rather than merely unused.
const SHAPES = [
  ['an ordinary flat map', flatMap()],
  [
    'an index map',
    {
      version: 3,
      file: 'app.js',
      sections: [{ offset: { line: 0, column: 0 }, map: flatMap() }],
    },
  ],
  [
    'a map carrying no sources at all',
    {
      version: 3,
      file: 'app.js',
      sources: [],
      sourcesContent: [],
      names: [],
      mappings: '',
    },
  ],
  [
    'a map whose source entry is null',
    {
      version: 3,
      file: 'app.js',
      sources: [null],
      sourcesContent: [null],
      names: [],
      mappings: 'AAAA',
    },
  ],
  [
    'a map with a sourceRoot',
    { ...flatMap(), sourceRoot: 'webpack://endusers/' },
  ],
];

for (const [label, raw] of SHAPES) {
  test(`AnyMap resolves sources to an array for ${label}`, () => {
    const map = new AnyMap(raw, MAP_URL);
    assert.ok(
      Array.isArray(map.resolvedSources),
      'resolvedSources is the only thing normalizeSourceMap reads; a nullish ' +
        'value here would mean the removed `?? flattened.sources ?? []` arms ' +
        'were load-bearing after all',
    );
  });
}

test('a map with a null source entry still resolves that entry to a string', () => {
  // Non-vacuity for the shape above: the array is not merely present, it is
  // populated, so `references.length` still drives the loop and the entry
  // reaches `sourcePathFromReference` rather than being skipped by an empty
  // array the fallback would have supplied.
  const map = new AnyMap(SHAPES[3][1], MAP_URL);
  assert.equal(map.resolvedSources.length, 1);
  assert.equal(typeof map.resolvedSources[0], 'string');
});

test('toIstanbul returns an object before applyCoverage has run', async () => {
  // `convertScript`'s early return, for a script whose ranges all fell outside
  // the mapped source: it reports `attributed: false`, but the object it
  // returns still has to satisfy `Object.entries(converted.coverage)`.
  const converter = v8ToIstanbul(SCRIPT_PATH, 0, {
    source: SOURCE,
    sourceMap: { sourcemap: flatMap() },
  });
  await converter.load();
  const coverage = converter.toIstanbul();
  assert.equal(typeof coverage, 'object');
  assert.notEqual(coverage, null);
});

test('toIstanbul returns an object after applyCoverage has run', async () => {
  // `convertScript`'s ordinary return.
  const converter = v8ToIstanbul(SCRIPT_PATH, 0, {
    source: SOURCE,
    sourceMap: { sourcemap: flatMap() },
  });
  await converter.load();
  converter.applyCoverage([
    {
      functionName: '',
      isBlockCoverage: true,
      ranges: [{ startOffset: 0, endOffset: SOURCE.length, count: 1 }],
    },
  ]);
  const coverage = converter.toIstanbul();
  assert.equal(typeof coverage, 'object');
  assert.notEqual(coverage, null);
  // Non-vacuity: the object is the reporter's whole input, so an empty one
  // would make the assertions above true of a value that taught us nothing.
  assert.ok(Object.keys(coverage).length > 0);
});
