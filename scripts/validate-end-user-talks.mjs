#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { checkUrl, reportAndExit } from './lib/validate-utils.mjs';

// src/components/EndUserTalkSchedule renders `sourceUrl`, `apiUrl` and every
// `talk.url` out of data/end-user-talks/<slug>.json as an <a href>, under
// anchor text (a talk title, a provenance label) that never shows the
// destination. A re-pointed link therefore reads as fine in a JSON diff and
// ships to every visitor of /events.
//
// tests/end-user-talks-data.test.mjs already asserts this contract, but a unit
// test only gates the pull-request lane. The Netlify build -- which netlify.toml
// documents as the only gate automation-authored data passes before it
// publishes, because such pull requests are authored by github.token and never
// start ci.yml -- runs `validate:all` and `build:production`, and no unit tests.
// This validator is what puts the allow-list on that path, the way every other
// dataset under data/ is already covered by a validate:* script.
//
// The hosts are the ones data/end-user-talk-events.json may point a snapshot
// at: the Linux Foundation and LF Open Source China schedules, and Sessionize,
// which also serves the event subdomains the China schedule lives on. A
// suffix match, not an equality test: checkUrl() accepts the host itself or
// any subdomain of it, and rejects a lookalike that merely ends in the same
// characters.
const SCHEDULE_HOSTS = [
  'events.linuxfoundation.org',
  'lfopensource.cn',
  'sessionize.com',
];
const API_HOST = 'sessionize.com';
// Recordings are published on the CNCF YouTube channel; the short host is
// what a share button hands a maintainer.
const RECORDING_HOSTS = ['youtube.com', 'youtu.be'];
const UTC_OFFSET = /^[+-]\d{2}:\d{2}$/;

const dataDir = new URL('../data/', import.meta.url);
const EVENTS_PATH = 'end-user-talk-events';
const eventsDocument = JSON.parse(
  readFileSync(new URL(`${EVENTS_PATH}.json`, dataDir)),
);
// The hand-maintained overlay the collector merges into each talk. Its ids
// are checked against the schedules below so a talk that leaves Sessionize
// cannot leave an orphaned link behind, and each generated talk is checked
// against it so a snapshot regenerated before the overlay was edited fails.
const linksPath = new URL('end-user-talk-links.json', dataDir);
const linksDocument = existsSync(linksPath)
  ? JSON.parse(readFileSync(linksPath))
  : { links: [] };
const errors = [];

function fail(path, message) {
  errors.push({ path, severity: 'error', message });
}

function checkLink(path, field, value, hosts) {
  checkUrl(errors, path, field, value, {
    requireNonEmptyString: true,
    allowedHostSuffixes: hosts,
    unparsedMessage: `${field} must be an absolute https URL: ${JSON.stringify(value)}`,
  });
}

// The curated conference list the collector reads. A bad entry here is what
// a bad snapshot would be generated from, so it is reported at its source.
const events = [];
const slugs = new Set();
if (!Array.isArray(eventsDocument?.events)) {
  fail(EVENTS_PATH, 'must carry an events array');
}
for (const [index, event] of (Array.isArray(eventsDocument?.events)
  ? eventsDocument.events
  : []
).entries()) {
  const path = `${EVENTS_PATH} events[${index}]`;
  if (typeof event?.slug !== 'string' || !/^[a-z0-9-]+$/.test(event.slug)) {
    fail(path, 'slug must be lowercase letters, digits and hyphens');
    continue;
  }
  if (slugs.has(event.slug)) {
    fail(path, `duplicate slug ${event.slug}`);
    continue;
  }
  slugs.add(event.slug);
  checkLink(path, 'sourceUrl', event.sourceUrl, SCHEDULE_HOSTS);
  checkLink(path, 'apiUrl', event.apiUrl, [API_HOST]);
  if (
    typeof event.sessionUrl !== 'string' ||
    !event.sessionUrl.includes('{id}')
  ) {
    fail(path, 'sessionUrl must be a template containing {id}');
  } else {
    checkLink(path, 'sessionUrl', event.sessionUrl, SCHEDULE_HOSTS);
  }
  for (const field of ['location', 'timezone', 'selection']) {
    if (typeof event[field] !== 'string' || !event[field]) {
      fail(path, `${field} must be a non-empty string`);
    }
  }
  if (
    typeof event.utcOffset !== 'string' ||
    !UTC_OFFSET.test(event.utcOffset)
  ) {
    fail(path, 'utcOffset must look like +08:00 or -07:00');
  }
  const { select } = event;
  const ids = select?.sessionIds;
  const byIds =
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.every((id) => typeof id === 'string' && id);
  const byCategory =
    typeof select?.category === 'string' &&
    select.category &&
    typeof select?.item === 'string' &&
    select.item;
  if (!byIds && !byCategory) {
    fail(
      path,
      'select must be { category, item } or { sessionIds } with at least one id',
    );
  }
  events.push(event);
}

