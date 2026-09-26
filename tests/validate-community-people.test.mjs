import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-community-people.mjs';

const roster = {
  sections: {
    tab: [{ name: 'Ada Lovelace', github: 'ada' }],
    staff: [{ name: 'Grace Hopper', github: 'grace' }],
  },
};

const validPerson = (overrides = {}) => ({
  name: 'Ada Lovelace',
  github: 'ada',
  image: 'https://avatars.githubusercontent.com/u/1',
  linkedin: null,
  twitter: null,
  blog: '',
  ...overrides,
});

const staffPerson = (overrides = {}) => ({
  name: 'Grace Hopper',
  github: 'grace',
  image: 'https://avatars.githubusercontent.com/u/2',
  ...overrides,
});

function fixture(data, rosterOverride = roster) {
  return {
    'data/community-people.json': JSON.stringify(data),
    'data/community-roster.json': JSON.stringify(rosterOverride),
  };
}

const freshData = {
  fetchedAt: new Date().toISOString(),
  people: { tab: [validPerson()], staff: [staffPerson()] },
};

test('accepts a fresh file matching the roster', () => {
  const result = runScriptWithFixtures(SCRIPT, fixture(freshData));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 2 community profiles/);
});

test('rejects a non-ISO fetchedAt', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...freshData, fetchedAt: 'March 1, 2026' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /strict ISO 8601/);
});

test('rejects a future-dated fetchedAt', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...freshData, fetchedAt: future }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot be in the future/);
});

test('rejects a generated file missing a roster member', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...freshData, people: { tab: [], staff: [staffPerson()] } }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing roster member Ada Lovelace/);
});

test('rejects a generated person not on the roster', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: {
        tab: [
          validPerson(),
          validPerson({ name: 'Imposter', github: 'imposter' }),
        ],
        staff: [staffPerson()],
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Imposter is not on the roster/);
});

test('rejects a person with no public profile link', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: {
        tab: [
          validPerson({
            github: null,
            linkedin: null,
            twitter: null,
            blog: '',
          }),
        ],
        staff: [staffPerson()],
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no public profile link/);
});

// The per-person field guards below run against a generated file this repo
// does not author: data/community-people.json is refreshed unattended from
// cncf/people. Each guard is the only thing standing between a malformed or
// hostile upstream record and a rendered <img src> / name on the community
// page, and none of them had been exercised.

test('rejects a person with an empty name', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: { tab: [validPerson({ name: '' })], staff: [staffPerson()] },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /person missing name/);
  // The roster match is by GitHub handle, so a nameless record is still
  // recognised as the roster member rather than reported as an imposter.
  assert.doesNotMatch(result.stderr, /is not on the roster/);
});

test('rejects a person with a missing image', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: { tab: [validPerson({ image: '' })], staff: [staffPerson()] },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Ada Lovelace missing image/);
  // A person with no image at all must not also be reported for the host
  // gate — the two branches are exclusive.
  assert.doesNotMatch(result.stderr, /allowed host/);
});

test('names the person as "person" when both the name and the image are missing', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: {
        tab: [validPerson({ name: '', image: '' })],
        staff: [staffPerson()],
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /person missing image/);
});

test('rejects an image on a host outside the allowlist', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: {
        tab: [validPerson({ image: 'https://evil.example/ada.png' })],
        staff: [staffPerson()],
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Ada Lovelace image must be an https URL on an allowed host/,
  );
  // The offending value is echoed so a maintainer can see what was rejected
  // without opening the generated file.
  assert.match(result.stderr, /https:\/\/evil\.example\/ada\.png/);
});

test('rejects a plain-http image on an otherwise allowed host', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: {
        tab: [
          validPerson({ image: 'http://avatars.githubusercontent.com/u/1' }),
        ],
        staff: [staffPerson()],
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be an https URL on an allowed host/);
});

