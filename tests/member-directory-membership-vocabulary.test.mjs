// The membership status vocabulary is written out four times, and until this
// file nothing tied the copies together:
//
//   1. `membershipStatus()` in scripts/generate-members.mjs PRODUCES a status
//      for every member written to data/members.json.
//   2. `MEMBERSHIP_STATUSES` in scripts/validate-members.mjs ACCEPTS a status.
//   3. `membershipLabel()` in src/components/MemberDirectory/utils.js names a
//      status on the card and in the profile dialog.
//   4. `MEMBERSHIP_FILTERS` in src/components/MemberDirectory/hooks.js offers
//      the directory's membership filter options, resolved through
//      `matchesMembership()`.
//
// tests/member-directory.test.mjs asserts (3) and (4) against the same four
// string literals they are built from, so it cannot notice a fifth status
// arriving in (1) or (2). That failure is silent rather than loud: an
// unrecognised status falls through `membershipLabel`'s `default:` and is
// displayed as "Membership not specified", and `matchesMembership` leaves it
// unreachable from every offered filter — the member disappears from the
// directory whenever any membership filter is active, with no error anywhere.
//
// (1) and (2) are read out of the script sources rather than imported: neither
// module exports its vocabulary, and running them would require a landscape
// snapshot. Parsing is narrow and asserts its own match, so moving or renaming
// either declaration fails this test instead of silently checking nothing.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { importSource } from './helpers-jsx.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const { membershipLabel, matchesMembership } = await importSource(
  'src/components/MemberDirectory/utils.js',
);
const { MEMBERSHIP_FILTERS } = await importSource(
  'src/components/MemberDirectory/hooks.js',
);

const UNRECOGNISED_LABEL = 'Membership not specified';

function readScript(name) {
  return readFileSync(join(repoRoot, 'scripts', name), 'utf8');
}

function quotedLiterals(text) {
  return [...text.matchAll(/'([a-z][a-z-]*)'/g)].map((match) => match[1]);
}

// The statuses scripts/validate-members.mjs will accept in data/members.json.
function acceptedStatuses() {
  const source = readScript('validate-members.mjs');
  const declaration =
    /const MEMBERSHIP_STATUSES = new Set\(\[([^\]]*)\]\)/.exec(source);
  assert.ok(
    declaration,
    'scripts/validate-members.mjs no longer declares MEMBERSHIP_STATUSES as a ' +
      'Set of string literals; update this test to read the new declaration.',
  );
  const statuses = quotedLiterals(declaration[1]);
  assert.ok(
    statuses.length > 0,
    'MEMBERSHIP_STATUSES parsed as empty; the parse is no longer meaningful.',
  );
  return statuses;
}

// The statuses scripts/generate-members.mjs can write to data/members.json.
function producedStatuses() {
  const source = readScript('generate-members.mjs');
  const body = /\nfunction membershipStatus\([^)]*\) \{\n([\s\S]*?)\n\}\n/.exec(
    source,
  );
  assert.ok(
    body,
    'scripts/generate-members.mjs no longer declares a top-level ' +
      'membershipStatus() function; update this test to read its replacement.',
  );
  const statuses = [...body[1].matchAll(/return '([a-z][a-z-]*)';/g)].map(
    (match) => match[1],
  );
  assert.ok(
    statuses.length > 0,
    'membershipStatus() parsed as returning no string literals; the parse is ' +
      'no longer meaningful.',
  );
  return statuses;
}

const ACCEPTED = acceptedStatuses();
const PRODUCED = producedStatuses();
const FILTER_VALUES = MEMBERSHIP_FILTERS.map((option) => option.value);

test('the generator produces exactly the statuses the validator accepts', () => {
  assert.deepEqual([...PRODUCED].sort(), [...ACCEPTED].sort());
});

test('every accepted status gets a label of its own', () => {
  const labels = new Map();
  for (const status of ACCEPTED) {
    const label = membershipLabel(status);
    assert.equal(
      labels.has(label),
      false,
      `membershipLabel() gives "${label}" to both "${labels.get(label)}" and ` +
        `"${status}"; a status with no case of its own falls through to the ` +
        `default and is displayed as "${UNRECOGNISED_LABEL}".`,
    );
    labels.set(label, status);
  }
  // The fallback is a label the directory is allowed to show, but only for the
  // status that means it. Any other status reaching it is the silent failure.
  assert.equal(labels.get(UNRECOGNISED_LABEL), 'unknown');
});

test('every accepted status is reachable from an offered filter', () => {
  for (const status of ACCEPTED) {
    const reachable = FILTER_VALUES.filter((value) =>
      matchesMembership(status, value),
    );
    assert.ok(
      reachable.length > 0,
      `no option in MEMBERSHIP_FILTERS matches the "${status}" status, so a ` +
        'member carrying it is hidden whenever a membership filter is active.',
    );
  }
});

test('every offered filter matches at least one accepted status', () => {
  for (const value of FILTER_VALUES) {
    const matched = ACCEPTED.filter((status) =>
      matchesMembership(status, value),
    );
    assert.ok(
      matched.length > 0,
      `the "${value}" membership filter matches no status the generator can ` +
        'produce, so selecting it always empties the directory.',
    );
  }
});

test('membership filter options are distinct and labelled', () => {
  assert.deepEqual([...new Set(FILTER_VALUES)], FILTER_VALUES);
  const labels = MEMBERSHIP_FILTERS.map((option) => option.label);
  assert.deepEqual([...new Set(labels)], labels);
  for (const label of labels) assert.equal(typeof label, 'string');
});

test('the unfiltered directory keeps every accepted status', () => {
  for (const status of ACCEPTED) {
    assert.equal(matchesMembership(status, ''), true);
  }
});
