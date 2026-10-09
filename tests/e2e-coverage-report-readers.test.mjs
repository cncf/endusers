// Unit coverage for the four istanbul readers in
// tests/tools/e2e-coverage-report.mjs -- `getLineCoverage`,
// `getRegionCoverage`, `isPhantomRegion` and `isContradictedRegion`.
//
// Every guard in those readers defends against a malformed *istanbul* object.
// Istanbul objects are not inputs to the module: `convertScript` builds them
// from the captured V8 payload with `v8-to-istanbul`, so a guard can only be
// reached if that library emits a shape it does not emit. No capture artifact
// written at the public boundary (`collectE2ECoverage`) can produce one, which
// is why 18 regions survived every probe written against the public surface in
// #1208/#1209 and were recorded as unreachable in #1210.
//
// The resolution chosen there is to drive the readers directly with hand-built
// istanbul objects rather than carry the residual forever. These tests are the
// only consumer of the test-only exports added for that purpose, and they are
// deliberately written against hand-built shapes: a fixture produced by
// `v8-to-istanbul` would by definition be well-formed and reach none of them.
//
// This file is separate from tests/e2e-coverage-report.test.mjs and
// tests/e2e-coverage-region-union.test.mjs so the three bodies of work stay
// independent, matching how tests/e2e-coverage-run.test.mjs and
// tests/e2e-coverage-scripts.test.mjs are already split out.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLineCoverage,
  getRegionCoverage,
  isPhantomRegion,
  isContradictedRegion,
} from './tools/e2e-coverage-report.mjs';

// A region as the readers consume it: original-source coordinates plus the
// execution count the fold decided on.
function region(line, column, endLine, endColumn, count = 0) {
  return { line, column, endLine, endColumn, count };
}

// A witness as `isContradictedRegion` consumes it: the script that produced it,
// its per-line counts, its zero-count regions and the keys of those zeros.
function witness({ script, lines = [], zeros = [] }) {
  return {
    script,
    lines: new Map(lines),
    zeros,
    zeroKeys: new Set(
      zeros.map((zero) =>
        [zero.line, zero.column, zero.endLine, zero.endColumn].join(':'),
      ),
    ),
  };
}

test('getLineCoverage treats a coverage object with no statements as empty', () => {
  assert.deepEqual([...getLineCoverage({}).entries()], []);
});

test('getLineCoverage skips statements whose map entry is missing or unusable', () => {
  const lines = getLineCoverage({
    // Four statements, one usable. The other three are each a different way
    // for the map lookup to come back without an integer line: no entry at
    // all, an entry with no `start`, and a `start` whose line is not an
    // integer. Istanbul never emits any of them.
    s: { 0: 3, 1: 7, 2: 7, 3: 7 },
    statementMap: {
      0: { start: { line: 12 } },
      2: {},
      3: { start: { line: 'not-a-line' } },
    },
  });
  assert.deepEqual([...lines.entries()], [[12, 3]]);
});

test('getLineCoverage keeps the highest count recorded against one line', () => {
  // Two statements on line 5: the per-line fold reports the line at the count
  // of whichever ran most, not whichever was read last.
  const lines = getLineCoverage({
    s: { 0: 1, 1: 9, 2: 4 },
    statementMap: {
      0: { start: { line: 5 } },
      1: { start: { line: 5 } },
      2: { start: { line: 5 } },
    },
  });
  assert.equal(lines.get(5), 9);
});

test('getRegionCoverage treats a coverage object with no branches as empty', () => {
  assert.deepEqual([...getRegionCoverage({}).entries()], []);
});

test('getRegionCoverage treats a branch with no map entry as having no locations', () => {
  // `b` names a branch id that `branchMap` does not carry, and a second whose
  // entry carries no `locations` array. Both fall through to the empty-list
  // fallback rather than throwing.
  const regions = getRegionCoverage({
    b: { 0: [1], 1: [1] },
    branchMap: { 1: {} },
  });
  assert.deepEqual([...regions.entries()], []);
});

test('getRegionCoverage skips locations with no usable start line', () => {
  const regions = getRegionCoverage({
    b: { 0: [1, 1, 1, 1] },
    branchMap: {
      0: {
        locations: [
          null,
          {},
          { start: { line: 1.5 } },
          { start: { line: 8, column: 2 }, end: { line: 8, column: 9 } },
        ],
      },
    },
  });
  assert.deepEqual(
    [...regions.values()],
    [region(8, 2, 8, 9, 1)],
    'only the well-formed location survives',
  );
});

test('getRegionCoverage defaults a location missing its end and columns', () => {
  // A location with no `end` is a point: it ends on its own line. Absent
  // columns default to 0 at both ends, so the key stays well formed.
  const regions = getRegionCoverage({
    b: { 0: [2] },
    branchMap: { 0: { locations: [{ start: { line: 4 } }] } },
  });
  assert.deepEqual([...regions.values()], [region(4, 0, 4, 0, 2)]);
});

