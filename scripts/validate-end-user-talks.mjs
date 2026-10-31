#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { checkUrl, reportAndExit } from './lib/validate-utils.mjs';

// src/components/EndUserTalkSchedule renders `sourceUrl`, `apiUrl` and every
// `talk.url` out of data/end-user-talks.json as an <a href>, under anchor text
// (a talk title, a provenance label) that never shows the destination. A
// re-pointed link therefore reads as fine in a JSON diff and ships to every
// visitor of /events.
//
// tests/end-user-talks-data.test.mjs already asserts this contract, but a unit
// test only gates the pull-request lane. The Netlify build -- which netlify.toml
// documents as the only gate automation-authored data passes before it
// publishes, because such pull requests are authored by github.token and never
// start ci.yml -- runs `validate:all` and `build:production`, and no unit tests.
// This validator is what puts the allow-list on that path, the way every other
// dataset under data/ is already covered by a validate:* script.
//
// The hosts are the two scripts/collect-end-user-talks.mjs builds its output
// from. A suffix match, not an equality test: checkUrl() accepts the host
// itself or any subdomain of it, and rejects a lookalike that merely ends in
// the same characters.
const SCHEDULE_HOST = 'events.linuxfoundation.org';
const API_HOST = 'sessionize.com';
// Recordings are published on the CNCF YouTube channel; the short host is
// what a share button hands a maintainer.
const RECORDING_HOSTS = ['youtube.com', 'youtu.be'];

const data = JSON.parse(
  readFileSync(new URL('../data/end-user-talks.json', import.meta.url)),
);
// The hand-maintained overlay the collector merges into each talk. Its ids
// are checked against the schedule below so a talk that leaves Sessionize
// cannot leave an orphaned link behind, and each generated talk is checked
// against it so a snapshot regenerated before the overlay was edited fails.
const linksPath = new URL('../data/end-user-talk-links.json', import.meta.url);
const linksDocument = existsSync(linksPath)
  ? JSON.parse(readFileSync(linksPath))
  : { links: [] };
const errors = [];

function checkLink(path, field, value, host) {
  checkUrl(errors, path, field, value, {
    requireNonEmptyString: true,
    allowedHostSuffixes: [host],
    unparsedMessage: `${field} must be an absolute https URL: ${JSON.stringify(value)}`,
  });
}

checkLink('end-user-talks', 'sourceUrl', data?.sourceUrl, SCHEDULE_HOST);
checkLink('end-user-talks', 'apiUrl', data?.apiUrl, API_HOST);

// The path every talk link must share with sourceUrl. Derived rather than
// hardcoded so the check follows the conference the snapshot was generated
// for; when sourceUrl is itself unusable there is no path to compare against,
// and the error above is the finding.
let schedulePath;
try {
  schedulePath = new URL(data.sourceUrl).pathname;
} catch {
  schedulePath = null;
}

const LINKS_PATH = 'end-user-talk-links';
const curated = new Map();
if (!Array.isArray(linksDocument?.links)) {
  errors.push({
    path: LINKS_PATH,
    severity: 'error',
    message: 'must carry a links array',
  });
}
for (const [index, entry] of (Array.isArray(linksDocument?.links)
  ? linksDocument.links
  : []
).entries()) {
  const path = `${LINKS_PATH} links[${index}]`;
  if (typeof entry?.id !== 'string' || !entry.id) {
    errors.push({
      path,
      severity: 'error',
      message: 'id must be a non-empty string',
    });
    continue;
  }
  if (curated.has(entry.id)) {
    errors.push({
      path,
      severity: 'error',
      message: `duplicate id ${entry.id}`,
    });
    continue;
  }
  const previous = Array.from(curated.keys()).at(-1);
  if (previous !== undefined && previous.localeCompare(entry.id, 'en') > 0) {
    errors.push({
      path,
      severity: 'error',
      message: `id ${entry.id} is out of order; keep links sorted by id`,
    });
  }
  if (!entry.slides && !entry.recording) {
    errors.push({
      path,
      severity: 'error',
      message: 'must carry slides, recording or both',
    });
  }
  checkUrl(errors, path, 'slides', entry.slides, { allowEmpty: true });
  checkUrl(errors, path, 'recording', entry.recording, {
    allowEmpty: true,
    allowedHostSuffixes: RECORDING_HOSTS,
  });
  curated.set(entry.id, entry);
}
const seenIds = new Set();

let talkCount = 0;
for (const day of Array.isArray(data?.days) ? data.days : []) {
  for (const slot of Array.isArray(day?.slots) ? day.slots : []) {
    for (const talk of Array.isArray(slot?.talks) ? slot.talks : []) {
      talkCount += 1;
      const path = `end-user-talks ${typeof talk?.id === 'string' ? talk.id : 'unknown'}`;
      seenIds.add(talk?.id);
      if (typeof talk?.description !== 'string') {
        errors.push({
          path,
          severity: 'error',
          message:
            'description must be a string (empty when Sessionize has none)',
        });
      }
      // The generated links are the overlay's, or the feed's recording when
      // the overlay has none for this talk; a curated slides link the
      // snapshot lacks means the collector has not been re-run.
      const entry = curated.get(talk?.id);
      if (entry?.slides && talk.slides !== entry.slides) {
        errors.push({
          path,
          severity: 'error',
          message: `slides does not match end-user-talk-links.json; re-run npm run collect:end-user-talks`,
        });
      }
      if (entry?.recording && talk.recording !== entry.recording) {
        errors.push({
          path,
          severity: 'error',
          message: `recording does not match end-user-talk-links.json; re-run npm run collect:end-user-talks`,
        });
      }
      checkUrl(errors, path, 'slides', talk?.slides, { allowEmpty: true });
      checkUrl(errors, path, 'recording', talk?.recording, {
        allowEmpty: true,
        allowedHostSuffixes: RECORDING_HOSTS,
      });
      const before = errors.length;
      checkLink(path, 'url', talk?.url, SCHEDULE_HOST);

      // Only once the link is known to be an https URL on the allowed host is
      // its path meaningful; otherwise this would report a second finding
      // about the same bad value.
      if (errors.length !== before || schedulePath === null) continue;
      if (new URL(talk.url).pathname !== schedulePath) {
        errors.push({
          path,
          severity: 'error',
          message: `url must be a deep link into ${schedulePath}, got ${new URL(talk.url).pathname}`,
        });
      }
    }
  }
}

for (const id of curated.keys()) {
  if (!seenIds.has(id)) {
    errors.push({
      path: LINKS_PATH,
      severity: 'error',
      message: `id ${id} names no talk in end-user-talks.json; remove the stale entry`,
    });
  }
}

reportAndExit(errors, 'end user talks');
console.log(`Validated ${talkCount} end user talk links`);
