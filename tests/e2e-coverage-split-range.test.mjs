// `splitRangeAtBoundaries` (tests/tools/e2e-coverage-report.mjs) is the cut
// that keeps a V8 range inside the module it started in: `convertScript` maps
// every range through it before handing the result to v8-to-istanbul, which
// abandons any range whose start and end resolve to different originals.
//
// tests/e2e-coverage-source-boundary.test.mjs and
// tests/e2e-coverage-source-boundary-segments.test.mjs pin what the cut does
// to a *report* -- a bundle, a source map, an artifact, a region count. That
// is the right level for "a range that straddles two modules is not lost", and
// the wrong level for the arithmetic itself: a fixture can only ever present
// the handful of cut lists a hand-written bundle happens to produce, and the
// report's region count is several transformations downstream of the offsets
// this function returns. These tests call it directly, so the postconditions
// are stated on the offsets.
//
// The postcondition that matters is the one the function's own last line
// depends on:
//
//   return parts.length === 0 ? [range] : parts;
//
// `parts` is empty only when the loop pushed nothing *and* the tail push did
// not fire. The tail push fires whenever `range.endOffset > start`, and when
// there is at least one cut `start` is the last cut, which `cuts` built under
// `offset < range.endOffset`. So a non-empty cut list always leaves at least
// the tail part, and the `[range]` arm is unreachable -- `npm run
// test:unit:coverage` names line 627 among the uncovered regions of
// tests/tools/e2e-coverage-report.mjs, with the file at 97.98%.
//
// An unreachable arm asserted by nothing is indistinguishable from an arm
// whose fixture is merely missing. `every cut list leaves at least the tail
// part` below asserts the invariant over every cut list of a small offset
// space, so an edit that makes the fallback reachable fails on that test's
// name rather than quietly changing what the report counts.
import assert from 'node:assert/strict';
import test from 'node:test';

import { splitRangeAtBoundaries } from './tools/e2e-coverage-report.mjs';

const RANGE = { startOffset: 10, endOffset: 20, count: 3 };

test('a range with no boundary inside it is returned unchanged', () => {
  for (const boundaries of [[], [0], [40], [0, 40]]) {
    assert.deepEqual(splitRangeAtBoundaries(RANGE, boundaries), [RANGE]);
  }
});

test('a boundary on either endpoint does not cut', () => {
  // `cuts` is built with strict comparisons on both sides. A boundary at
  // `startOffset` would otherwise emit an empty leading part, and one at
  // `endOffset` an empty trailing part.
  assert.deepEqual(
    splitRangeAtBoundaries(RANGE, [RANGE.startOffset, RANGE.endOffset]),
    [RANGE],
  );
});

test('an interior boundary ends the leading part one offset short of it', () => {
  // The gap is deliberate: the first offset at a boundary already belongs to
  // the next source, so a leading part that ended *at* the cut would map its
  // end into the following module and v8-to-istanbul would drop the whole
  // range. The offset is not lost -- it opens the trailing part.
  assert.deepEqual(splitRangeAtBoundaries(RANGE, [15]), [
    { startOffset: 10, endOffset: 14, count: 3 },
    { startOffset: 15, endOffset: 20, count: 3 },
  ]);
});

test('every part carries the properties of the range it came from', () => {
  const range = { ...RANGE, isBlockCoverage: true, functionName: 'render' };
  for (const part of splitRangeAtBoundaries(range, [15])) {
    assert.equal(part.count, 3);
    assert.equal(part.isBlockCoverage, true);
    assert.equal(part.functionName, 'render');
  }
});

test('a cut one offset past the start drops the lone leading offset', () => {
  // `end = cut - 1` equals `start`, which is not `> start`, so no leading part
  // is pushed. This is the only shape that makes the loop contribute nothing,
  // and it is exactly the shape the unreachable fallback would have to catch.
  assert.deepEqual(splitRangeAtBoundaries(RANGE, [RANGE.startOffset + 1]), [
    { startOffset: 11, endOffset: 20, count: 3 },
  ]);
});

test('consecutive cuts contribute only the parts that have width', () => {
  assert.deepEqual(splitRangeAtBoundaries(RANGE, [15, 16]), [
    { startOffset: 10, endOffset: 14, count: 3 },
    { startOffset: 16, endOffset: 20, count: 3 },
  ]);
});

test('the parts tile the range: ascending, non-overlapping, ending at the end', () => {
  const parts = splitRangeAtBoundaries(RANGE, [13, 17]);
  assert.equal(parts.at(-1).endOffset, RANGE.endOffset);
  for (const part of parts) {
    assert.ok(part.startOffset < part.endOffset);
    assert.ok(part.startOffset >= RANGE.startOffset);
    assert.ok(part.endOffset <= RANGE.endOffset);
  }
  for (let index = 1; index < parts.length; index += 1) {
    assert.ok(parts[index - 1].endOffset < parts[index].startOffset);
  }
});

test('every cut list leaves at least the tail part', () => {
  // Exhaustive over the subsets of a small offset space rather than over a
  // chosen fixture, because the claim being pinned is that *no* cut list
  // produces an empty `parts` -- a claim one example cannot support. Any
  // counter-example here is a cut list that reaches the `[range]` fallback.
  const range = { startOffset: 0, endOffset: 6, count: 1 };
  const offsets = [0, 1, 2, 3, 4, 5, 6];
  let withCuts = 0;
  for (let mask = 0; mask < 1 << offsets.length; mask += 1) {
    const boundaries = offsets.filter((_, index) => mask & (1 << index));
    const parts = splitRangeAtBoundaries(range, boundaries);
    assert.ok(
      parts.length > 0,
      `empty parts for ${JSON.stringify(boundaries)}`,
    );
    const cuts = boundaries.filter(
      (offset) => offset > range.startOffset && offset < range.endOffset,
    );
    if (cuts.length === 0) continue;
    withCuts += 1;
    // The tail part, which is what makes `parts` non-empty on this path.
    assert.equal(parts.at(-1).startOffset, cuts.at(-1));
    assert.equal(parts.at(-1).endOffset, range.endOffset);
  }
  // Non-vacuity: the loop above must actually have reached the cut path.
  assert.ok(withCuts > 0);
});
