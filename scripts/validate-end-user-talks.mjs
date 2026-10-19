#!/usr/bin/env node
import { readFileSync } from 'node:fs';
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

const data = JSON.parse(
  readFileSync(new URL('../data/end-user-talks.json', import.meta.url)),
);
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

let talkCount = 0;
for (const day of Array.isArray(data?.days) ? data.days : []) {
  for (const slot of Array.isArray(day?.slots) ? day.slots : []) {
    for (const talk of Array.isArray(slot?.talks) ? slot.talks : []) {
      talkCount += 1;
      const path = `end-user-talks ${typeof talk?.id === 'string' ? talk.id : 'unknown'}`;
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

reportAndExit(errors, 'end user talks');
console.log(`Validated ${talkCount} end user talk links`);
