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

test('warns, without failing, when fetchedAt exceeds the staleness threshold', () => {
  const stale = new Date(Date.now() - 46 * 86_400_000).toISOString();
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...freshData, fetchedAt: stale }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /exceeding the 45-day staleness threshold/);
});