test('rejects an image URL carrying userinfo that reads as an allowed host', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: {
        tab: [
          validPerson({ image: 'https://www.cncf.io@evil.example/ada.png' }),
        ],
        staff: [staffPerson()],
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be an https URL on an allowed host/);
});

test('accepts an image on an allowed cncf.io subdomain', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: {
        tab: [validPerson({ image: 'https://assets.cncf.io/ada.png' })],
        staff: [staffPerson()],
      },
    }),
  );
  assert.equal(result.status, 0, result.stderr);
});

test('warns, without failing, when fetchedAt exceeds the staleness threshold', () => {
  const stale = new Date(Date.now() - 46 * 86_400_000).toISOString();
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...freshData, fetchedAt: stale }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /exceeding the 45-day staleness threshold/);
});

// The generated file is written by fetch-community-people.mjs, which can fail
// partway and leave a structurally incomplete file behind. Each assertion
// below pins one defensive fallback in the validator: every one of them keeps
// a malformed file on the reporting path instead of crashing the gate with a
// TypeError, which would hide the real problem behind a stack trace.

test('reports a missing fetchedAt instead of crashing on an absent field', () => {
  const { fetchedAt: _omitted, ...withoutFetchedAt } = freshData;
  const result = runScriptWithFixtures(SCRIPT, fixture(withoutFetchedAt));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /strict ISO 8601/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});

test('rejects a generated section the roster does not declare', () => {
  const result = runScriptWithFixtures(SCRIPT, fixture(freshData, {}));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /people\.tab.*section is not declared in community-roster\.json/,
  );
  assert.match(
    result.stderr,
    /people\.staff.*section is not declared in community-roster\.json/,
  );
});

// The hole this guards: a section present only in the generated file used to
// skip the loop body entirely, so its members reached <img src> with no host
// check at all.
test('gates images in a generated section the roster does not declare', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: {
        ...freshData.people,
        ambassadors: [
          validPerson({
            name: 'Probe',
            github: 'probe',
            image: 'https://evil.example/beacon.png',
          }),
        ],
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /people\.ambassadors.*section is not declared in community-roster\.json/,
  );
  assert.match(
    result.stderr,
    /Probe image must be an https URL on an allowed host/,
  );
});

// A section the roster does not declare is reported once, as a section error,
// rather than once per member as "is not on the roster".
test('does not repeat the roster-membership error for an undeclared section', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: { ...freshData.people, ambassadors: [validPerson()] },
    }),
  );
  assert.equal(result.status, 1);
  assert.doesNotMatch(
    result.stderr,
    /people\.ambassadors.*is not on the roster/,
  );
});

test('still cross-checks roster membership within a declared section', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: {
        tab: [validPerson(), validPerson({ name: 'Mallory', github: 'mal' })],
        staff: [staffPerson()],
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Mallory is not on the roster/);
});

test('treats a declared roster section with no entries as empty', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture(
      { ...freshData, people: { ...freshData.people, alumni: [] } },
      { sections: { ...roster.sections, alumni: null } },
    ),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /TypeError/);
});

test('treats a section absent from the generated file as empty', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...freshData, people: { tab: [validPerson()] } }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing roster member Grace Hopper/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});

test('names an unnamed person "person" when rejecting a disallowed image', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: {
        tab: [validPerson({ name: '', image: 'http://example.com/ada.png' })],
        staff: [staffPerson()],
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /person image must be an https URL on an allowed host/,
  );
});

test('names an unnamed person "person" when rejecting a profile with no links', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...freshData,
      people: {
        tab: [
          validPerson({
            name: '',
            github: '',
            linkedin: null,
            twitter: null,
            blog: '',
          }),
        ],
        staff: [staffPerson()],
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /person has no public profile link/);
});

test('counts zero profiles when the generated file carries no people at all', () => {
  const { people: _omitted, ...withoutPeople } = freshData;
  const result = runScriptWithFixtures(SCRIPT, fixture(withoutPeople, {}));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 0 community profiles/);
});
