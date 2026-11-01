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

// The fixtures schedule the NA event for November 2026; pinning the
// collector's idea of today keeps that an upcoming event on any machine.
const TODAY = '2026-01-01';

function collect(
  fixture = sessionizeFixture(),
  {
    fixtures = {},
    events = [naEvent],
    routes = [],
    outputs = [],
    args = [],
    env = {},
  } = {},
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
    args,
    env: { ENDUSERS_TODAY: TODAY, ...env },
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

// A schedule is final once its event has run; the weekly run must not spend
// a request (or, for Sched, a request per session) re-reading one.
test('skips an event whose snapshot ends before today unless it is asked for', () => {
  const first = collect();
  assert.equal(first.status, 0, first.stderr);
  const snapshot = first.outputs[OUTPUT];
  const after = { env: { ENDUSERS_TODAY: '2026-11-11' } };

  const skipped = collect(sessionizeFixture(), {
    fixtures: { [OUTPUT]: snapshot },
    ...after,
  });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(
    skipped.stdout,
    /Skipping kubecon-na-2026; its schedule is final\. Run npm run collect:end-user-talks -- kubecon-na-2026 to refresh it anyway\./,
  );
  assert.equal(skipped.requests.length, 0);
  assert.equal(skipped.outputs[OUTPUT], snapshot);

  // The last day of the event is still today, not yet past.
  const onTheDay = collect(sessionizeFixture(), {
    fixtures: { [OUTPUT]: snapshot },
    env: { ENDUSERS_TODAY: '2026-11-10' },
  });
  assert.equal(onTheDay.status, 0, onTheDay.stderr);
  assert.equal(onTheDay.requests.length, 1);

  const changed = sessionizeFixture();
  changed.sessions[0].title = 'Platform Engineering at Acme, Revisited';
  for (const args of [['kubecon-na-2026'], ['--all']]) {
    const forced = collect(changed, {
      fixtures: { [OUTPUT]: snapshot },
      args,
      ...after,
    });
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(forced.requests.length, 1, args.join(' '));
    assert.equal(
      JSON.parse(forced.outputs[OUTPUT]).days[0].slots[0].talks[0].title,
      'Platform Engineering at Acme, Revisited',
    );
  }
});

test('collects an event with no snapshot yet whatever the date', () => {
  const result = collect(sessionizeFixture(), {
    env: { ENDUSERS_TODAY: '2030-01-01' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.outputs[OUTPUT]).talkCount, 1);
});

test('rejects a slug that names no event', () => {
  const result = collect(sessionizeFixture(), { args: ['kubecon-mars-2026'] });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /no such event in data\/end-user-talk-events\.json: kubecon-mars-2026/,
  );
  assert.equal(result.requests.length, 0);
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

// A conference published on Sched has no JSON feed: the collector reads the
// listing for every session's schedule fields and the calendar export for
// the abstracts, the way scripts/lib/sched-schedule.mjs parses them, and a
// session's own page only when the export flattened its paragraphs.
const SCHED = 'https://kccncind2026.sched.com/';
const INDIA_OUTPUT = 'data/end-user-talks/kubecon-india-2026.json';
const indiaEvent = {
  slug: 'kubecon-india-2026',
  source: 'sched',
  sourceUrl: SCHED,
  apiUrl: `${SCHED}list/descriptions`,
  sessionUrl: `${SCHED}event/{id}`,
  location: 'Mumbai',
  timezone: 'IST (UTC+5:30)',
  utcOffset: '+05:30',
  selection: 'presented by speakers from end user organizations',
  select: { sessionIds: ['2IW2R', '2IW4c'] },
};
const OUTAGE =
  '<html><head><title>We’ll be back in a minute – Sched</title></head></html>';

const schedSessions = {
  '2IW2R': {
    uid: 'aaaa',
    title: 'Who Watches the Watchers? - Sandeep Kanabar &amp; Aditi Gupta, Gen',
    date: 'Thursday June 18, 2026 2:30pm - 3:00pm',
    start: '20260618T090000Z',
    end: '20260618T093000Z',
    speakers: ['Sandeep Kanabar', 'Aditi Gupta'],
    room: 'Lotus 2 (Level 3)',
    description: 'Observability is your safety net.\\n\\nAt scale it fails.',
  },
  '2IW4c': {
    uid: 'bbbb',
    title: 'Keynote: Walmart at Scale - Priya Singh, Walmart',
    date: 'Thursday June 18, 2026 9:00am - 9:15am',
    start: '20260618T033000Z',
    end: '20260618T034500Z',
    speakers: ['Priya Singh'],
    room: 'Grand Ballroom',
    description: 'Walmart runs big. It scales.',
  },
  '2ZZZZ': {
    uid: 'cccc',
    title: 'Sponsor Lunch',
    date: 'Thursday June 18, 2026 12:00pm - 1:00pm',
    start: '20260618T063000Z',
    end: '20260618T070000Z',
    speakers: [],
    room: 'Foyer',
    description: '',
  },
};

function schedListing(sessions) {
  return Object.entries(sessions)
    .map(
      ([id, { uid, title, date, room, speakers }]) =>
        `<div class="sched-container-inner"><a href="event/${id}/slug" id="${uid}" class="name"><span class="session-title">${title}</span></a>
<div class="list-single__date">${date}<span class='tz'>IST</span></div>
<div class="list-single__location"><a href="venue/x">${room}</a></div>
${speakers.map((s) => `<h2><a href="speaker/${s}" title="${s}">${s}</a></h2>`).join('')}
</div>`,
    )
    .join('\n');
}

function schedCalendar(sessions) {
  return Object.values(sessions)
    .map(
      ({ uid, start, end, description }) =>
        `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${start}\r\nDTEND:${end}\r\nDESCRIPTION:${description}\r\nEND:VEVENT`,
    )
    .join('\r\n');
}

function schedPage(description) {
  return `<html><head><script type="application/ld+json">${JSON.stringify({
    '@type': 'Event',
    description,
  })}</script></head><body></body></html>`;
}

const WALMART_PAGE = schedPage('Walmart runs big.<br><br>It scales.');

function collectSched({
  sessions = schedSessions,
  listing = schedListing(sessions),
  calendar = schedCalendar(sessions),
  pages = { '2IW4c': WALMART_PAGE },
  routes = [],
  event = indiaEvent,
} = {}) {
  return runScriptInSandbox({
    script: 'collect-end-user-talks.mjs',
    routes: [
      ...routes,
      { match: `${SCHED}list/descriptions`, body: listing },
      { match: `${SCHED}all.ics`, body: calendar },
      ...Object.entries(pages).map(([id, body]) => ({
        match: `${SCHED}event/${id}`,
        body,
      })),
    ],
    outputs: [INDIA_OUTPUT],
    fixtures: { [EVENTS]: JSON.stringify({ events: [event] }) },
    env: { ENDUSERS_SCHED_RETRY_DELAYS_MS: '1,1,1', ENDUSERS_TODAY: TODAY },
  });
}

test('reads a Sched event from its listing and calendar export', () => {
  const result = collectSched();
  assert.equal(result.status, 0, result.stderr);
  const india = JSON.parse(result.outputs[INDIA_OUTPUT]);
  assert.equal(india.source, 'sched');
  assert.equal(
    india.description,
    'Generated from the official Sched listing by npm run collect:end-user-talks. Do not hand-edit.',
  );
  assert.equal(india.apiUrl, indiaEvent.apiUrl);
  assert.equal(india.talkCount, 2);
  const talks = india.days[0].slots.flatMap((slot) => slot.talks);
  assert.deepEqual(
    talks.map((talk) => talk.id),
    ['2IW4c', '2IW2R'],
  );
  assert.equal(india.days[0].slots[1].start, '2026-06-18T14:30:00+05:30');
  assert.equal(india.days[0].slots[1].startLabel, '2:30 PM');
  assert.deepEqual(talks[1], {
    id: '2IW2R',
    title: 'Who Watches the Watchers?',
    speakers: 'Sandeep Kanabar, Aditi Gupta',
    room: 'Lotus 2 (Level 3)',
    url: `${SCHED}event/2IW2R`,
    description: 'Observability is your safety net.\n\nAt scale it fails.',
  });
  // The export flattened this abstract, so its page restores the paragraphs.
  assert.equal(talks[0].description, 'Walmart runs big.\n\nIt scales.');
  // Sched refuses Node's default agent; every request identifies the site
  // and asks for the listing, the calendar and only the flattened page.
  assert.deepEqual(
    result.requests.map((request) => request.url),
    [`${SCHED}list/descriptions`, `${SCHED}all.ics`, `${SCHED}event/2IW4c`],
  );
  for (const request of result.requests) {
    assert.equal(
      request.headers['User-Agent'],
      'Mozilla/5.0 (compatible; endusers.cncf.io collector)',
    );
  }
});

test('a Sessionize snapshot records its source', () => {
  const result = collect();
  assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(result.outputs[OUTPUT]);
  assert.equal(catalog.source, 'sessionize');
  assert.equal(
    catalog.description,
    'Generated from the official Sessionize API by npm run collect:end-user-talks. Do not hand-edit.',
  );
});

test('retries a Sched document through a 503 and a maintenance page', () => {
  const result = collectSched({
    routes: [
      {
        match: `${SCHED}all.ics`,
        sequence: [
          { status: 503, body: OUTAGE },
          { status: 200, body: OUTAGE },
          { status: 200, body: schedCalendar(schedSessions) },
        ],
      },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.outputs[INDIA_OUTPUT]).talkCount, 2);
  assert.equal(
    result.requests.filter((request) => request.url.endsWith('all.ics')).length,
    3,
  );
});

test('gives up on a Sched document after the retries are spent', () => {
  const outage = collectSched({
    routes: [{ match: `${SCHED}list/descriptions`, body: OUTAGE }],
  });
  assert.notEqual(outage.status, 0);
  assert.match(
    outage.stderr,
    /Sched returned its maintenance page for https:\/\/kccncind2026.sched.com\/list\/descriptions/,
  );
  assert.equal(outage.requests.length, 4);

  const forbidden = collectSched({
    routes: [{ match: `${SCHED}event/2IW4c`, status: 403 }],
  });
  assert.notEqual(forbidden.status, 0);
  assert.match(
    forbidden.stderr,
    /Sched returned 403 for https:\/\/kccncind2026.sched.com\/event\/2IW4c/,
  );
});

test('fails when a curated Sched session id has left the listing', () => {
  const { '2IW4c': dropped, ...rest } = schedSessions;
  assert.ok(dropped);
  const result = collectSched({ listing: schedListing(rest) });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /kubecon-india-2026: curated session ids are missing from the feed: 2IW4c/,
  );
  assert.equal(result.requests.length, 1);
});

test('fails when a listed Sched session is missing from the calendar export', () => {
  const { '2IW2R': dropped, ...rest } = schedSessions;
  assert.ok(dropped);
  const result = collectSched({ calendar: schedCalendar(rest) });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /kubecon-india-2026: session 2IW2R is listed but missing from the calendar export/,
  );
});

test('fails when the listing and calendar disagree with the configured offset', () => {
  const result = collectSched({
    event: { ...indiaEvent, utcOffset: '+08:00' },
  });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /kubecon-india-2026: session 2IW2R runs 2026-06-18T14:30:00 to 2026-06-18T15:00:00 locally but 2026-06-18T09:00:00Z to 2026-06-18T09:30:00Z UTC, which is not the configured UTC\+08:00/,
  );
  // An end time that drifts on its own is caught too.
  const drifted = collectSched({
    sessions: {
      ...schedSessions,
      '2IW2R': { ...schedSessions['2IW2R'], end: '20260618T100000Z' },
    },
  });
  assert.notEqual(drifted.status, 0);
  assert.match(drifted.stderr, /session 2IW2R runs/);
});

test('fails when a Sched session lacks a speaker or room', () => {
  const result = collectSched({
    sessions: {
      ...schedSessions,
      '2IW4c': { ...schedSessions['2IW4c'], speakers: [] },
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /incomplete/i);
});
