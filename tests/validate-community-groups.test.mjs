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

// `null` rather than absent or malformed, because it is the one value whose
// rejection the rendering argument depends on and the other two cases do not
// imply.
//
// GroupLinkStatus passes `groupsData?.checkedAt` straight to the shared
// formatDate (src/components/GroupLinkStatus/index.js), and its optional
// chaining guards a missing object, not a null field. `new Date(null)` coerces
// to 0 rather than to an invalid date, so a null that reached the committed
// file would render the epoch in a line that is meant to disappear.
// tests/format-date.test.mjs pins that formatting and names this validator as
// what keeps the value out; this is the assertion on the other end of that
// argument.
//
// Worth asserting here rather than assuming it from the non-ISO case above:
// `checkedAt` is gated by checkIsoTimestamp(), whose strict pattern runs over
// `value ?? ''`, and a gate written instead around `Date.parse` or a
// truthiness test would treat an explicit null differently from the string
// this file already rejects.
test('rejects a null checkedAt, which would otherwise render as the epoch', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, checkedAt: null }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /checkedAt must be ISO 8601/);
  assert.doesNotMatch(result.stderr, /TypeError/);
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
// `group.repository &&` guard on the URL check is what keeps the two errors
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
  assert.doesNotMatch(result.stderr, /no userinfo/);
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
  assert.match(result.stderr, /https github\.com URL/);
});

// A bare `new URL()` parse accepts every value below. The repository link is
// published data one component change away from an <a href>, so the gate has
// to decide the destination by parsing rather than by parseability alone.
for (const [description, repository] of [
  ['a javascript: scheme', 'javascript:alert(1)'],
  ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
  ['a cleartext http URL', 'http://github.com/cncf/research-user-group'],
  [
    'a userinfo-spoofed authority',
    'https://github.com@evil.example/cncf/research-user-group',
  ],
  ['a host that merely ends in the allowed name', 'https://notgithub.com/x'],
  ['a subdomain of the allowed host', 'https://raw.github.com/cncf/x'],
  ['a whitespace-only repository', '   '],
]) {
  test(`rejects ${description}`, () => {
    const result = runScriptWithFixtures(
      SCRIPT,
      fixture({ ...validData, groups: [validGroup({ repository })] }),
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /https github\.com URL/);
  });
}

// Trailing whitespace is a copy-paste artefact, not a different destination:
// the gate trims before parsing so a valid link is not rejected over it.
test('accepts a repository with surrounding whitespace', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      groups: [
        validGroup({
          repository: '  https://github.com/cncf/research-user-group  ',
        }),
      ],
    }),
  );
  assert.equal(result.status, 0, result.stderr);
});

// `hostname` is already lowercased by the URL parser, but the explicit
// toLowerCase() in the gate is what keeps that true if the comparison ever
// moves to a raw host string.
test('accepts an uppercase host', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      groups: [
        validGroup({
          repository: 'https://GitHub.com/cncf/research-user-group',
        }),
      ],
    }),
  );
  assert.equal(result.status, 0, result.stderr);
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
