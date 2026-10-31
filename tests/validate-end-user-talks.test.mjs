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

const API = 'https://sessionize.com/api/v2/svi82w6c/view/All';
const EVENTS = 'data/end-user-talk-events.json';
const SNAPSHOT = 'data/end-user-talks/kubecon-na-2026.json';

function event(overrides = {}) {
  return {
    slug: 'kubecon-na-2026',
    sourceUrl: SCHEDULE,
    apiUrl: API,
    sessionUrl: `${SCHEDULE}?id={id}`,
    location: 'Salt Lake City',
    timezone: 'MST (UTC-7)',
    utcOffset: '-07:00',
    select: { category: 'End User Programming', item: 'End User Talk' },
    selection: 'End User Programming → End User Talk',
    ...overrides,
  };
}

function schedule(overrides = {}, talks = [validTalk]) {
  return {
    description: 'Generated from the official Sessionize API.',
    sourceUrl: SCHEDULE,
    apiUrl: API,
    selection: 'End User Programming → End User Talk',
    location: 'Salt Lake City',
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

function fixture(data, links, events = [event()]) {
  const files = {
    [EVENTS]: JSON.stringify({ events }),
    [SNAPSHOT]: JSON.stringify(data),
  };
  if (links !== undefined) files[LINKS] = JSON.stringify(links);
  return files;
}

function run(data, links, events) {
  return runScriptWithFixtures(SCRIPT, fixture(data, links, events));
}

// An event whose only schedule is its Sessionize subdomain and whose talks
// are a curated id list, the shape a conference without an end user track
// takes.
const CHINA = 'https://china-2026.sessionize.com/';
function chinaEvent(overrides = {}) {
  return event({
    slug: 'kubecon-china-2026',
    sourceUrl: CHINA,
    apiUrl: 'https://sessionize.com/api/v2/china/view/All',
    sessionUrl: `${CHINA}session/{id}`,
    location: 'Shanghai',
    timezone: 'CST (UTC+8)',
    utcOffset: '+08:00',
    select: { sessionIds: ['1'] },
    selection: 'presented by End User member speakers',
    ...overrides,
  });
}

function runEvents(events, snapshots = {}) {
  return runScriptWithFixtures(SCRIPT, {
    [EVENTS]: JSON.stringify({ events }),
    [SNAPSHOT]: JSON.stringify(schedule()),
    ...Object.fromEntries(
      Object.entries(snapshots).map(([slug, data]) => [
        `data/end-user-talks/${slug}.json`,
        JSON.stringify(data),
      ]),
    ),
  });
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

// A talk's link is the event's own deep link for its id and nothing else, so
// every form a re-pointed corpus could take -- another host, a userinfo
// disguise, a plain-http copy, a path elsewhere on the real host, another
// session, a missing value -- is one finding that names the expected link.
for (const [label, value] of [
  ['on another host', 'https://evil.example/?id=1250350'],
  [
    'with a userinfo component',
    'https://events.linuxfoundation.org@evil.example/?id=1250350',
  ],
  ['over plain http', `${SCHEDULE.replace('https:', 'http:')}?id=1250350`],
  [
    'off the schedule page',
    'https://events.linuxfoundation.org/sponsor/?id=1250350',
  ],
  ['for another session', `${SCHEDULE}?id=1`],
  ['missing', undefined],
  ['non-string', 42],
]) {
  test(`rejects a talk url ${label}`, () => {
    const result = run(schedule({}, [{ ...validTalk, url: value }]));
    assert.equal(result.status, 1);
    const finding = `end-user-talks/kubecon-na-2026 1250350: url must be ${SCHEDULE}?id=1250350, got ${JSON.stringify(value) ?? 'undefined'}`;
    assert.ok(result.stderr.includes(finding), result.stderr);
  });
}

// A talk whose id is not a string must still produce a readable error path
// rather than crashing the report.
test('labels a talk with a non-string id as unknown', () => {
  const result = run(schedule({}, [{ ...validTalk, id: 7 }]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown: url must be .*\?id=unknown, got/);
});

test('reports a null talk instead of throwing', () => {
  const result = run(schedule({}, [null]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown: url must be .*, got undefined/);
});

// The events file is what every snapshot is generated from, so a bad entry is
// reported there, by index, before any snapshot is read against it.
test('accepts a curated-id event on its Sessionize subdomain and an lfopensource.cn schedule', () => {
  const source = 'https://www.lfopensource.cn/kubecon-china/';
  const talk = { ...validTalk, id: '1', url: `${CHINA}session/1` };
  const result = runEvents([event(), chinaEvent({ sourceUrl: source })], {
    'kubecon-china-2026': schedule(
      {
        sourceUrl: source,
        apiUrl: 'https://sessionize.com/api/v2/china/view/All',
      },
      [talk],
    ),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 2 end user talk links/);
});

for (const [label, overrides, message] of [
  [
    'a sourceUrl on another host',
    { sourceUrl: 'https://evil.example/s/' },
    /events\[0\]: sourceUrl must be on events\.linuxfoundation\.org or lfopensource\.cn or sessionize\.com, got evil\.example/,
  ],
  [
    'a lookalike schedule host',
    { sourceUrl: 'https://notevents.linuxfoundation.org/' },
    /events\[0\]: sourceUrl must be on/,
  ],
  [
    'an unparseable sourceUrl',
    { sourceUrl: 'events.linuxfoundation.org' },
    /events\[0\]: sourceUrl must be an absolute https URL/,
  ],
  [
    'a missing sourceUrl',
    { sourceUrl: undefined },
    /events\[0\]: sourceUrl must be a non-empty string/,
  ],
  [
    'an apiUrl on another host',
    { apiUrl: 'https://evil.example/api' },
    /events\[0\]: apiUrl must be on sessionize\.com, got evil\.example/,
  ],
  [
    'a missing apiUrl',
    { apiUrl: undefined },
    /events\[0\]: apiUrl must be a non-empty string/,
  ],
  [
    'a sessionUrl without an id placeholder',
    { sessionUrl: `${SCHEDULE}?id=1` },
    /events\[0\]: sessionUrl must be a template containing \{id\}/,
  ],
  [
    'a sessionUrl on another host',
    { sessionUrl: 'https://evil.example/{id}' },
    /events\[0\]: sessionUrl must be on/,
  ],
  [
    'a missing location',
    { location: '' },
    /events\[0\]: location must be a non-empty string/,
  ],
  [
    'a missing timezone',
    { timezone: undefined },
    /events\[0\]: timezone must be a non-empty string/,
  ],
  [
    'a missing selection',
    { selection: 7 },
    /events\[0\]: selection must be a non-empty string/,
  ],
  [
    'an offset without a colon',
    { utcOffset: '-0700' },
    /events\[0\]: utcOffset must look like \+08:00 or -07:00/,
  ],
  [
    'a select with neither rule',
    { select: {} },
    /events\[0\]: select must be \{ category, item \} or \{ sessionIds \}/,
  ],
  [
    'a category select without an item',
    { select: { category: 'End User Programming' } },
    /events\[0\]: select must be/,
  ],
  ['an empty id list', { select: { sessionIds: [] } }, /select must be/],
  ['a non-string id', { select: { sessionIds: [1] } }, /select must be/],
]) {
  test(`rejects an event with ${label}`, () => {
    const result = run(schedule(), undefined, [event(overrides)]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
  });
}

test('rejects a malformed slug and a duplicate slug, and skips their snapshots', () => {
  const result = run(schedule(), undefined, [
    event({ slug: 'KubeCon NA' }),
    event(),
    event(),
  ]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /events\[0\]: slug must be lowercase letters, digits and hyphens/,
  );
  assert.match(result.stderr, /events\[2\]: duplicate slug kubecon-na-2026/);
  assert.doesNotMatch(result.stderr, /events\[1\]/);
});

test('rejects an events file without an events array', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    [EVENTS]: JSON.stringify({ events: 'nope' }),
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /end-user-talk-events: must carry an events array/,
  );
});

test('rejects a missing snapshot and a snapshot no event names', () => {
  const result = runEvents([event(), chinaEvent()], {
    'kubecon-eu-2027': schedule(),
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /end-user-talks\/kubecon-china-2026: snapshot is missing; run npm run collect:end-user-talks/,
  );
  assert.match(
    result.stderr,
    /end-user-talks\/kubecon-eu-2027\.json: names no event in end-user-talk-events\.json/,
  );
});

test("rejects a snapshot whose provenance is not its event's", () => {
  const result = run(
    schedule({ sourceUrl: `${SCHEDULE}other/`, apiUrl: undefined }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /kubecon-na-2026: sourceUrl does not match end-user-talk-events\.json; re-run/,
  );
  assert.match(
    result.stderr,
    /kubecon-na-2026: apiUrl does not match end-user-talk-events\.json; re-run/,
  );
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
    /end-user-talks\/kubecon-na-2026 1250350.*recording must be on youtube\.com or youtu\.be/,
  );
});
