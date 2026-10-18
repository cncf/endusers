import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-end-user-talks.mjs';

const SCHEDULE =
  'https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/program/schedule/';

const validTalk = {
  id: '1250350',
  title: 'Saturated by Design',
  speakers: 'Dakota Sullivan, Isaac Wilson',
  room: 'Salt Palace | Level 1 | Grand Ballroom ACE',
  url: `${SCHEDULE}?id=1250350`,
};

function schedule(overrides = {}, talks = [validTalk]) {
  return {
    description: 'Generated from the official Sessionize API.',
    sourceUrl: SCHEDULE,
    apiUrl: 'https://sessionize.com/api/v2/svi82w6c/view/All',
    category: 'End User Programming / End User Talk',
    generatedAt: '2026-10-12T19:41:29.093Z',
    timezone: 'MST (UTC-7)',
    talkCount: talks.length,
    days: [
      {
        date: '2026-11-10',
        id: 'day-1',
        label: 'Tuesday, November 10',
        slots: [{ start: '09:00:00', end: '09:30:00', talks }],
      },
    ],
    ...overrides,
  };
}

function fixture(data) {
  return { 'data/end-user-talks.json': JSON.stringify(data) };
}

function run(data) {
  return runScriptWithFixtures(SCRIPT, fixture(data));
}

test('accepts a valid snapshot', () => {
  const result = run(schedule());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 end user talk links/);
});

test('counts every talk across days and slots', () => {
  const data = schedule();
  data.days.push({
    date: '2026-11-11',
    id: 'day-2',
    label: 'Wednesday, November 11',
    slots: [
      { start: '10:00:00', end: '10:30:00', talks: [validTalk] },
      { start: '11:00:00', end: '11:30:00', talks: [validTalk, validTalk] },
    ],
  });
  const result = run(data);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 4 end user talk links/);
});

// The control this validator exists for: the visible prefix reads as the
// official schedule host while the request resolves to the userinfo-suffixed
// host.
test('rejects a talk url carrying a userinfo component', () => {
  const result = run(
    schedule({}, [
      {
        ...validTalk,
        url: 'https://events.linuxfoundation.org@evil.example/?id=1',
      },
    ]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not carry a userinfo component/);
  assert.match(result.stderr, /evil\.example/);
});

test('rejects a talk url on another host', () => {
  const result = run(
    schedule({}, [{ ...validTalk, url: 'https://evil.example/?id=1' }]),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /url must be on events\.linuxfoundation\.org, got evil\.example/,
  );
});

// A lookalike that merely ends in the allowed characters is not a subdomain
// of it, so the suffix match must reject it.
test('rejects a host that only ends in the allowed host string', () => {
  const result = run(
    schedule({}, [
      { ...validTalk, url: 'https://notevents.linuxfoundation.org/?id=1' },
    ]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be on events\.linuxfoundation\.org/);
});

test('rejects a non-https talk url', () => {
  const result = run(
    schedule({}, [
      {
        ...validTalk,
        url: SCHEDULE.replace('https:', 'http:'),
      },
    ]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must use https, got http:/);
});

test('rejects a javascript: talk url', () => {
  const result = run(
    schedule({}, [{ ...validTalk, url: 'javascript:alert(1)' }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must use https, got javascript:/);
});

test('rejects an unparseable talk url', () => {
  const result = run(
    schedule({}, [{ ...validTalk, url: 'events.linuxfoundation.org' }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /url must be an absolute https URL/);
});

for (const [label, value] of [
  ['missing', undefined],
  ['blank', '   '],
  ['non-string', 42],
]) {
  test(`rejects a ${label} talk url`, () => {
    const result = run(schedule({}, [{ ...validTalk, url: value }]));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /url must be a non-empty string/);
  });
}

// A talk whose id is not a string must still produce a readable error path
// rather than crashing the report.
test('labels a talk with a non-string id as unknown', () => {
  const result = run(schedule({}, [{ ...validTalk, id: 7, url: undefined }]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown: url must be a non-empty string/);
});

test('reports a null talk instead of throwing', () => {
  const result = run(schedule({}, [null]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown: url must be a non-empty string/);
});

// The whole point of the path check: the host is right and the scheme is
// right, but the link leaves the schedule page.
test('rejects a talk url that is not a deep link into the schedule page', () => {
  const result = run(
    schedule({}, [
      {
        ...validTalk,
        url: 'https://events.linuxfoundation.org/sponsor/?id=1250350',
      },
    ]),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /url must be a deep link into \/kubecon-cloudnativecon-north-america\/program\/schedule\/, got \/sponsor\//,
  );
});

test('follows sourceUrl when the conference changes', () => {
  const next = 'https://events.linuxfoundation.org/kubecon-europe/schedule/';
  const result = run(
    schedule({ sourceUrl: next }, [{ ...validTalk, url: `${next}?id=1` }]),
  );
  assert.equal(result.status, 0, result.stderr);
});

test('rejects a sourceUrl on another host', () => {
  const result = run(schedule({ sourceUrl: 'https://evil.example/schedule/' }));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /sourceUrl must be on events\.linuxfoundation\.org, got evil\.example/,
  );
});

test('rejects an apiUrl on another host', () => {
  const result = run(schedule({ apiUrl: 'https://evil.example/api' }));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /apiUrl must be on sessionize\.com, got evil\.example/,
  );
});

test('rejects a missing apiUrl', () => {
  const result = run(schedule({ apiUrl: undefined }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /apiUrl must be a non-empty string/);
});

// An unusable sourceUrl is reported once, as itself; with no path to compare
// against, the talk links must not also be reported as off-path.
test('reports an unparseable sourceUrl without cascading onto the talks', () => {
  const result = run(schedule({ sourceUrl: 'events.linuxfoundation.org' }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an absolute https URL/);
  assert.doesNotMatch(result.stderr, /must be a deep link/);
});

test('reports a missing sourceUrl without cascading onto the talks', () => {
  const result = run(schedule({ sourceUrl: undefined }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be a non-empty string/);
  assert.doesNotMatch(result.stderr, /must be a deep link/);
});

// Shape guards: a snapshot missing the arrays the collector guarantees must
// validate nothing rather than throw.
test('tolerates a snapshot with no days array', () => {
  const result = run(schedule({ days: undefined }));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 0 end user talk links/);
});

test('tolerates a day with no slots array', () => {
  const data = schedule();
  data.days[0].slots = undefined;
  const result = run(data);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 0 end user talk links/);
});

test('tolerates a slot with no talks array', () => {
  const data = schedule();
  data.days[0].slots[0].talks = undefined;
  const result = run(data);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 0 end user talk links/);
});

test('tolerates a null day and a null slot', () => {
  const data = schedule();
  data.days.unshift(null);
  data.days[1].slots.unshift(null);
  const result = run(data);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 end user talk links/);
});
