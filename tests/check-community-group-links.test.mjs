import assert from 'node:assert/strict';
import test from 'node:test';

import { runScriptWithFetchMock } from './helpers-fetch-mock.mjs';

const OUTPUT = 'data/community-groups.json';
const PUBLIC_SECTOR = 'repos/cncf/public-sector-user-group';
const TELECOM = 'repos/cncf/telecom-user-group';

// The script writes straight into data/ without creating it, so the sandbox
// has to start from an existing (stale) report the same way the repo does.
const STALE_REPORT = JSON.stringify({ checkedAt: '2000-01-01T00:00:00.000Z' });

function run(routes) {
  return runScriptWithFetchMock({
    script: 'check-community-group-links.mjs',
    fixtures: { [OUTPUT]: STALE_REPORT },
    routes,
    outputs: [OUTPUT],
  });
}

function parseOutput(result) {
  assert.equal(result.status, 0, `script failed:\n${result.stderr}`);
  const raw = result.outputs[OUTPUT];
  assert.ok(raw, `expected the script to write ${OUTPUT}`);
  return JSON.parse(raw);
}

function bySlug(output, slug) {
  const group = output.groups.find((candidate) => candidate.slug === slug);
  assert.ok(group, `expected a group entry for ${slug}`);
  return group;
}

function live(match) {
  return { match, body: { archived: false } };
}

test('records every configured group as healthy when both repos are live', () => {
  const result = run([live(PUBLIC_SECTOR), live(TELECOM)]);
  const output = parseOutput(result);

  assert.equal(output.groups.length, 2);
  assert.deepEqual(
    output.groups.map((group) => group.slug),
    ['public-sector', 'telecom'],
  );
  for (const group of output.groups) {
    assert.equal(group.archived, false);
    assert.equal(group.reachable, true);
  }
  assert.match(result.stdout, /Checked 2 End User Group upstream repositories/);
  // A clean run must not append the attention suffix, which the freshness UI
  // copy and reviewers read as "nothing to do".
  assert.doesNotMatch(result.stdout, /need attention/);
  assert.equal(result.stderr, '');
});

test('derives the repository URL and slug/name pairs from the group table', () => {
  const output = parseOutput(run([live(PUBLIC_SECTOR), live(TELECOM)]));

  assert.deepEqual(bySlug(output, 'public-sector'), {
    slug: 'public-sector',
    name: 'Public Sector User Group',
    repository: 'https://github.com/cncf/public-sector-user-group',
    archived: false,
    reachable: true,
  });
  assert.deepEqual(bySlug(output, 'telecom'), {
    slug: 'telecom',
    name: 'Telecom User Group',
    repository: 'https://github.com/cncf/telecom-user-group',
    archived: false,
    reachable: true,
  });
});

test('writes a parseable ISO checkedAt envelope terminated by a newline', () => {
  const result = run([live(PUBLIC_SECTOR), live(TELECOM)]);
  const raw = result.outputs[OUTPUT];

  assert.ok(raw.endsWith('\n'), 'expected a trailing newline');
  const { checkedAt } = JSON.parse(raw);
  assert.match(checkedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(
    Number.isFinite(Date.parse(checkedAt)),
    'checkedAt must parse as a date',
  );
  // The report is replaced, never merged, so the previous timestamp is gone.
  assert.notEqual(checkedAt, '2000-01-01T00:00:00.000Z');
});

test('flags an archived upstream repository as stale', () => {
  const result = run([
    { match: PUBLIC_SECTOR, body: { archived: true } },
    live(TELECOM),
  ]);
  const output = parseOutput(result);

  const stale = bySlug(output, 'public-sector');
  assert.equal(stale.archived, true);
  // Archived repositories still respond, so reachable stays true and only the
  // archived flag distinguishes them from a rename.
  assert.equal(stale.reachable, true);
  assert.equal(bySlug(output, 'telecom').archived, false);

  assert.match(
    result.stderr,
    /Public Sector User Group \(cncf\/public-sector-user-group\) is archived upstream\./,
  );
  assert.match(result.stdout, /\(1 need attention\)/);
});

test('flags a 404 upstream repository as missing or renamed', () => {
  const result = run([
    live(PUBLIC_SECTOR),
    { match: TELECOM, status: 404, body: {} },
  ]);
  const output = parseOutput(result);

  const missing = bySlug(output, 'telecom');
  assert.equal(missing.reachable, false);
  // The body is never read for a 404, so archived must stay null rather than
  // reporting a false "not archived".
  assert.equal(missing.archived, null);

  assert.match(
    result.stderr,
    /Telecom User Group \(cncf\/telecom-user-group\) is missing\/renamed upstream\./,
  );
  assert.match(result.stdout, /\(1 need attention\)/);
});

test('treats a non-404 error response as an inconclusive check, not a failure', () => {
  const result = run([
    live(PUBLIC_SECTOR),
    { match: TELECOM, status: 500, body: {} },
  ]);
  const output = parseOutput(result);

  const unknown = bySlug(output, 'telecom');
  // null reachable means "could not determine", which must not be conflated
  // with the false that marks a genuinely missing repository.
  assert.equal(unknown.reachable, null);
  assert.equal(unknown.archived, null);

  assert.match(
    result.stderr,
    /Could not check cncf\/telecom-user-group: GitHub returned 500/,
  );
  // An inconclusive result is not stale, so it must not inflate the count.
  assert.doesNotMatch(result.stdout, /need attention/);
});

test('survives a transport-level failure and still writes the other groups', () => {
  const result = run([
    { match: PUBLIC_SECTOR, networkError: 'socket hang up' },
    live(TELECOM),
  ]);
  const output = parseOutput(result);

  assert.equal(bySlug(output, 'public-sector').reachable, null);
  assert.equal(bySlug(output, 'telecom').reachable, true);
  assert.match(
    result.stderr,
    /Could not check cncf\/public-sector-user-group: socket hang up/,
  );
});

test('reports every stale group in a single run', () => {
  const result = run([
    { match: PUBLIC_SECTOR, body: { archived: true } },
    { match: TELECOM, status: 404, body: {} },
  ]);
  const output = parseOutput(result);

  assert.equal(bySlug(output, 'public-sector').archived, true);
  assert.equal(bySlug(output, 'telecom').reachable, false);
  assert.match(result.stdout, /\(2 need attention\)/);
});

test('coerces a truthy non-boolean archived field to a boolean', () => {
  const result = run([
    { match: PUBLIC_SECTOR, body: { archived: 'yes' } },
    live(TELECOM),
  ]);
  const output = parseOutput(result);

  // The consumers in data/community-groups.json and the freshness UI expect a
  // strict boolean, never whatever the API happened to send.
  assert.equal(bySlug(output, 'public-sector').archived, true);
});
