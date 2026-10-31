import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptInSandbox } from './helpers-script-sandbox.mjs';

const OUTPUT = 'data/end-user-talks/kubecon-na-2026.json';
const LINKS = 'data/end-user-talk-links.json';
const EVENTS = 'data/end-user-talk-events.json';
const API = 'https://sessionize.com/api/v2/svi82w6c/view/All';
const SCHEDULE =
  'https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/program/schedule/';

const naEvent = {
  slug: 'kubecon-na-2026',
  sourceUrl: SCHEDULE,
  apiUrl: API,
  sessionUrl: `${SCHEDULE}?id={id}`,
  location: 'Salt Lake City',
  timezone: 'MST (UTC-7)',
  utcOffset: '-07:00',
  select: { category: 'End User Programming', item: 'End User Talk' },
  selection: 'End User Programming → End User Talk',
};

function sessionizeFixture() {
  return {
    sessions: [
      {
        id: '1001',
        title: 'Platform Engineering at Acme',
        description: 'How Acme runs Kubernetes.\r\n\r\nAnd what broke.  ',
        startsAt: '2026-11-10T10:30:00',
        endsAt: '2026-11-10T11:00:00',
        roomId: 1,
        speakers: [11],
        categoryItems: [999],
      },
      {
        id: '1002',
        title: 'Ignored Keynote',
        description: 'Keynote session.',
        startsAt: '2026-11-10T09:00:00',
        endsAt: '2026-11-10T09:30:00',
        roomId: 2,
        speakers: [12],
        categoryItems: [888],
      },
    ],
    rooms: [
      { id: 1, name: 'Grand Ballroom A' },
      { id: 2, name: 'Keynote Hall' },
    ],
    speakers: [
      { id: 11, fullName: 'Alice Doe' },
      { id: 12, fullName: 'Bob Keynote' },
    ],
    categories: [
      {
        id: 100,
        title: 'End User Programming',
        items: [{ id: 999, name: 'End User Talk' }],
      },
      {
        id: 200,
        title: 'Session Track',
        items: [{ id: 888, name: 'Keynote' }],
      },
    ],
  };
}

function collect(
  fixture = sessionizeFixture(),
  { fixtures = {}, events = [naEvent], routes = [], outputs = [] } = {},
) {
  return runScriptInSandbox({
    script: 'collect-end-user-talks.mjs',
    routes: [
      {
        match: 'sessionize.com/api/v2/svi82w6c/view/All',
        body: fixture,
      },
      ...routes,
    ],
    outputs: [OUTPUT, ...outputs],
    fixtures: { [EVENTS]: JSON.stringify({ events }), ...fixtures },
  });
}

test('collect-end-user-talks queries Sessionize and outputs filtered talks catalog', () => {
  const result = collect();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.outputs[OUTPUT], 'expected JSON catalog output');
  const catalog = JSON.parse(result.outputs[OUTPUT]);
  assert.equal(catalog.talkCount, 1);
  assert.equal(catalog.days.length, 1);
  assert.equal(catalog.days[0].date, '2026-11-10');
  assert.equal(catalog.days[0].slots.length, 1);
  // The machine-readable boundaries carry the event's UTC offset so a reader
  // outside Mountain Time resolves them to the same instant; the labels stay
  // the event-local wall-clock time a human reads.
  assert.equal(catalog.days[0].slots[0].start, '2026-11-10T10:30:00-07:00');
  assert.equal(catalog.days[0].slots[0].end, '2026-11-10T11:00:00-07:00');
  assert.equal(catalog.days[0].slots[0].startLabel, '10:30 AM');
  assert.equal(catalog.days[0].slots[0].endLabel, '11:00 AM');
  const talk = catalog.days[0].slots[0].talks[0];
  assert.equal(talk.id, '1001');
  assert.equal(talk.title, 'Platform Engineering at Acme');
  assert.equal(talk.speakers, 'Alice Doe');
  assert.equal(talk.room, 'Grand Ballroom A');
  // The abstract is copied with Sessionize's CRLF paragraph breaks normalized
  // and the trailing whitespace trimmed; slides and recording are absent, not
  // null, when nothing supplies them.
  assert.equal(
    talk.description,
    'How Acme runs Kubernetes.\n\nAnd what broke.',
  );
  assert.ok(!('slides' in talk) && !('recording' in talk));
});

