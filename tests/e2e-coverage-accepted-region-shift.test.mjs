// Unit coverage for the stale-entry hint that tells a reader whether an
// accepted region moved or genuinely went away.
//
// ADR 0007's amendment keeps `tests/e2e/fixtures/accepted-regions.json` honest
// by failing the lane on any entry the run no longer supports. That check
// cannot tell, on its own, between the two ways an entry stops matching:
//
//   - the region is gone, covered now or deleted, and the entry should go too;
//   - the region is still there, still uncovered, still unreachable for the
//     reason the entry records, and only its line moved because something was
//     inserted above it.
//
// Both arrive as "not a region this run reports", and a reader who takes the
// bare message at face value deletes a rationale that was still true. The
// region then returns to the "Uncovered regions" list, which is the standing
// defect noise the amendment was written to remove -- the registry survives
// the edit only if the shift is named at the point of failure.
//
// `shiftedSpanFor` names it, and does so strictly: identical start and end
// columns, identical height, and exactly one candidate in the file. A looser
// rule would guess, and a guessed span in this registry excuses a region
// nobody triaged. The cases below pin each way the match is refused as much
// as the one way it is made.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shiftedSpanFor } from './tools/e2e-coverage-report.mjs';

const FILE = 'src/components/MemberDirectory/DirectoryFreshness.js';

const sourcesWith = (spans, file = FILE) => [
  { file, uncoveredRegionSpans: spans },
];

test('names the span an entry moved to when only its line shifted', () => {
  const entry = { file: FILE, span: '18:66-18:71' };
  const sources = sourcesWith(['20:66-20:71']);
  assert.equal(shiftedSpanFor(entry, sources), '20:66-20:71');
});

test('matches a multi-line span that kept its height', () => {
  const entry = { file: FILE, span: '18:8-19:41' };
  const sources = sourcesWith(['50:8-51:41']);
  assert.equal(shiftedSpanFor(entry, sources), '50:8-51:41');
});

test('refuses a candidate whose height changed', () => {
  const entry = { file: FILE, span: '18:8-19:41' };
  const sources = sourcesWith(['50:8-52:41']);
  assert.equal(shiftedSpanFor(entry, sources), null);
});

test('refuses a candidate whose start column differs', () => {
  const entry = { file: FILE, span: '18:66-18:71' };
  const sources = sourcesWith(['20:12-20:71']);
  assert.equal(shiftedSpanFor(entry, sources), null);
});

test('refuses a candidate whose end column differs', () => {
  const entry = { file: FILE, span: '18:66-18:71' };
  const sources = sourcesWith(['20:66-20:99']);
  assert.equal(shiftedSpanFor(entry, sources), null);
});

test('refuses the entry own line, which is the span that already failed', () => {
  const entry = { file: FILE, span: '18:66-18:71' };
  const sources = sourcesWith(['18:66-18:71']);
  assert.equal(shiftedSpanFor(entry, sources), null);
});

test('refuses to choose when two candidates match equally well', () => {
  const entry = { file: FILE, span: '18:66-18:71' };
  const sources = sourcesWith(['20:66-20:71', '31:66-31:71']);
  assert.equal(shiftedSpanFor(entry, sources), null);
});

test('returns null when the file reports no uncovered region at all', () => {
  const entry = { file: FILE, span: '18:66-18:71' };
  assert.equal(shiftedSpanFor(entry, sourcesWith([])), null);
});

test('tolerates a source row carrying no uncovered span list', () => {
  const entry = { file: FILE, span: '18:66-18:71' };
  assert.equal(shiftedSpanFor(entry, [{ file: FILE }]), null);
});

test('returns null when the run reports the entry file not at all', () => {
  const entry = { file: FILE, span: '18:66-18:71' };
  const sources = sourcesWith(['20:66-20:71'], 'src/lib/profile-links.mjs');
  assert.equal(shiftedSpanFor(entry, sources), null);
});

test('returns null for an entry span that is not in span shape', () => {
  const entry = { file: FILE, span: 'not-a-span' };
  assert.equal(shiftedSpanFor(entry, sourcesWith(['20:66-20:71'])), null);
});

test('ignores a reported span that is not in span shape', () => {
  const entry = { file: FILE, span: '18:66-18:71' };
  const sources = sourcesWith(['whole file', '20:66-20:71']);
  assert.equal(shiftedSpanFor(entry, sources), '20:66-20:71');
});
