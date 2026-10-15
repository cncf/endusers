import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDate } from '../src/components/shared/formatDate.js';

// formatDate() is the single date formatter behind AwardsTimeline,
// PeopleFreshness, CaseStudies, RadarReports and GroupLinkStatus, and the
// `timeZone: 'UTC'` option is the whole reason it
// exists: the site is prerendered in UTC and rehydrated in the visitor's
// browser, so formatting in the local zone renders the previous day for
// everyone west of UTC and mismatches the server-rendered text.
//
// Neither coverage lane can see that option go missing. The helper is at
// 100.00% lines and regions in both of them -- `src files` 100.00%/100.00% in
// the unit report, and 24/24 lines with 7/7 regions in the e2e one (run
// 38635988670, artifact `e2e-coverage`) -- and deleting `timeZone: 'UTC'`
// executes exactly the same lines and the same regions. The invariant has to
// be asserted by value or not at all, which is what this file does.
//
// It is asserted here, on the helper, rather than at the six call sites. The
// one guard that existed before this file, in tests/awards-timeline.test.mjs,
// covers a single call site, compares two renders against *each other* rather
// than against the UTC day -- so a formatter stamping some other fixed zone
// passes it -- and skips itself on a runtime that ignores a late TZ change.

// Zones that disagree with UTC in both directions, plus one past the
// dateline. An unpinned formatter renders the previous day in WEST and the
// next day in AHEAD for the values below; EAST is the ordinary European
// offset that trips only on a late-in-the-day timestamp.
const WEST = 'America/Los_Angeles';
const EAST = 'Europe/Berlin';
const AHEAD = 'Pacific/Kiritimati';
const ZONES = [WEST, EAST, AHEAD, 'UTC'];

// Each case is a value some data/ file actually carries -- a bare calendar
// date (awards.json verifiedAt), and timestamps at each end of the UTC day
// (metrics.json generatedAt, community-people.json fetchedAt) -- paired with
// the UTC calendar day it must render as in every zone.
const CASES = [
  { input: '2026-08-08', expected: 'August 8, 2026' },
  { input: '2026-08-08T00:30:00Z', expected: 'August 8, 2026' },
  { input: '2026-08-08T23:30:00Z', expected: 'August 8, 2026' },
];

function withTimeZone(zone, fn) {
  const original = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

// The same formatting call with the `timeZone` option removed: what every one
// of the six call sites would render if the pin were dropped.
function unpinned(isoDate) {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Asserted rather than skipped around. The suite runs under TZ=UTC, so every
// assertion below is vacuous on a runtime that ignores a TZ change made after
// start-up: the zone never actually moves, and a helper with no pin at all
// passes. A runtime like that must fail here, loudly and once, instead of
// leaving the rest of the file quietly asserting nothing.
test('the runtime honours a time zone changed after start-up', () => {
  const west = withTimeZone(WEST, () => unpinned('2026-08-08'));
  const east = withTimeZone(EAST, () => unpinned('2026-08-08'));
  assert.notEqual(
    west,
    east,
    'process.env.TZ had no effect after start-up, so the time-zone assertions in this file cannot detect anything',
  );
});

test('a date-only value renders its UTC calendar day in every zone', () => {
  for (const zone of ZONES) {
    assert.equal(
      withTimeZone(zone, () => formatDate('2026-08-08')),
      'August 8, 2026',
      `${zone} rendered a date-only value as some day other than its UTC one`,
    );
  }
});

test('a timestamp at either end of the UTC day renders that UTC day', () => {
  for (const { input, expected } of CASES) {
    for (const zone of ZONES) {
      assert.equal(
        withTimeZone(zone, () => formatDate(input)),
        expected,
        `${input} rendered as the wrong calendar day in ${zone}`,
      );
    }
  }
});

// The pin is only load-bearing where an unpinned formatter would actually
// disagree. Without this, the assertions above would still pass if the three
// zones happened to agree with UTC on all three values, and the file would be
// pinning nothing.
test('the zones and values chosen here do drift without the pin', () => {
  const drifted = [];
  for (const { input, expected } of CASES) {
    for (const zone of [WEST, EAST, AHEAD]) {
      if (withTimeZone(zone, () => unpinned(input)) !== expected)
        drifted.push(`${input} in ${zone}`);
    }
  }
  for (const zone of [WEST, AHEAD]) {
    assert.ok(
      drifted.some((entry) => entry.endsWith(` in ${zone}`)),
      `no value in this file distinguishes a UTC-pinned formatter from an unpinned one in ${zone}`,
    );
  }
});

// The documented contract the call sites branch on: PeopleFreshness and
// GroupLinkStatus both test the result for null
// before rendering, so a helper that returned 'Invalid Date' instead would
// put that string on the page rather than suppressing the line.
test('an unparseable or missing value is null, not a rendered string', () => {
  for (const input of ['', 'not a date', '2026-13-45', undefined]) {
    assert.equal(
      formatDate(input),
      null,
      `${JSON.stringify(input)} must not format as a date`,
    );
  }
});

// `null` is the one absent-looking value that does NOT reach the guard above:
// `new Date(null)` coerces to 0 rather than to an invalid date, so the helper
// formats the epoch. Pinned as the behaviour it is rather than as the
// behaviour the name suggests, because what keeps it off the page is not here.
//
// Most call sites never pass it -- AwardsTimeline, CaseStudies, RadarReports
// and MirrorSyncStatus all test the field for truthiness first. The remaining
// two, PeopleFreshness (`peopleData.fetchedAt`)
// and GroupLinkStatus (`groupsData?.checkedAt`, whose optional chaining guards
// a missing object and not a null field), hand the value straight over and
// would render `January 1, 1970` in a note that is meant to disappear.
//
// What stops that is the data gate: scripts/validate-community-people.mjs
// rejects a `fetchedAt` that fails its strict ISO 8601 test (`null ?? ''`
// does), and scripts/validate-community-groups.mjs rejects a `checkedAt` that
// `Date.parse` reads as NaN (`Date.parse(null)` does). Both run in ci.yml. If
// either field is ever made optional, this is the assertion that should be
// consulted first.
test('null is formatted as the epoch, and is kept out by the data gate', () => {
  assert.equal(formatDate(null), 'January 1, 1970');
});
