import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'fetch-community-people.mjs';

// Mirrors the GITHUB_HANDLE predicate in scripts/fetch-community-people.mjs.
const GITHUB_HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

function roster(entries) {
  return JSON.stringify({ sections: { tab: entries }, fallbackImages: {} });
}

// Every entry here has github: null, so the script reaches the end without
// issuing a network request; only the rejected handle decides the exit status.
function rosterWithBadHandle(handle) {
  return roster([
    { name: 'No Handle', company: 'Example', role: 'Member', github: null },
    { name: 'Crafted', company: 'Example', role: 'Member', github: handle },
  ]);
}

// Non-empty values only: '' is falsy and the script has always treated it the
// same as an absent handle, which the null-handle test below covers.
const HOSTILE_HANDLES = [
  '../../orgs/evil',
  '../user-events',
  'castrojo/received_events',
  'x?foo=1',
  'x#frag',
  'https://evil.com/x',
  '-leading-hyphen',
  'trailing-hyphen-',
  'double--hyphen',
];

for (const handle of HOSTILE_HANDLES) {
  test(`rejects roster handle ${JSON.stringify(handle)} before fetching`, () => {
    const result = runScriptWithFixtures(SCRIPT, {
      'data/community-roster.json': rosterWithBadHandle(handle),
    });
    assert.equal(
      result.status,
      1,
      `expected a non-zero exit for ${JSON.stringify(handle)}, got ${result.status}: ${result.stderr}`,
    );
    assert.match(result.stderr, /invalid GitHub handle/);
    assert.doesNotMatch(
      result.stdout,
      /Refreshed/,
      'script must fail closed rather than write community-people.json',
    );
  });
}

test('a roster of null handles completes without any network request', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    'data/community-roster.json': roster([
      { name: 'No Handle', company: 'Example', role: 'Member', github: null },
    ]),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Refreshed 1 community profile/);
});

test('every handle in the committed roster satisfies the predicate', () => {
  const data = JSON.parse(
    readFileSync(new URL('../data/community-roster.json', import.meta.url)),
  );
  for (const [section, entries] of Object.entries(data.sections)) {
    for (const entry of entries) {
      if (!entry.github) continue;
      assert.ok(
        GITHUB_HANDLE.test(entry.github),
        `${section}/${entry.name} has a handle the fetch script would now reject: ${entry.github}`,
      );
    }
  }
});

test('the predicate keeps the request on the /users/<handle> endpoint', () => {
  for (const handle of [...HOSTILE_HANDLES, '']) {
    assert.equal(
      GITHUB_HANDLE.test(handle),
      false,
      `${handle} must not be accepted`,
    );
  }
  for (const handle of ['castrojo', 'KentaTada', 'a', 'a-b-c', 'a1']) {
    assert.ok(GITHUB_HANDLE.test(handle), `${handle} must stay accepted`);
    const url = new URL(
      `https://api.github.com/users/${encodeURIComponent(handle)}`,
    );
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(url.pathname, `/users/${handle}`);
  }
});