test('getRegionCoverage reads a location with no recorded count as zero', () => {
  // `b` carries no counts array for the branch at all, and a second branch
  // carries one too short for its locations. Both missing counts read as zero
  // rather than `undefined`, which would poison the `count > existing.count`
  // comparison the union depends on.
  const regions = getRegionCoverage({
    b: { 0: undefined, 1: [] },
    branchMap: {
      0: {
        locations: [
          { start: { line: 1, column: 0 }, end: { line: 1, column: 4 } },
        ],
      },
      1: {
        locations: [
          { start: { line: 2, column: 0 }, end: { line: 2, column: 4 } },
        ],
      },
    },
  });
  assert.deepEqual(
    [...regions.values()],
    [region(1, 0, 1, 4, 0), region(2, 0, 2, 4, 0)],
  );
});

test('isPhantomRegion keeps a region that executed', () => {
  assert.equal(isPhantomRegion(region(1, 0, 3, 0, 1), new Map()), false);
});

test('isPhantomRegion keeps a single-line zero region', () => {
  // Several single-line regions share one line and the per-line fold cannot
  // tell them apart, so a zero on one line is never folded away.
  assert.equal(
    isPhantomRegion(region(7, 4, 7, 20), new Map([[7, 5]])),
    false,
    'endLine === line is not a phantom',
  );
  assert.equal(
    isPhantomRegion(region(9, 4, 8, 0), new Map([[9, 5]])),
    false,
    'an end before the start is not a phantom either',
  );
});

test('isPhantomRegion folds a multi-line zero whose every executable line ran', () => {
  // Line 3 carries no statement -- a blank line or a comment inside the span.
  // It neither confirms nor contradicts, so the fold skips it.
  assert.equal(
    isPhantomRegion(
      region(2, 0, 4, 8),
      new Map([
        [2, 1],
        [4, 1],
      ]),
    ),
    true,
  );
});

test('isPhantomRegion keeps a multi-line zero contradicted by an unexecuted line', () => {
  // Line 3 is executable and did not run, so the span is genuinely uncovered
  // rather than a source-map artifact.
  assert.equal(
    isPhantomRegion(
      region(2, 0, 4, 8),
      new Map([
        [2, 1],
        [3, 0],
        [4, 1],
      ]),
    ),
    false,
  );
});

test('isContradictedRegion keeps a region that executed', () => {
  assert.equal(isContradictedRegion(region(1, 0, 1, 4, 3), []), false);
});

test('isContradictedRegion keeps a zero no script ever recorded', () => {
  // The witness recorded a zero at different coordinates, so no script is a
  // candidate and the inference never starts. Across scripts the absence of a
  // zero proves nothing: a different bundle maps the same arm elsewhere.
  const target = region(5, 2, 5, 9);
  assert.equal(
    isContradictedRegion(target, [
      witness({
        script: 'a.js',
        lines: [[5, 1]],
        zeros: [region(9, 0, 9, 3)],
      }),
    ]),
    false,
  );
});

test('isContradictedRegion keeps a zero whose only witness lines carry no statement', () => {
  // The witness covers the script but records no executable line across the
  // region's span, so it never saw the text and cannot speak for it.
  const target = region(5, 2, 5, 9);
  assert.equal(
    isContradictedRegion(target, [
      witness({ script: 'a.js', lines: [[40, 1]], zeros: [target] }),
    ]),
    false,
  );
});

test('isContradictedRegion keeps a zero whose witness left one span line unexecuted', () => {
  // Line 6 inside the span did not run in the witness, so the witness did not
  // execute the text either and contradicts nothing.
  const target = region(5, 2, 7, 9);
  assert.equal(
    isContradictedRegion(target, [
      witness({
        script: 'a.js',
        lines: [
          [5, 1],
          [6, 0],
          [7, 1],
        ],
        zeros: [target],
      }),
    ]),
    false,
  );
});

test('isContradictedRegion keeps a zero the witness itself also recorded', () => {
  // The witness covers the span's lines but records a zero touching them, so
  // it skipped the same text. Only a witness with no zero over those lines
  // proves execution.
  const target = region(5, 2, 5, 9);
  assert.equal(
    isContradictedRegion(target, [
      witness({
        script: 'a.js',
        lines: [[5, 1]],
        zeros: [target, region(5, 0, 5, 1)],
      }),
    ]),
    false,
  );
});

test('isContradictedRegion folds a zero another artifact of the same script executed', () => {
  // Two artifacts of one script: the first recorded the zero, the second ran
  // the span's lines and recorded no zero on any of them. One source map per
  // script means the same skipped text would land on the same span, so the
  // second artifact executed it.
  const target = region(5, 2, 5, 9);
  assert.equal(
    isContradictedRegion(target, [
      witness({ script: 'a.js', lines: [[5, 1]], zeros: [target] }),
      witness({ script: 'a.js', lines: [[5, 1]], zeros: [] }),
    ]),
    true,
  );
});

test('isContradictedRegion ignores witnesses from a script that never recorded the zero', () => {
  // `b.js` covers the lines and carries no zero, but it never produced the
  // zero at these coordinates, so it is not a witness for this region. Only
  // `a.js` is consulted, and it still records the zero.
  const target = region(5, 2, 5, 9);
  assert.equal(
    isContradictedRegion(target, [
      witness({ script: 'a.js', lines: [[5, 1]], zeros: [target] }),
      witness({ script: 'b.js', lines: [[5, 1]], zeros: [] }),
    ]),
    false,
  );
});
