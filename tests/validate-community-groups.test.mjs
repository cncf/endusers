import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-community-groups.mjs';

const validGroup = (overrides = {}) => ({
  slug: 'research',
  name: 'Research User Group',
  repository: 'https://github.com/cncf/research-user-group',
  archived: false,
  reachable: true,
  ...overrides,
});

function fixture(data) {
  return { 'data/community-groups.json': JSON.stringify(data) };
}

const validData = {
  checkedAt: new Date().toISOString(),
  groups: [validGroup()],
};

test('accepts a valid community groups file', () => {
  const result = runScriptWithFixtures(SCRIPT, fixture(validData));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 End User Group links/);
});

test('rejects a non-ISO checkedAt', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, checkedAt: 'not a date' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /checkedAt must be ISO 8601/);
});

test('rejects an empty groups array', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, groups: [] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-empty array/);
});

test('rejects a truthy non-array groups without crashing', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, groups: { research: validGroup() } }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-empty array/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});

test('rejects a duplicate slug', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, groups: [validGroup(), validGroup()] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate slug/);
});

test('rejects a non-URL repository', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      groups: [validGroup({ repository: 'not-a-url' })],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /absolute URL/);
});

test('warns, without failing, on an archived upstream repo', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, groups: [validGroup({ archived: true })] }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /upstream repository is archived/);
});

test('warns, without failing, on an unreachable upstream repo', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, groups: [validGroup({ reachable: false })] }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /could not be found/);
});

test('warns, without failing, when checkedAt exceeds the staleness interval', () => {
  const stale = new Date(Date.now() - 61 * 86_400_000).toISOString();
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, checkedAt: stale }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /exceeding the 60-day check interval/);
});
