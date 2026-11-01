// Parsers for a conference schedule published on Sched (<event>.sched.com),
// which exposes no keyless API. The collector reads two public documents per
// event, the `/list/descriptions` listing of every session and the `all.ics`
// calendar export, and this module turns them into the plain fields
// scripts/collect-end-user-talks.mjs shares with its Sessionize path. The
// listing carries each session's short id, title, speakers, room and
// event-local times; the calendar carries the full abstract and UTC times,
// keyed by the long uid the listing also prints. The export flattens
// abstracts whose paragraph breaks were authored as HTML line breaks, so the
// collector reads the session page for those alone.

// Sched emits UTF-8 text directly and escapes only the markup-significant
// characters, so this decoder covers those plus numeric references.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ' };

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(amp|lt|gt|quot|nbsp);/g, (_, name) => NAMED_ENTITIES[name]);
}

const SPEAKER_HEADING = /<h2><a href="speaker\/[^"]*" title="([^"]*)">/g;

/**
 * Whether a response body is the schedule and not Sched's maintenance
 * interstitial, which it serves with both 503 and 200 status codes.
 *
 * @param {string} html
 * @returns {boolean}
 */
export function isSchedOutage(html) {
  return /<title>[^<]*be back in a minute/i.test(html);
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

// "Wednesday March 25, 2026 16:00 - 16:30" or "Friday June 19, 2026 10:07am
// - 10:10am", depending on the clock the event's Sched is configured with.
const LISTING_TIME =
  /^\w+ (\w+) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2})(am|pm)? - (\d{1,2}):(\d{2})(am|pm)?$/;

function parseListingTimes(text) {
  const match = LISTING_TIME.exec(text.replace(/\s+/g, ' '));
  const month = match ? MONTHS.indexOf(match[1].toLowerCase()) : -1;
  if (month === -1) {
    throw new Error(`Sched listing has no usable session time: ${text}`);
  }
  const [
    ,
    ,
    day,
    year,
    startHour,
    startMinute,
    startHalf,
    endHour,
    endMinute,
    endHalf,
  ] = match;
  const date = `${year}-${String(month + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
  return {
    startsAt: `${date}T${clockTime(startHour, startMinute, startHalf)}:00`,
    endsAt: `${date}T${clockTime(endHour, endMinute, endHalf)}:00`,
  };
}

// ("10", "07", "am") / ("7", "00", "pm") / ("16", "00", undefined) -> "HH:MM".
function clockTime(hour, minute, meridiem) {
  let hours = Number(hour);
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (meridiem === 'pm' && hours !== 12) hours += 12;
  return `${String(hours).padStart(2, '0')}:${minute}`;
}

/**
 * Every session on a Sched `/list/descriptions` listing, keyed by its short
 * id. A curated id absent from the listing is a dropped session the curator
 * must act on, the same contract as a Sessionize feed. Times are the
 * event-local stamps the listing prints; the calendar export supplies the
 * UTC ones, and the collector checks the two agree with the configured
 * offset.
 *
 * @param {string} html
 * @returns {Map<string, {
 *   uid: string, title: string, speakers: string[], room: string,
 *   startsAt: string, endsAt: string,
 * }>}
 */
export function parseSchedListing(html) {
  const sessions = new Map();
  for (const block of html.split('<div class="sched-container-inner">')) {
    const head =
      /href="event\/([A-Za-z0-9]+)\/[^"]*" id="([0-9a-f]+)" class="name">\s*<span class="session-title">([\s\S]*?)<\/span>/.exec(
        block,
      );
    if (!head) continue;
    const [, id, uid, name] = head;
    const speakers = [...block.matchAll(SPEAKER_HEADING)].map(([, speaker]) =>
      decodeEntities(speaker).trim(),
    );
    const time = /<div class="list-single__date">\s*([^<]*?)\s*<span/.exec(
      block,
    );
    const room =
      /<div class="list-single__location">\s*<a[^>]*>\s*([^<]*?)\s*<\/a>/.exec(
        block,
      );
    sessions.set(id, {
      uid,
      title: stripSpeakerSuffix(decodeEntities(name), speakers),
      speakers,
      room: room ? decodeEntities(room[1]) : '',
      ...parseListingTimes(time ? time[1] : ''),
    });
  }
  return sessions;
}

/**
 * Every event in a Sched `all.ics` calendar export, keyed by uid. Sched
 * publishes the calendar in UTC (`X-WR-TIMEZONE:UTC`) and the abstract as
 * RFC 5545 escaped text, so this is where the full description comes from.
 *
 * @param {string} ics
 * @returns {Map<string, { startsAt: string, endsAt: string, description: string }>}
 */
export function parseSchedCalendar(ics) {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '').replace(/\r\n/g, '\n');
  const events = new Map();
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const field = (name) =>
      new RegExp(`^${name}:(.*)$`, 'm').exec(block)?.[1] ?? '';
    const uid = field('UID');
    if (!uid) throw new Error('Sched calendar has an event without a UID');
    events.set(uid, {
      startsAt: utcStamp(field('DTSTART')),
      endsAt: utcStamp(field('DTEND')),
      description: descriptionText(unescapeIcs(field('DESCRIPTION'))),
    });
  }
  return events;
}

// "20260325T150000Z" -> "2026-03-25T15:00:00Z".
function utcStamp(value) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) {
    throw new Error(`Sched calendar has no usable UTC timestamp: ${value}`);
  }
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

function unescapeIcs(text) {
  return text.replace(/\\([\\;,nN])/g, (_, char) =>
    char === 'n' || char === 'N' ? '\n' : char,
  );
}

/**
 * The abstract on one Sched session page, from its schema.org Event JSON-LD,
 * with HTML line breaks kept as paragraph breaks.
 *
 * @param {string} html
 * @returns {string}
 */
export function parseSchedDescription(html) {
  const jsonLd =
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  if (!jsonLd) {
    throw new Error('Sched session page has no schema.org Event data');
  }
  return descriptionText(JSON.parse(jsonLd[1]).description ?? '');
}

/**
 * The event-local stamp of a UTC instant at the configured offset, in the
 * "YYYY-MM-DDTHH:MM:SS" shape the Sessionize path uses.
 *
 * @param {string} utc "2026-03-25T15:00:00Z"
 * @param {string} offset "+01:00"
 * @returns {string}
 */
export function toLocalStamp(utc, offset) {
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(':').map(Number);
  const shifted = new Date(
    Date.parse(utc) + sign * (hours * 60 + minutes) * 60_000,
  );
  return shifted.toISOString().slice(0, 19);
}

/**
 * Strips the "Title - Speaker, Company; Speaker, Company" suffix the Linux
 * Foundation appends to every Sched session name. A title may itself contain
 * " - ", so the cut is at the last separator whose tail names one of the
 * session's speakers. The schedule abbreviates or recases some first names,
 * so the surname is what is looked for, case-insensitively; a title that
 * names no speaker is returned unchanged.
 *
 * @param {string} name
 * @param {string[]} speakers
 * @returns {string}
 */
export function stripSpeakerSuffix(name, speakers) {
  const surnames = speakers.map((speaker) =>
    speaker.split(' ').at(-1).toLowerCase(),
  );
  const separators = [];
  for (
    let at = name.indexOf(' - ');
    at !== -1;
    at = name.indexOf(' - ', at + 1)
  ) {
    separators.unshift(at);
  }
  const at = separators.find((index) => {
    const tail = name.slice(index + 3).toLowerCase();
    return surnames.some((surname) => tail.includes(surname));
  });
  // No separator named a speaker: `at` is undefined and slice keeps it all.
  return name.slice(0, at).trim();
}

// Sched stores abstracts as HTML with <br> line breaks; the component splits
// paragraphs on blank lines, so breaks become newlines, other tags go, and
// runs of blank lines collapse to one. Tags are stripped until none remain,
// so a tag nested inside another ("<scr<b>ipt>") does not survive the pass.
// Calendar text has already lost its tags but takes the same normalization.
function descriptionText(html) {
  let text = html.replace(/<br\s*\/?>/gi, '\n');
  let before;
  do {
    before = text;
    text = text.replace(/<[^<>]*>/g, '');
  } while (text !== before);
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