test('a session without an abstract yields an empty description', () => {
  const fixture = sessionizeFixture();
  delete fixture.sessions[0].description;
  const result = collect(fixture);
  assert.equal(result.status, 0, result.stderr);
  const talk = JSON.parse(result.outputs[OUTPUT]).days[0].slots[0].talks[0];
  assert.equal(talk.description, '');
});

test('merges curated slides and recording links by session id', () => {
  const links = {
    links: [
      {
        id: '1001',
        slides: 'https://example.com/acme.pdf',
        recording: 'https://youtu.be/acme',
      },
      { id: '1002', recording: 'https://youtu.be/ignored' },
    ],
  };
  const result = collect(sessionizeFixture(), {
    fixtures: { [LINKS]: JSON.stringify(links) },
  });
  assert.equal(result.status, 0, result.stderr);
  const talk = JSON.parse(result.outputs[OUTPUT]).days[0].slots[0].talks[0];
  assert.equal(talk.slides, 'https://example.com/acme.pdf');
  assert.equal(talk.recording, 'https://youtu.be/acme');
});

test('falls back to the feed recordingUrl and lets a curated recording win', () => {
  const fixture = sessionizeFixture();
  fixture.sessions[0].recordingUrl = 'https://youtu.be/from-feed';
  const fromFeed = collect(fixture);
  assert.equal(fromFeed.status, 0, fromFeed.stderr);
  const feedTalk = JSON.parse(fromFeed.outputs[OUTPUT]).days[0].slots[0]
    .talks[0];
  assert.equal(feedTalk.recording, 'https://youtu.be/from-feed');
  assert.ok(!('slides' in feedTalk));

  const curated = collect(fixture, {
    fixtures: {
      [LINKS]: JSON.stringify({
        links: [{ id: '1001', recording: 'https://youtu.be/curated' }],
      }),
    },
  });
  assert.equal(curated.status, 0, curated.stderr);
  assert.equal(
    JSON.parse(curated.outputs[OUTPUT]).days[0].slots[0].talks[0].recording,
    'https://youtu.be/curated',
  );
});

test('leaves the schedule untouched when nothing changed', () => {
  const first = collect();
  assert.equal(first.status, 0, first.stderr);
  const firstCatalog = JSON.parse(first.outputs[OUTPUT]);

  // Re-run against the exact schedule the first run produced, as the weekly
  // refresh-metrics.yml workflow would with unchanged upstream content.
  const second = collect(sessionizeFixture(), {
    fixtures: { [OUTPUT]: first.outputs[OUTPUT] },
  });

  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /No End User Talk changes detected/);
  // The file on disk — including generatedAt — must be byte-for-byte the
  // same; a second run must not open a no-op refresh PR.
  assert.equal(second.outputs[OUTPUT], first.outputs[OUTPUT]);
  assert.equal(
    JSON.parse(second.outputs[OUTPUT]).generatedAt,
    firstCatalog.generatedAt,
  );
});

test('rewrites the schedule and bumps generatedAt when a talk actually changes', () => {
  const first = collect();
  assert.equal(first.status, 0, first.stderr);

  const changed = sessionizeFixture();
  changed.sessions[0].title = 'Platform Engineering at Acme, Revisited';
  const second = collect(changed, {
    fixtures: { [OUTPUT]: first.outputs[OUTPUT] },
  });

  assert.equal(second.status, 0, second.stderr);
  assert.notEqual(second.outputs[OUTPUT], first.outputs[OUTPUT]);
  const catalog = JSON.parse(second.outputs[OUTPUT]);
  assert.equal(
    catalog.days[0].slots[0].talks[0].title,
    'Platform Engineering at Acme, Revisited',
  );
});

test('throws an error if End User Programming category is missing', () => {
  const fixture = sessionizeFixture();
  fixture.categories = [];
  const result = collect(fixture);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /kubecon-na-2026: official End User Talk category is missing/,
  );
});

test('throws an error if End User Talk category has no sessions', () => {
  const fixture = sessionizeFixture();
  fixture.sessions = [];
  const result = collect(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /kubecon-na-2026: no end user talks selected/);
});

test('throws an error if session has incomplete data', () => {
  const fixture = sessionizeFixture();
  delete fixture.sessions[0].title;
  const result = collect(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /has incomplete schedule data/);
});

