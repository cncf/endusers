// Parsers for a conference schedule published on Sched (<event>.sched.com),
// which exposes no keyless API. The collector reads the public listing of
// every session and each curated session's own page; this module turns those
// HTML documents into the plain fields scripts/collect-end-user-talks.mjs
// shares with its Sessionize path.

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

/**
 * The ids of every session on a Sched `/list/descriptions` listing. A
 * curated id absent from the listing is a dropped session the curator must
 * act on, the same contract as a Sessionize feed.
 *
 * @param {string} html
 * @returns {Set<string>}
 */
export function parseSchedListing(html) {
  return new Set(
    [
      ...html.matchAll(/href="event\/([A-Za-z0-9]+)\/[^"]*" id="[0-9a-f]+"/g),
    ].map(([, id]) => id),
  );
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

/**
 * The schedule fields of one Sched session page. Times come from the page's
 * schema.org Event JSON-LD, which carries the event's own UTC offset; the
 * offset is returned separately so the collector can check it against the
 * event's configured one rather than trusting either alone.
 *
 * @param {string} html
 * @returns {{
 *   title: string, startsAt: string, endsAt: string, utcOffset: string,
 *   room: string, speakers: string[], description: string,
 * }}
 */
export function parseSchedSession(html) {
  const jsonLd = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );
  if (!jsonLd) {
    throw new Error('Sched session page has no schema.org Event data');
  }
  const event = JSON.parse(jsonLd[1]);
  const speakers = [...html.matchAll(SPEAKER_HEADING)].map(([, name]) =>
    decodeEntities(name).trim(),
  );
  const room = html.match(
    /<div class="sched-event-details-timeandplace">[\s\S]*?<a href='venue\/[^']*'>([^<]*)<\/a>/,
  );
  const [, startsAt, startOffset] = splitStamp(event.startDate);
  const [, endsAt, endOffset] = splitStamp(event.endDate);
  if (startOffset !== endOffset) {
    throw new Error(
      `Sched session starts and ends in different UTC offsets: ${event.startDate} ${event.endDate}`,
    );
  }
  return {
    title: stripSpeakerSuffix(decodeEntities(event.name ?? ''), speakers),
    startsAt,
    endsAt,
    utcOffset: startOffset,
    room: room ? decodeEntities(room[1]).trim() : '',
    speakers,
    description: descriptionText(event.description ?? ''),
  };
}

// "2026-06-18T14:30:00+0530" -> local stamp and the "+05:30" offset the event
// config spells.
function splitStamp(stamp) {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{2}):?(\d{2})$/.exec(stamp);
  if (!match) {
    throw new Error(`Sched session has no usable timestamp: ${stamp}`);
  }
  return [match[0], match[1], `${match[2]}:${match[3]}`];
}

// Sched stores abstracts as HTML with <br> line breaks; the component splits
// paragraphs on blank lines, so breaks become newlines, other tags go, and
// runs of blank lines collapse to one. Tags are stripped until none remain,
// so a tag nested inside another ("<scr<b>ipt>") does not survive the pass.
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
