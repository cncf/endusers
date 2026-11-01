#!/usr/bin/env node
// Refresh the schedule snapshots with npm run collect:end-user-talks. Each
// conference in data/end-user-talk-events.json is read from its official
// schedule's public data -- the Sessionize JSON API the Linux Foundation
// schedules embed, or the Sched listing and calendar export when a conference
// publishes on Sched instead -- and written to data/end-user-talks/<slug>.json.
//
// A schedule is final once its event has run, so an event whose snapshot ends
// before today is skipped, and the weekly refresh-metrics.yml run fetches only
// upcoming conferences. Name an event's slug (or pass --all) to refresh it
// anyway, as after curating a past event's slides and recording links.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  isSchedOutage,
  parseSchedCalendar,
  parseSchedDescription,
  parseSchedListing,
  toLocalStamp,
} from './lib/sched-schedule.mjs';

const dataDir = new URL('../data/', import.meta.url);
const { events } = JSON.parse(
  readFileSync(new URL('end-user-talk-events.json', dataDir), 'utf8'),
);

// Slides and recordings are not part of the Sessionize feed (its recordingUrl
// is empty for every End User Talk), so maintainers curate them by session id
// in data/end-user-talk-links.json and the collector merges them into each
// talk on every refresh. scripts/validate-end-user-talks.mjs checks the
// overlay's shape and that every id still names a talk.
const linksPath = new URL('end-user-talk-links.json', dataDir);
const links = new Map(
  (existsSync(linksPath)
    ? JSON.parse(readFileSync(linksPath, 'utf8')).links
    : []
  ).map((entry) => [entry.id, entry]),
);

// A conference is final once its last day is before today. The environment
// override keeps the rule testable on any date.
const today =
  process.env.ENDUSERS_TODAY ?? new Date().toISOString().slice(0, 10);
const hasEnded = (days) => days.at(-1).date < today;

const dateFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

function timeLabel(timestamp) {
  const hour = Number(timestamp.slice(11, 13));
  return `${hour % 12 || 12}:${timestamp.slice(14, 16)} ${hour < 12 ? 'AM' : 'PM'}`;
}

// The sessions an event's `select` rule picks out of its feed. An official
// category is the conference's own designation; a curated id list stands in
// for one where the conference has no end user track, and an id the feed no
// longer carries is a dropped session the curator must act on, not a talk to
// silently skip.
function selectSessions(event, schedule) {
  const { select } = event;
  if (select.sessionIds) {
    const byId = new Map(schedule.sessions.map((s) => [s.id, s]));
    const missing = select.sessionIds.filter((id) => !byId.has(id));
    if (missing.length) {
      throw new Error(
        `${event.slug}: curated session ids are missing from the feed: ${missing.join(', ')}`,
      );
    }
    return select.sessionIds.map((id) => byId.get(id));
  }
  const category = schedule.categories
    .find((item) => item.title === select.category)
    ?.items.find((item) => item.name === select.item);
  if (!category) {
    throw new Error(
      `${event.slug}: official ${select.item} category is missing`,
    );
  }
  return schedule.sessions.filter((session) =>
    session.categoryItems.includes(category.id),
  );
}

// Every source hands the schedule builder the same plain session: event-local
// `startsAt`/`endsAt` stamps with no zone, a room name, speaker names, and
// the abstract as text.
async function loadSessionize(event) {
  const response = await fetch(event.apiUrl);
  if (!response.ok) {
    throw new Error(`Sessionize API returned ${response.status}`);
  }
  const schedule = await response.json();
  const rooms = new Map(
    schedule.rooms.map((room) => [room.id, room.name.trim()]),
  );
  const speakers = new Map(
    schedule.speakers.map((speaker) => [speaker.id, speaker.fullName]),
  );
  return selectSessions(event, schedule).map((session) => ({
    id: session.id,
    title: session.title,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    room: rooms.get(session.roomId),
    speakers: session.speakers.map((id) => speakers.get(id)),
    // Sessionize separates abstract paragraphs with CRLF; the component
    // splits on blank lines, so normalize to LF and trim stray whitespace.
    description: session.description?.replaceAll('\r\n', '\n').trim() || '',
    recordingUrl: session.recordingUrl,
  }));
}