test('throws an error if Sessionize API returns non-200', () => {
  const result = runScriptInSandbox({
    script: 'collect-end-user-talks.mjs',
    routes: [
      {
        match: 'sessionize.com/api/v2/svi82w6c/view/All',
        status: 500,
        body: 'Internal Server Error',
      },
    ],
    outputs: [OUTPUT],
    fixtures: { [EVENTS]: JSON.stringify({ events: [naEvent] }) },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Sessionize API returned 500/);
});

test('groups multiple sessions in the same slot correctly and handles afternoon/noon time labels', () => {
  const fixture = sessionizeFixture();
  fixture.sessions.push(
    {
      id: '1003',
      title: 'Second Talk in Same Slot',
      startsAt: '2026-11-10T10:30:00',
      endsAt: '2026-11-10T11:00:00',
      roomId: 1,
      speakers: [11],
      categoryItems: [999],
    },
    {
      id: '1004',
      title: 'Noon Panel',
      startsAt: '2026-11-10T12:00:00',
      endsAt: '2026-11-10T12:45:00',
      roomId: 1,
      speakers: [11],
      categoryItems: [999],
    },
    {
      id: '1005',
      title: 'Afternoon Talk Same Start Different End',
      startsAt: '2026-11-10T12:00:00',
      endsAt: '2026-11-10T13:00:00',
      roomId: 2,
      speakers: [11],
      categoryItems: [999],
    },
  );
  const result = collect(fixture);
  assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(result.outputs[OUTPUT]);
  assert.equal(catalog.talkCount, 4);
  assert.equal(catalog.days[0].slots[0].talks.length, 2);
  assert.equal(catalog.days[0].slots[1].startLabel, '12:00 PM');
  assert.equal(catalog.days[0].slots[2].endLabel, '1:00 PM');
});

// A conference with no end user track is snapshotted from a curated id list
// in its own file, deep-linked through its own session URL and stamped with
// its own offset, alongside the category-selected one.
const CHINA_OUTPUT = 'data/end-user-talks/kubecon-china-2026.json';
const chinaEvent = {
  slug: 'kubecon-china-2026',
  sourceUrl: 'https://china-2026.sessionize.com/',
  apiUrl: 'https://sessionize.com/api/v2/china/view/All',
  sessionUrl: 'https://china-2026.sessionize.com/session/{id}',
  location: 'Shanghai',
  timezone: 'CST (UTC+8)',
  utcOffset: '+08:00',
  select: { sessionIds: ['1002', '1001'] },
  selection: 'presented by End User member speakers',
};

function collectBoth(
  fixture = sessionizeFixture(),
  events = [naEvent, chinaEvent],
) {
  return collect(sessionizeFixture(), {
    events,
    routes: [{ match: 'sessionize.com/api/v2/china/view/All', body: fixture }],
    outputs: [CHINA_OUTPUT],
  });
}

test('selects curated session ids for an event without an official category and writes each event its own snapshot', () => {
  const result = collectBoth();
  assert.equal(result.status, 0, result.stderr);
  const na = JSON.parse(result.outputs[OUTPUT]);
  const china = JSON.parse(result.outputs[CHINA_OUTPUT]);
  assert.equal(na.talkCount, 1);
  assert.equal(china.talkCount, 2);
  assert.equal(china.selection, chinaEvent.selection);
  assert.equal(china.location, 'Shanghai');
  assert.equal(china.sourceUrl, chinaEvent.sourceUrl);
  assert.equal(china.apiUrl, chinaEvent.apiUrl);
  // Curated ids are listed in any order; the snapshot still runs by start.
  const talks = china.days[0].slots.flatMap((slot) => slot.talks);
  assert.deepEqual(
    talks.map((talk) => talk.id),
    ['1002', '1001'],
  );
  assert.equal(talks[0].url, 'https://china-2026.sessionize.com/session/1002');
  assert.equal(china.days[0].slots[0].start, '2026-11-10T09:00:00+08:00');
  assert.match(
    result.stdout,
    /Collected 2 End User Talks across 1 days from https:\/\/sessionize.com\/api\/v2\/china\/view\/All/,
  );
});

test('fails when a curated session id has left the feed', () => {
  const fixture = sessionizeFixture();
  fixture.sessions = fixture.sessions.filter((s) => s.id !== '1002');
  const result = collectBoth(fixture);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /kubecon-china-2026: curated session ids are missing from the feed: 1002/,
  );
});