const LINKS_PATH = 'end-user-talk-links';
const curated = new Map();
if (!Array.isArray(linksDocument?.links)) {
  fail(LINKS_PATH, 'must carry a links array');
}
for (const [index, entry] of (Array.isArray(linksDocument?.links)
  ? linksDocument.links
  : []
).entries()) {
  const path = `${LINKS_PATH} links[${index}]`;
  if (typeof entry?.id !== 'string' || !entry.id) {
    fail(path, 'id must be a non-empty string');
    continue;
  }
  if (curated.has(entry.id)) {
    fail(path, `duplicate id ${entry.id}`);
    continue;
  }
  const previous = Array.from(curated.keys()).at(-1);
  if (previous !== undefined && previous.localeCompare(entry.id, 'en') > 0) {
    fail(path, `id ${entry.id} is out of order; keep links sorted by id`);
  }
  if (!entry.slides && !entry.recording) {
    fail(path, 'must carry slides, recording or both');
  }
  checkUrl(errors, path, 'slides', entry.slides, { allowEmpty: true });
  checkUrl(errors, path, 'recording', entry.recording, {
    allowEmpty: true,
    allowedHostSuffixes: RECORDING_HOSTS,
  });
  curated.set(entry.id, entry);
}

// One snapshot per configured event, and no snapshot without an event: a
// stray file under data/end-user-talks/ would never be refreshed again.
const snapshotDir = new URL('end-user-talks/', dataDir);
const snapshots = existsSync(snapshotDir)
  ? readdirSync(snapshotDir).filter((name) => name.endsWith('.json'))
  : [];
for (const name of snapshots) {
  if (!slugs.has(name.slice(0, -'.json'.length))) {
    fail(
      `end-user-talks/${name}`,
      `names no event in ${EVENTS_PATH}.json; remove the stale snapshot or add its event`,
    );
  }
}

const seenIds = new Set();
let talkCount = 0;
for (const event of events) {
  const snapshotPath = new URL(`${event.slug}.json`, snapshotDir);
  const pathPrefix = `end-user-talks/${event.slug}`;
  if (!existsSync(snapshotPath)) {
    fail(pathPrefix, 'snapshot is missing; run npm run collect:end-user-talks');
    continue;
  }
  const data = JSON.parse(readFileSync(snapshotPath));
  // The snapshot's provenance must be the event's own, not a stale copy of
  // another conference's feed that happens to parse.
  for (const field of ['sourceUrl', 'apiUrl']) {
    if (data?.[field] !== event[field]) {
      fail(
        pathPrefix,
        `${field} does not match ${EVENTS_PATH}.json; re-run npm run collect:end-user-talks`,
      );
    }
  }
  for (const day of Array.isArray(data?.days) ? data.days : []) {
    for (const slot of Array.isArray(day?.slots) ? day.slots : []) {
      for (const talk of Array.isArray(slot?.talks) ? slot.talks : []) {
        talkCount += 1;
        const id = typeof talk?.id === 'string' ? talk.id : 'unknown';
        const path = `${pathPrefix} ${id}`;
        seenIds.add(talk?.id);
        if (typeof talk?.description !== 'string') {
          fail(
            path,
            'description must be a string (empty when Sessionize has none)',
          );
        }
        // The generated links are the overlay's, or the feed's recording when
        // the overlay has none for this talk; a curated slides link the
        // snapshot lacks means the collector has not been re-run.
        const entry = curated.get(talk?.id);
        if (entry?.slides && talk.slides !== entry.slides) {
          fail(
            path,
            `slides does not match end-user-talk-links.json; re-run npm run collect:end-user-talks`,
          );
        }
        if (entry?.recording && talk.recording !== entry.recording) {
          fail(
            path,
            `recording does not match end-user-talk-links.json; re-run npm run collect:end-user-talks`,
          );
        }
        checkUrl(errors, path, 'slides', talk?.slides, { allowEmpty: true });
        checkUrl(errors, path, 'recording', talk?.recording, {
          allowEmpty: true,
          allowedHostSuffixes: RECORDING_HOSTS,
        });
        // Each talk link is the event's deep link for that id and nothing
        // else, so a re-pointed url cannot pass on its host alone.
        const expected = event.sessionUrl.replace('{id}', id);
        if (talk?.url !== expected) {
          fail(
            path,
            `url must be ${expected}, got ${JSON.stringify(talk?.url)}`,
          );
        }
      }
    }
  }
}

for (const id of curated.keys()) {
  if (!seenIds.has(id)) {
    fail(
      LINKS_PATH,
      `id ${id} names no talk in data/end-user-talks/; remove the stale entry`,
    );
  }
}

reportAndExit(errors, 'end user talks');
console.log(`Validated ${talkCount} end user talk links`);
