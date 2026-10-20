// `matchesMembership()` in src/components/MemberDirectory/utils.js decides
// which organizations survive the directory's membership <select>. Every unit
// assertion it had was existence-shaped: tests/member-directory.test.mjs
// checks a handful of statuses the filter must ADMIT, and the two reachability
// tests in tests/member-directory-membership-vocabulary.test.mjs check that
// each status matches at least one filter and each filter matches at least one
// status. Nothing asserted what a filter must REJECT, so a filter that admits
// everything satisfies all of them.
//
// That is not hypothetical. Inverting the comparisons in the `contributor`
// arm to
//
//   return status !== 'contributor' || status !== 'member-and-contributor';
//
// makes the arm a tautology -- a status differs from at least one of two
// distinct literals -- so selecting "End User Contributors" leaves the
// directory unfiltered. The full unit suite passes with that arm in place
// while the line stays at 100% statement and region coverage, because the
// lines do execute; only their outcome is unpinned.
//
// The sole guard left is the browser case in tests/e2e/interactions.spec.js
// ('the contributor filter narrows the directory to contributor profiles'),
// which asserts the narrowing against a built site. Leaving a pure two-literal
// predicate to be defended by Playwright alone means the regression surfaces
// after a production build rather than in `npm run test:unit`. These cases pin
// the exact admitted set for every offered filter, so each arm fails here
// first.
//
// The statuses are written out rather than parsed from the generator and
// validator: tests/member-directory-membership-vocabulary.test.mjs already
// owns the drift check that ties those copies together, and it fails if a
// fifth status appears without a filter that reaches it.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importSource } from './helpers-jsx.mjs';

const { matchesMembership } = await importSource(
  'src/components/MemberDirectory/utils.js',
);
const { MEMBERSHIP_FILTERS } = await importSource(
  'src/components/MemberDirectory/hooks.js',
);

// The vocabulary scripts/generate-members.mjs produces and
// scripts/validate-members.mjs accepts.
const STATUSES = ['member', 'contributor', 'member-and-contributor', 'unknown'];

// Which statuses each offered filter is required to admit. A filter arm that
// admits anything outside its entry is a filter that silently shows profiles
// the visitor asked to exclude.
const ADMITTED = new Map([
  ['member', ['member', 'member-and-contributor']],
  ['contributor', ['contributor', 'member-and-contributor']],
  ['unknown', ['unknown']],
]);

function admittedBy(filter, statuses = STATUSES) {
  return statuses.filter((status) => matchesMembership(status, filter));
}

test('every offered filter admits exactly its own statuses and no others', () => {
  for (const option of MEMBERSHIP_FILTERS) {
    const expected = ADMITTED.get(option.value);
    assert.ok(
      expected,
      `MEMBERSHIP_FILTERS offers "${option.value}", which this test does not ` +
        'pin. Add its exact admitted statuses to ADMITTED rather than ' +
        'widening the filter.',
    );
    assert.deepEqual(
      admittedBy(option.value),
      expected,
      `the "${option.value}" filter admits ${JSON.stringify(
        admittedBy(option.value),
      )} instead of ${JSON.stringify(expected)}; a filter that admits a ` +
        'status outside this set leaves the directory showing profiles the ' +
        'visitor filtered out.',
    );
  }
});

test('this file pins every filter the directory offers', () => {
  assert.deepEqual(
    MEMBERSHIP_FILTERS.map((option) => option.value).sort(),
    [...ADMITTED.keys()].sort(),
  );
});

test('each offered filter rejects at least one status', () => {
  // The property the existing reachability tests cannot express: a filter is
  // only a filter if some status fails it.
  for (const option of MEMBERSHIP_FILTERS) {
    const admitted = admittedBy(option.value);
    assert.ok(
      admitted.length < STATUSES.length,
      `the "${option.value}" filter admits every known status, so selecting ` +
        'it is indistinguishable from no filter at all.',
    );
  }
});

test('the dual-role status is the only status two filters share', () => {
  const sharedByBoth = STATUSES.filter(
    (status) =>
      matchesMembership(status, 'member') &&
      matchesMembership(status, 'contributor'),
  );
  assert.deepEqual(sharedByBoth, ['member-and-contributor']);
});

test('a status outside the vocabulary is admitted by no offered filter', () => {
  // An unrecognised status falls through to the `status === filter` arm, which
  // must not match any option the directory renders.
  for (const option of MEMBERSHIP_FILTERS) {
    assert.equal(
      matchesMembership('startup-partner', option.value),
      false,
      `the "${option.value}" filter admits an unrecognised status; the ` +
        'fallback arm must compare for equality, not merely return.',
    );
  }
});

test('an absent filter admits every status, including an unknown one', () => {
  const everything = [...STATUSES, 'startup-partner'];
  assert.deepEqual(admittedBy('', everything), everything);
  assert.deepEqual(admittedBy(undefined, everything), everything);
});
