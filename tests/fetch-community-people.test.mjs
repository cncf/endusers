import assert from 'node:assert/strict';
import test from 'node:test';

import { runScriptWithFetchMock } from './helpers-fetch-mock.mjs';

const OUTPUT = 'data/community-people.json';
const ROSTER = 'data/community-roster.json';

function roster(sections, fallbackImages = {}) {
  return JSON.stringify({ sections, fallbackImages });
}

function run({ fixtures, routes = [] }) {
  return runScriptWithFetchMock({
    script: 'fetch-community-people.mjs',
    fixtures,
    routes,
    outputs: [OUTPUT],
  });
}

function parseOutput(result) {
  assert.equal(result.status, 0, `script failed:\n${result.stderr}`);
  const raw = result.outputs[OUTPUT];
  assert.ok(raw, 'expected the script to write data/community-people.json');
  return JSON.parse(raw);
}

test('builds profiles from roster data alone when no GitHub handle is set', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [
          { name: 'Ada Lovelace', company: 'Analytical Co', role: 'Chair' },
        ],
      }),
    },
  });

  const output = parseOutput(result);
  assert.deepEqual(Object.keys(output.people), ['tab']);
  assert.equal(output.people.tab.length, 1);

  const person = output.people.tab[0];
  assert.equal(person.name, 'Ada Lovelace');
  assert.equal(person.company, 'Analytical Co');
  assert.equal(person.role, 'Chair');
  assert.equal(person.github, undefined);
  // With no handle and no fallback image the script must emit an empty string
  // rather than a broken https://github.com/undefined.png URL.
  assert.equal(person.image, '');
  assert.equal(person.bio, '');
  assert.equal(person.publicRepos, 0);
  assert.equal(person.followers, 0);
  assert.equal(person.profileUpdatedAt, null);
});

test('writes a fetchedAt envelope with sections keyed under people', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [{ name: 'Ada Lovelace' }],
        ambassadors: [{ name: 'Grace Hopper' }],
      }),
    },
  });

  const output = parseOutput(result);
  assert.match(output.fetchedAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  assert.ok(!Number.isNaN(Date.parse(output.fetchedAt)));
  assert.deepEqual(Object.keys(output.people), ['tab', 'ambassadors']);
  assert.equal(output.people.ambassadors[0].name, 'Grace Hopper');
});

test('prefers live GitHub profile fields over roster defaults', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [{ name: 'Roster Name', company: 'Roster Co', github: 'ada' }],
      }),
    },
    routes: [
      {
        match: '/users/ada',
        body: {
          name: 'Ada Lovelace',
          company: '@Analytical',
          bio: 'Computing pioneer',
          location: 'London',
          avatar_url: 'https://avatars.example/ada.png',
          blog: 'https://ada.example',
          public_repos: 12,
          followers: 3400,
          updated_at: '2026-01-02T03:04:05Z',
        },
      },
    ],
  });

  const person = parseOutput(result).people.tab[0];
  assert.equal(person.name, 'Ada Lovelace');
  // cleanCompany strips the leading @ that GitHub uses for org handles.
  assert.equal(person.company, 'Analytical');
  assert.equal(person.bio, 'Computing pioneer');
  assert.equal(person.location, 'London');
  assert.equal(person.image, 'https://avatars.example/ada.png');
  assert.equal(person.blog, 'https://ada.example');
  assert.equal(person.publicRepos, 12);
  assert.equal(person.followers, 3400);
  assert.equal(person.profileUpdatedAt, '2026-01-02T03:04:05Z');
});

test('keeps roster name and company when the GitHub profile omits them', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [{ name: 'Roster Name', company: 'Roster Co', github: 'ada' }],
      }),
    },
    routes: [
      {
        match: '/users/ada',
        // A GitHub user with no display name or company set returns nulls.
        body: {
          name: null,
          company: null,
          avatar_url: 'https://a.example/x.png',
        },
      },
    ],
  });

  const person = parseOutput(result).people.tab[0];
  assert.equal(person.name, 'Roster Name');
  assert.equal(person.company, 'Roster Co');
});

test('preserves a genuine zero for repo and follower counts', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({ tab: [{ name: 'New Member', github: 'newbie' }] }),
    },
    routes: [
      {
        match: '/users/newbie',
        body: { public_repos: 0, followers: 0 },
      },
    ],
  });

  const person = parseOutput(result).people.tab[0];
  // These use ?? rather than ||, so a real zero must survive rather than
  // falling through to the roster/previous defaults.
  assert.equal(person.publicRepos, 0);
  assert.equal(person.followers, 0);
});

