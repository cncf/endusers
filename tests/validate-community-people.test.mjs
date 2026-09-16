import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-community-people.mjs';

const validPerson = {
  name: 'Ada Lovelace',
  company: 'Analytical Engines Inc',
  role: 'TAB Chair',
  image: 'https://avatars.githubusercontent.com/u/1?v=4',
  github: 'ada',
};

const validRoster = {
  sections: {
    tab: [{ name: 'Ada Lovelace', github: 'ada' }],
    staff: [{ name: 'Ada Lovelace', github: 'ada' }],
  },
};

function peopleFixture({
  fetchedAt = new Date().toISOString(),
  roster = validRoster,
  tab = [validPerson],
  staff = [validPerson],
} = {}) {
  return {
    'data/community-people.json': JSON.stringify({
      fetchedAt,
      people: { tab, staff },
    }),
    'data/community-roster.json': JSON.stringify(roster),
  };
}

test('accepts fresh, well-formed community data', () => {
  const result = runScriptWithFixtures(SCRIPT, peopleFixture());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 2 community profiles/);
});

test('rejects a non-ISO fetchedAt', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    peopleFixture({ fetchedAt: 'not a date' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ISO 8601/);
});

test('rejects a non-ISO-8601 fetchedAt syntax that Date.parse would still accept', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    peopleFixture({ fetchedAt: 'March 1, 2026' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ISO 8601/);
});

test('rejects a future fetchedAt', () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const result = runScriptWithFixtures(
    SCRIPT,
    peopleFixture({ fetchedAt: futureDate }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /in the future/);
});

test('rejects stale data past the staleness threshold', () => {
  const staleDate = new Date(
    Date.now() - 60 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = runScriptWithFixtures(
    SCRIPT,
    peopleFixture({ fetchedAt: staleDate }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /staleness threshold/);
});

test('accepts data just inside the staleness threshold', () => {
  const recentDate = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = runScriptWithFixtures(
    SCRIPT,
    peopleFixture({ fetchedAt: recentDate }),
  );
  assert.equal(result.status, 0, result.stderr);
});

test('rejects an empty tab section', () => {
  const result = runScriptWithFixtures(SCRIPT, peopleFixture({ tab: [] }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tab must be a non-empty array/);
});

test('rejects a person missing a name', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    peopleFixture({ tab: [{ ...validPerson, name: undefined }] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing name/);
});

test('rejects a person with no public profile link', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    peopleFixture({
      tab: [
        {
          ...validPerson,
          github: undefined,
          linkedin: undefined,
          twitter: undefined,
          blog: undefined,
        },
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /public profile link/);
});

test('rejects tab data missing a roster member', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    peopleFixture({
      roster: {
        sections: {
          tab: [
            { name: 'Ada Lovelace', github: 'ada' },
            { name: 'Grace Hopper', github: 'grace' },
          ],
          staff: [{ name: 'Ada Lovelace', github: 'ada' }],
        },
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Grace Hopper is in the authoritative roster/);
});

test('rejects tab data with an extra, non-roster member', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    peopleFixture({
      tab: [validPerson, { ...validPerson, name: 'Not On Roster', github: 'nope' }],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /has 2 tab entries but the authoritative roster has 1/);
});