// Sched answers some requests with a maintenance page, under a 503 and under
// a 200 alike, for a few seconds at a time; a refresh must outlast that
// rather than fail a weekly run or, worse, parse the interstitial. The
// environment override keeps the retry path testable without the waits.
const SCHED_RETRY_DELAYS_MS = (
  process.env.ENDUSERS_SCHED_RETRY_DELAYS_MS ?? '2000,5000,10000'
)
  .split(',')
  .map(Number);

// Sched answers Node's default User-Agent with 400 and an empty one with 403;
// it serves a browser-like agent that says who is asking.
const SCHED_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; endusers.cncf.io collector)',
};

async function fetchSched(url) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { headers: SCHED_HEADERS });
    const html = response.ok ? await response.text() : '';
    if (response.ok && !isSchedOutage(html)) return html;
    if (attempt === SCHED_RETRY_DELAYS_MS.length) {
      throw new Error(
        `Sched returned ${response.ok ? 'its maintenance page' : response.status} for ${url}`,
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, SCHED_RETRY_DELAYS_MS[attempt]),
    );
  }
}

// Two documents cover a whole Sched schedule: the listing the event entry
// names as apiUrl, and the calendar export next to it, which carries the full
// abstracts. The export flattens paragraph breaks authored as HTML line
// breaks, so an abstract it leaves without any newline is read from the
// session page instead; the rest of the schedule costs no per-session fetch.
async function loadSched(event) {
  const ids = event.select.sessionIds;
  const listed = parseSchedListing(await fetchSched(event.apiUrl));
  const missing = ids.filter((id) => !listed.has(id));
  if (missing.length) {
    throw new Error(
      `${event.slug}: curated session ids are missing from the feed: ${missing.join(', ')}`,
    );
  }
  const calendar = parseSchedCalendar(
    await fetchSched(new URL('all.ics', event.sourceUrl).href),
  );
  const sessions = [];
  for (const id of ids) {
    const { uid, startsAt, endsAt, ...session } = listed.get(id);
    const entry = calendar.get(uid);
    if (!entry) {
      throw new Error(
        `${event.slug}: session ${id} is listed but missing from the calendar export`,
      );
    }
    // The listing prints event-local times and the calendar UTC ones; they
    // agree only at the right configured offset, and a wrong one would shift
    // every <time dateTime> on the page (#2038).
    const localStart = toLocalStamp(entry.startsAt, event.utcOffset);
    const localEnd = toLocalStamp(entry.endsAt, event.utcOffset);
    if (localStart !== startsAt || localEnd !== endsAt) {
      throw new Error(
        `${event.slug}: session ${id} runs ${startsAt} to ${endsAt} locally but ${entry.startsAt} to ${entry.endsAt} UTC, which is not the configured UTC${event.utcOffset}`,
      );
    }
    const description = entry.description.includes('\n')
      ? entry.description
      : parseSchedDescription(
          await fetchSched(event.sessionUrl.replace('{id}', id)),
        );
    sessions.push({ id, ...session, startsAt, endsAt, description });
  }
  return sessions;
}

const SOURCES = {
  sessionize: { load: loadSessionize, label: 'official Sessionize API' },
  sched: { load: loadSched, label: 'official Sched listing' },
};