test('falls back to roster data and warns when the GitHub API errors', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [
          { name: 'Ada Lovelace', company: 'Analytical Co', github: 'ada' },
        ],
      }),
    },
    routes: [{ match: '/users/ada', status: 404 }],
  });

  const output = parseOutput(result);
  const person = output.people.tab[0];
  assert.equal(person.name, 'Ada Lovelace');
  assert.equal(person.company, 'Analytical Co');
  // Without a profile the avatar is derived from the handle.
  assert.equal(person.image, 'https://github.com/ada.png');
  assert.match(
    result.stderr,
    /Could not refresh Ada Lovelace: GitHub returned 404/,
  );
  assert.match(result.stdout, /\(1 fallback\)/);
});

test('reports a network failure as a fallback without aborting the run', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [
          { name: 'Ada Lovelace', github: 'ada' },
          { name: 'Grace Hopper' },
        ],
      }),
    },
    routes: [{ match: '/users/ada', networkError: 'socket hang up' }],
  });

  const output = parseOutput(result);
  assert.equal(output.people.tab.length, 2);
  assert.match(result.stderr, /Could not refresh Ada Lovelace: socket hang up/);
  assert.match(result.stdout, /Refreshed 2 community profiles \(1 fallback\)/);
});

test('pluralises the fallback count across multiple failures', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [
          { name: 'Ada Lovelace', github: 'ada' },
          { name: 'Grace Hopper', github: 'grace' },
        ],
      }),
    },
    routes: [
      { match: '/users/ada', status: 500 },
      { match: '/users/grace', status: 500 },
    ],
  });

  assert.equal(parseOutput(result).people.tab.length, 2);
  assert.match(result.stdout, /Refreshed 2 community profiles \(2 fallbacks\)/);
});

test('uses fallbackImages for people without a GitHub handle', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster(
        { tab: [{ name: 'Grace Hopper' }] },
        { 'Grace Hopper': 'https://images.example/grace.png' },
      ),
    },
  });

  const person = parseOutput(result).people.tab[0];
  assert.equal(person.image, 'https://images.example/grace.png');
});

test('normalises optional social links to null when absent', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [
          {
            name: 'Ada Lovelace',
            linkedin: 'https://linkedin.example/ada',
          },
        ],
      }),
    },
  });

  const person = parseOutput(result).people.tab[0];
  assert.equal(person.linkedin, 'https://linkedin.example/ada');
  assert.equal(person.twitter, null);
  assert.equal(person.role, null);
});

test('emits an empty section array when a roster section has no entries', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({ tab: [{ name: 'Ada Lovelace' }], alumni: [] }),
    },
  });

  const output = parseOutput(result);
  assert.deepEqual(output.people.alumni, []);
  assert.match(output.fetchedAt, /T/);
});

// CHARACTERIZATION TEST — asserts current, known-incorrect behaviour.
//
// The script writes { fetchedAt, people: { <section>: [...] } } but reads the
// previous run back as existing[section] rather than existing.people[section].
// The lookup never matches, so the last-known-good cache is dead code and an
// API failure resets each profile to a roster stub instead of retaining the
// prior values. Tracked in the issue "fetch-community-people.mjs:
// last-known-good cache never engages".
//
// When that defect is fixed this test will fail. That is intended: replace the
// assertions below with the cached values noted in each comment.
test('currently discards the previous run when the API fails (known defect)', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [{ name: 'Ada', company: 'Roster Co', github: 'ada' }],
      }),
      [OUTPUT]: JSON.stringify({
        fetchedAt: '2020-01-01T00:00:00.000Z',
        people: {
          tab: [
            {
              name: 'Ada Lovelace',
              company: 'Cached Co',
              github: 'ada',
              bio: 'cached bio',
              location: 'London',
              followers: 42,
              publicRepos: 7,
            },
          ],
        },
      }),
    },
    routes: [{ match: '/users/ada', status: 403 }],
  });

  const person = parseOutput(result).people.tab[0];
  assert.equal(person.bio, ''); // once fixed: 'cached bio'
  assert.equal(person.location, ''); // once fixed: 'London'
  assert.equal(person.followers, 0); // once fixed: 42
  assert.equal(person.publicRepos, 0); // once fixed: 7
  assert.equal(person.company, 'Roster Co'); // once fixed: 'Cached Co'
  assert.equal(person.name, 'Ada'); // once fixed: 'Ada Lovelace'
});
