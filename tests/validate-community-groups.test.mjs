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

// `checkedAt` is written by check-community-group-links.mjs from the machine
// that runs the refresh job. A clock skewed forward there would otherwise be
// read as "freshly checked" forever, since the staleness warning below only
// ever fires on positive ages.
test('rejects a checkedAt in the future', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      checkedAt: new Date(Date.now() + 86_400_000).toISOString(),
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /checkedAt cannot be in the future/);
  assert.doesNotMatch(result.stderr, /must be ISO 8601/);
});

// The future check is the `else` arm of the ISO parse, so the 60-second grace
// window is the only thing keeping an ordinary run from tripping it.
test('accepts a checkedAt inside the 60-second clock-skew grace window', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      checkedAt: new Date(Date.now() + 30_000).toISOString(),
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /cannot be in the future/);
});

test('rejects an empty groups array', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, groups: [] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-empty array/);
});

test('rejects a missing groups key', () => {
  const data = { ...validData };
  delete data.groups;
  const result = runScriptWithFixtures(SCRIPT, fixture(data));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-empty array/);
});

for (const field of ['slug', 'name', 'repository']) {
  test(`rejects a group with no ${field}`, () => {
    const group = validGroup();
    delete group[field];
    const result = runScriptWithFixtures(
      SCRIPT,
      fixture({ ...validData, groups: [group] }),
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /group requires slug, name, and repository/);
  });
}

// `label` is the only handle a maintainer has on the offending record, and it
// falls back twice. Assert both fallbacks rather than just the message.
test('labels a slugless group by its name', () => {
  const group = validGroup();
  delete group.slug;
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, groups: [group] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Research User Group/);
  assert.doesNotMatch(result.stderr, /unknown group/);
});

test('labels a group with neither slug nor name as "unknown group"', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      groups: [{ repository: 'https://github.com/cncf/research-user-group' }],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown group/);
});

// A group missing `repository` must not also be reported as a bad URL: the
// `if (group.repository)` guard inside the try is what keeps the two errors
// from stacking on one record.
test('reports a repository-less group once, not also as a bad URL', () => {
  const group = validGroup();
  delete group.repository;
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, groups: [group] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /group requires slug, name, and repository/);
  assert.doesNotMatch(result.stderr, /absolute URL/);
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
