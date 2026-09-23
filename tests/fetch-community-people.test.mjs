import assert from 'node:assert/strict';
import test from 'node:test';

import { runScriptWithFetchMock } from './helpers-fetch-mock.mjs';

const OUTPUT = 'data/community-people.json';
const ROSTER = 'data/community-roster.json';
const PEOPLE_MATCH = 'raw.githubusercontent.com/cncf/people/main/people.json';

function roster(sections, fallbackImages = {}) {
  return JSON.stringify({ sections, fallbackImages });
}

function peopleRoute(records) {
  return { match: PEOPLE_MATCH, body: records };
}

function run({ fixtures, records = [], routes = [] }) {
  return runScriptWithFetchMock({
    script: 'fetch-community-people.mjs',
    fixtures,
    routes: [peopleRoute(records), ...routes],
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

test('fills in bio, location, image and links from a matching cncf/people record', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [{ name: 'Roster Name', company: 'Roster Co', github: 'ada' }],
      }),
    },
    records: [
      {
        name: 'Ada Lovelace',
        company: 'Analytical Engines',
        bio: 'Computing pioneer',
        location: 'London',
        github: 'https://github.com/ada',
        linkedin: 'https://www.linkedin.com/in/ada-lovelace',
        twitter: 'https://twitter.com/ada',
        website: 'https://ada.example',
        image: 'ada.jpg',
      },
    ],
  });

  const person = parseOutput(result).people.tab[0];
  // Roster name/company stay authoritative even when cncf/people has values.
  assert.equal(person.name, 'Roster Name');
  assert.equal(person.company, 'Roster Co');
  assert.equal(person.bio, 'Computing pioneer');
  assert.equal(person.location, 'London');
  assert.equal(
    person.image,
    'https://raw.githubusercontent.com/cncf/people/main/images/ada.jpg',
  );
  assert.equal(person.linkedin, 'ada-lovelace');
  assert.equal(person.twitter, 'ada');
  assert.equal(person.blog, 'https://ada.example');
});

test('matches cncf/people handles case-insensitively', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [{ name: 'Ada Lovelace', github: 'Ada' }],
      }),
    },
    records: [
      {
        name: 'Ada Lovelace',
        bio: 'Computing pioneer',
        github: 'https://github.com/ada',
      },
    ],
  });

  const person = parseOutput(result).people.tab[0];
  assert.equal(person.bio, 'Computing pioneer');
});

test('roster linkedin and twitter handles take precedence over cncf/people', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [
          {
            name: 'Ada Lovelace',
            github: 'ada',
            linkedin: 'roster-linkedin',
            twitter: 'roster-twitter',
          },
        ],
      }),
    },
    records: [
      {
        name: 'Ada Lovelace',
        github: 'https://github.com/ada',
        linkedin: 'https://www.linkedin.com/in/people-linkedin',
        twitter: 'https://twitter.com/people-twitter',
      },
    ],
  });

  const person = parseOutput(result).people.tab[0];
  assert.equal(person.linkedin, 'roster-linkedin');
  assert.equal(person.twitter, 'roster-twitter');
});

test('falls back to roster data and counts a fallback when no cncf/people record matches', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [
          { name: 'Ada Lovelace', company: 'Analytical Co', github: 'ada' },
        ],
      }),
    },
    records: [],
  });

  const output = parseOutput(result);
  const person = output.people.tab[0];
  assert.equal(person.name, 'Ada Lovelace');
  assert.equal(person.company, 'Analytical Co');
  // Without a cncf/people match the avatar is derived from the handle.
  assert.equal(person.image, 'https://github.com/ada.png');
  assert.match(result.stdout, /\(1 fallback\)/);
});

test('preserves the previous run when a handle has no cncf/people match', () => {
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
              image: 'https://avatars.githubusercontent.com/u/1?v=4',
            },
          ],
        },
      }),
    },
    records: [],
  });

  const person = parseOutput(result).people.tab[0];
  assert.equal(person.bio, 'cached bio');
  assert.equal(person.location, 'London');
  assert.equal(person.image, 'https://avatars.githubusercontent.com/u/1?v=4');
  assert.equal(person.company, 'Roster Co');
});

test('fails closed and does not overwrite output when cncf/people cannot be loaded', () => {
  const result = runScriptWithFetchMock({
    script: 'fetch-community-people.mjs',
    fixtures: {
      [ROSTER]: roster({ tab: [{ name: 'Ada Lovelace', github: 'ada' }] }),
      [OUTPUT]: JSON.stringify({
        fetchedAt: '2020-01-01T00:00:00.000Z',
        people: { tab: [] },
      }),
    },
    routes: [{ match: PEOPLE_MATCH, status: 500 }],
    outputs: [OUTPUT],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Could not load cncf\/people\/people\.json/);
  assert.equal(
    JSON.parse(result.outputs[OUTPUT]).fetchedAt,
    '2020-01-01T00:00:00.000Z',
    'output should be untouched when the upstream dataset fails to load',
  );
});

test('rejects an invalid GitHub handle in the roster', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [{ name: 'Bad Actor', github: '../evil' }],
      }),
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid GitHub handle/);
});

test('uses fallbackImages for people without a GitHub handle', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster(
        { tab: [{ name: 'Grace Hopper' }] },
        { 'Grace Hopper': 'https://www.cncf.io/img/grace.png' },
      ),
    },
  });

  const person = parseOutput(result).people.tab[0];
  assert.equal(person.image, 'https://www.cncf.io/img/grace.png');
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

test('ignores an upstream image on a host outside the allowlist', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({
        tab: [{ name: 'Ada Lovelace', github: 'ada' }],
      }),
    },
    records: [
      {
        name: 'Ada Lovelace',
        github: 'https://github.com/ada',
        image: 'https://tracker.example/beacon.png',
      },
    ],
  });

  const output = parseOutput(result);
  // The rejected upstream URL degrades to the derived GitHub avatar rather
  // than being published as an <img src> on the community page.
  assert.equal(output.people.tab[0].image, 'https://github.com/ada.png');
  assert.match(result.stderr, /not an https URL on an allowed host/);
});

test('ignores an upstream image whose userinfo disguises the real host', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({ tab: [{ name: 'Ada Lovelace', github: 'ada' }] }),
    },
    records: [
      {
        name: 'Ada Lovelace',
        github: 'https://github.com/ada',
        image: 'https://www.cncf.io@evil.example/ada.png',
      },
    ],
  });

  assert.equal(
    parseOutput(result).people.tab[0].image,
    'https://github.com/ada.png',
  );
});

test('ignores a plaintext http upstream image', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({ tab: [{ name: 'Ada Lovelace', github: 'ada' }] }),
    },
    records: [
      {
        name: 'Ada Lovelace',
        github: 'https://github.com/ada',
        image:
          'http://raw.githubusercontent.com/cncf/people/main/images/ada.jpg',
      },
    ],
  });

  assert.equal(
    parseOutput(result).people.tab[0].image,
    'https://github.com/ada.png',
  );
});

test('drops a cached image on a host outside the allowlist', () => {
  const result = run({
    fixtures: {
      [ROSTER]: roster({ tab: [{ name: 'Ada', github: 'ada' }] }),
      [OUTPUT]: JSON.stringify({
        fetchedAt: '2020-01-01T00:00:00.000Z',
        people: {
          tab: [
            {
              name: 'Ada',
              github: 'ada',
              image: 'https://tracker.example/a.png',
            },
          ],
        },
      }),
    },
    records: [],
  });

  assert.equal(
    parseOutput(result).people.tab[0].image,
    'https://github.com/ada.png',
  );
});
