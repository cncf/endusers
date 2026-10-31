#!/usr/bin/env node
// Refresh the 2026 schedule snapshot with npm run collect:end-user-talks.
// This is the public JSON API embedded by the official LF schedule, not HTML.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sourceUrl =
  'https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/program/schedule/';
const apiUrl = 'https://sessionize.com/api/v2/svi82w6c/view/All';
// Sessionize publishes event-local timestamps with no zone. Salt Lake City is
// on MST for the November dates (US DST ends 2026-11-01), so this offset makes
// each published stamp absolute instead of a local date-and-time string that
// every machine reader of <time dateTime> resolves in its own zone (#2038).
// Keep it in step with the human-readable `timezone` label below.
const timezone = 'MST (UTC−7)';
const utcOffset = '-07:00';
const response = await fetch(apiUrl);
if (!response.ok) throw new Error(`Sessionize API returned ${response.status}`);
const schedule = await response.json();
const category = schedule.categories
  .find((item) => item.title === 'End User Programming')
  ?.items.find((item) => item.name === 'End User Talk');
if (!category) throw new Error('Official End User Talk category is missing');

const sessions = schedule.sessions
  .filter((session) => session.categoryItems.includes(category.id))
  .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
if (!sessions.length)
  throw new Error('Official End User Talk category is empty');
const rooms = new Map(
  schedule.rooms.map((room) => [room.id, room.name.trim()]),
);
const speakers = new Map(
  schedule.speakers.map((speaker) => [speaker.id, speaker.fullName]),
);
const days = new Map();
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
  const start = `${session.startsAt}${utcOffset}`;
  const end = `${session.endsAt}${utcOffset}`;
  let slot = day.slots.find((item) => item.start === start && item.end === end);
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
  slot.talks.push({
    id: session.id,
    title: session.title,
    speakers: names.join(', '),
    room,
    url: `${sourceUrl}?id=${session.id}`,
  });
}

const data = {
  description:
    'Generated from the official Sessionize API by npm run collect:end-user-talks. Do not hand-edit.',
  sourceUrl,
  apiUrl,
  category: 'End User Programming / End User Talk',
  generatedAt: new Date().toISOString(),
  timezone,
  talkCount: sessions.length,
  days: [...days.values()],
};
const outputPath = new URL('../data/end-user-talks.json', import.meta.url);
// Only bump generatedAt and rewrite the schedule when the talks themselves
// changed (ADR 0009). The Sessionize schedule is fixed once published, so
// touching generatedAt on every weekly refresh-metrics.yml run would open
// a no-op PR each time (#1935).
const contentOnly = (value) =>
  JSON.stringify(value, (key, field) =>
    key === 'generatedAt' ? undefined : field,
  );
if (
  existsSync(outputPath) &&
  contentOnly(JSON.parse(readFileSync(outputPath, 'utf8'))) ===
    contentOnly(data)
) {
  console.log(
    'No End User Talk changes detected; leaving data/end-user-talks.json untouched.',
  );
  process.exit(0);
}
mkdirSync(new URL('../data', import.meta.url), { recursive: true });
writeFileSync(outputPath, JSON.stringify(data, null, 2) + '\n');
console.log(
  `Collected ${data.talkCount} End User Talks across ${data.days.length} days from ${apiUrl}`,
);