async function collect(event) {
  const source = event.source ?? 'sessionize';
  const sessions = (await SOURCES[source].load(event)).sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
  if (!sessions.length) {
    throw new Error(`${event.slug}: no end user talks selected`);
  }
  const days = new Map();

  for (const session of sessions) {
    const { room } = session;
    const names = session.speakers;
    const missing =
      !session.title ||
      !session.startsAt ||
      !session.endsAt ||
      !room ||
      !names.length ||
      names.some((name) => !name);
    if (missing) {
      throw new Error(
        `Official session ${session.id} has incomplete schedule data`,
      );
    }
    const date = session.startsAt.slice(0, 10);
    if (!days.has(date)) {
      // Both sources hand over event-local timestamps; do not shift them to the
      // machine's timezone. UTC here formats only the calendar date's label.
      const label = dateFormat.format(new Date(`${date}T00:00:00Z`));
      days.set(date, {
        date,
        id: label.toLowerCase().replace(',', '').replaceAll(' ', '-'),
        label,
        slots: [],
      });
    }
    const day = days.get(date);
    // The stamps carry no zone; the event's offset makes each one absolute instead of a local
    // date-and-time string that every machine reader of <time dateTime>
    // resolves in its own zone (#2038).
    const start = `${session.startsAt}${event.utcOffset}`;
    const end = `${session.endsAt}${event.utcOffset}`;
    let slot = day.slots.find(
      (item) => item.start === start && item.end === end,
    );
    if (!slot) {
      slot = {
        start,
        end,
        startLabel: timeLabel(session.startsAt),
        endLabel: timeLabel(session.endsAt),
        talks: [],
      };
      day.slots.push(slot);
    }
    const curated = links.get(session.id) ?? {};
    const talk = {
      id: session.id,
      title: session.title,
      speakers: names.join(', '),
      room,
      url: event.sessionUrl.replace('{id}', session.id),
      description: session.description,
    };
    if (curated.slides) talk.slides = curated.slides;
    // A curated recording wins over the feed's, which the feed has never
    // carried; the fallback is there for the day Sessionize starts to.
    const recording = curated.recording || session.recordingUrl;
    if (recording) talk.recording = recording;
    slot.talks.push(talk);
  }

  return withFinal({
    description: `Generated from the ${SOURCES[source].label} by npm run collect:end-user-talks. Do not hand-edit.`,
    source,
    sourceUrl: event.sourceUrl,
    apiUrl: event.apiUrl,
    selection: event.selection,
    location: event.location,
    generatedAt: new Date().toISOString(),
    timezone: event.timezone,
    talkCount: sessions.length,
    days: [...days.values()],
  });
}

// A concluded conference's snapshot carries `final: true`, which the event
// page reads to call the schedule a final record instead of one that may
// still change; an upcoming one carries no flag. The flag sits before `days`
// so a diff of the provenance fields stays readable.
function withFinal(snapshot) {
  if (!hasEnded(snapshot.days)) return snapshot;
  const { days, ...fields } = snapshot;
  return { ...fields, final: true, days };
}

// Only bump generatedAt and rewrite a schedule when its talks themselves
// changed (ADR 0009). A conference schedule is fixed once published, so
// touching generatedAt on every weekly refresh-metrics.yml run would open a
// no-op PR each time (#1935).
const contentOnly = (value) =>
  JSON.stringify(value, (key, field) =>
    key === 'generatedAt' ? undefined : field,
  );

const requested = process.argv.slice(2);
const refreshAll = requested.includes('--all');
const unknown = requested.filter(
  (slug) => slug !== '--all' && !events.some((event) => event.slug === slug),
);
if (unknown.length) {
  throw new Error(
    `no such event in data/end-user-talk-events.json: ${unknown.join(', ')}`,
  );
}
// A snapshot the weekly run would skip is stamped `final: true` the first time
// its last day has passed, without a fetch and without touching generatedAt:
// no talk was re-verified, the event page just learns the conference is over.
// Once stamped, the file is left alone so the run opens no no-op PR.
function finalizeExisting(event, outputPath) {
  if (!existsSync(outputPath)) return false;
  const snapshot = JSON.parse(readFileSync(outputPath, 'utf8'));
  if (!hasEnded(snapshot.days)) return false;
  const hint = `Run npm run collect:end-user-talks -- ${event.slug} to refresh it anyway.`;
  if (snapshot.final === true) {
    console.log(`Skipping ${event.slug}; its schedule is final. ${hint}`);
    return true;
  }
  writeFileSync(
    outputPath,
    JSON.stringify(withFinal(snapshot), null, 2) + '\n',
  );
  console.log(`Marked ${event.slug} final; its last day has passed. ${hint}`);
  return true;
}

mkdirSync(new URL('end-user-talks/', dataDir), { recursive: true });
for (const event of events) {
  const outputPath = new URL(`end-user-talks/${event.slug}.json`, dataDir);
  if (
    !refreshAll &&
    !requested.includes(event.slug) &&
    finalizeExisting(event, outputPath)
  ) {
    continue;
  }
  const data = await collect(event);
  if (
    existsSync(outputPath) &&
    contentOnly(JSON.parse(readFileSync(outputPath, 'utf8'))) ===
      contentOnly(data)
  ) {
    console.log(
      `No End User Talk changes detected for ${event.slug}; leaving data/end-user-talks/${event.slug}.json untouched.`,
    );
    continue;
  }
  writeFileSync(outputPath, JSON.stringify(data, null, 2) + '\n');
  console.log(
    `Collected ${data.talkCount} End User Talks across ${data.days.length} days from ${event.apiUrl}`,
  );
}
