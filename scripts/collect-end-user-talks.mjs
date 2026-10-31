#!/usr/bin/env node
// Refresh the schedule snapshots with npm run collect:end-user-talks. Each
// conference in data/end-user-talk-events.json is read from the public JSON
// API embedded by its official schedule, not HTML, and written to
// data/end-user-talks/<slug>.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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

async function collect(event) {
  const response = await fetch(event.apiUrl);
  if (!response.ok) {
    throw new Error(`Sessionize API returned ${response.status}`);
  }
  const schedule = await response.json();
  const sessions = selectSessions(event, schedule).sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
  if (!sessions.length) {
    throw new Error(`${event.slug}: no end user talks selected`);
  }
  const rooms = new Map(
    schedule.rooms.map((room) => [room.id, room.name.trim()]),
  );
  const speakers = new Map(
    schedule.speakers.map((speaker) => [speaker.id, speaker.fullName]),
  );
  const days = new Map();

  for (const session of sessions) {
    const room = rooms.get(session.roomId);
    const names = session.speakers.map((id) => speakers.get(id));
    const missing =
      !session.title ||
      !session.startsAt ||
      !session.endsAt ||
      !room ||
      !names.length;
    if (missing) {
      throw new Error(
        `Official session ${session.id} has incomplete schedule data`,
      );
    }
    const date = session.startsAt.slice(0, 10);
    if (!days.has(date)) {
      // Sessionize publishes event-local timestamps; do not shift them to the
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
    // Sessionize publishes event-local timestamps with no zone; the event's
    // offset makes each published stamp absolute instead of a local
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
      // Sessionize separates abstract paragraphs with CRLF; the component
      // splits on blank lines, so normalize to LF and trim stray whitespace.
      description: session.description?.replaceAll('\r\n', '\n').trim() || '',
    };
    if (curated.slides) talk.slides = curated.slides;
    // A curated recording wins over the feed's, which the feed has never
    // carried; the fallback is there for the day Sessionize starts to.
    const recording = curated.recording || session.recordingUrl;
    if (recording) talk.recording = recording;
    slot.talks.push(talk);
  }

  return {
    description:
      'Generated from the official Sessionize API by npm run collect:end-user-talks. Do not hand-edit.',
    sourceUrl: event.sourceUrl,
    apiUrl: event.apiUrl,
    selection: event.selection,
    location: event.location,
    generatedAt: new Date().toISOString(),
    timezone: event.timezone,
    talkCount: sessions.length,
    days: [...days.values()],
  };
}

// Only bump generatedAt and rewrite a schedule when its talks themselves
// changed (ADR 0009). A Sessionize schedule is fixed once published, so
// touching generatedAt on every weekly refresh-metrics.yml run would open a
// no-op PR each time (#1935).
const contentOnly = (value) =>
  JSON.stringify(value, (key, field) =>
    key === 'generatedAt' ? undefined : field,
  );

mkdirSync(new URL('end-user-talks/', dataDir), { recursive: true });
for (const event of events) {
  const data = await collect(event);
  const outputPath = new URL(`end-user-talks/${event.slug}.json`, dataDir);
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
