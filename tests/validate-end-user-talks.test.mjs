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
  description: 'How the cluster was saturated by design.',
};
const LINKS = 'data/end-user-talk-links.json';

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

function fixture(data, links) {
  const files = { 'data/end-user-talks.json': JSON.stringify(data) };
  if (links !== undefined) files[LINKS] = JSON.stringify(links);
  return files;
}

function run(data, links) {
  return runScriptWithFixtures(SCRIPT, fixture(data, links));
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

// The curated overlay: slides and recordings the collector merges into the
// generated talks, keyed by Sessionize id.
const RECORDING = 'https://www.youtube.com/watch?v=abc123';
const SLIDES = 'https://example.com/slides.pdf';

function linkedTalk(links = {}) {
  return { ...validTalk, ...links };
}

test('accepts a talk carrying curated slides and a YouTube recording', () => {
  const links = {
    links: [{ id: validTalk.id, slides: SLIDES, recording: RECORDING }],
  };
  const result = run(
    schedule({}, [linkedTalk({ slides: SLIDES, recording: RECORDING })]),
    links,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('accepts a youtu.be recording and an overlay with only one link', () => {
  const short = 'https://youtu.be/abc123';
  const links = { links: [{ id: validTalk.id, recording: short }] };
  const result = run(schedule({}, [linkedTalk({ recording: short })]), links);
  assert.equal(result.status, 0, result.stderr);
});

test('rejects a recording hosted anywhere but YouTube', () => {
  const links = {
    links: [{ id: validTalk.id, recording: 'https://vimeo.com/123' }],
  };
  const result = run(
    schedule({}, [linkedTalk({ recording: 'https://vimeo.com/123' })]),
    links,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /recording must be on youtube\.com or youtu\.be/);
});

test('rejects a non-https slides link', () => {
  const links = {
    links: [{ id: validTalk.id, slides: 'http://example.com/slides.pdf' }],
  };
  const result = run(
    schedule({}, [linkedTalk({ slides: 'http://example.com/slides.pdf' })]),
    links,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /slides must use https, got http:/);
});

test('rejects an overlay entry that names no talk in the schedule', () => {
  const links = { links: [{ id: '999999', recording: RECORDING }] };
  const result = run(schedule(), links);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /id 999999 names no talk/);
});

test('rejects an overlay the collector has not been re-run against', () => {
  const links = {
    links: [{ id: validTalk.id, slides: SLIDES, recording: RECORDING }],
  };
  const result = run(schedule({}, [linkedTalk({ slides: SLIDES })]), links);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /recording does not match end-user-talk-links\.json/,
  );
  assert.doesNotMatch(result.stderr, /slides does not match/);

  const slidesStale = run(
    schedule({}, [linkedTalk({ recording: RECORDING })]),
    links,
  );
  assert.equal(slidesStale.status, 1);
  assert.match(
    slidesStale.stderr,
    /slides does not match end-user-talk-links\.json/,
  );
});

test('rejects an overlay entry without any link, a duplicate and an unsorted id', () => {
  const second = { ...validTalk, id: '1250351', url: `${SCHEDULE}?id=1250351` };
  const links = {
    links: [
      { id: '1250351', recording: RECORDING },
      { id: '1250350' },
      { id: '1250350', slides: SLIDES },
    ],
  };
  const result = run(
    schedule({}, [
      linkedTalk({ slides: SLIDES }),
      { ...second, recording: RECORDING },
    ]),
    links,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /links\[1\].*id 1250350 is out of order/);
  assert.match(
    result.stderr,
    /links\[1\].*must carry slides, recording or both/,
  );
  assert.match(result.stderr, /links\[2\].*duplicate id 1250350/);
});

test('rejects an overlay that is not a links array and an entry without an id', () => {
  const noArray = run(schedule(), { links: 'nope' });
  assert.equal(noArray.status, 1);
  assert.match(noArray.stderr, /must carry a links array/);

  const noId = run(schedule(), { links: [{ recording: RECORDING }] });
  assert.equal(noId.status, 1);
  assert.match(noId.stderr, /links\[0\].*id must be a non-empty string/);
});

test('rejects a talk whose description is missing', () => {
  const { description, ...withoutDescription } = validTalk;
  assert.ok(description);
  const result = run(schedule({}, [withoutDescription]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /description must be a string/);
});

test('rejects generated links that fail the URL rules even without an overlay', () => {
  const result = run(
    schedule({}, [linkedTalk({ recording: 'https://vimeo.com/123' })]),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /end-user-talks 1250350.*recording must be on youtube\.com or youtu\.be/,
  );
});
