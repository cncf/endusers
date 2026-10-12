// URL gate for data/kubecon-na-2026-end-user-talks.json.
//
// src/components/EndUserTalkSchedule renders four href values straight out of
// this corpus: `sourceUrl` under the fixed anchor text "live official
// schedule", `apiUrl` under "official Sessionize API", one `talk.url` per
// session under the talk title, and `#${day.id}` for the day jump links. The
// destination of the first two is never visible to a reader, and a talk's
// title says nothing about where its link goes.
//
// Every sibling feed rendered the same way is gated: scripts/validate-
// metrics.mjs, validate-case-studies.mjs and validate-radar-reports.mjs each
// parse their URLs and hold the host to an allow-list, rejecting a userinfo
// component ("https://events.linuxfoundation.org@evil.example/") that resolves
// to a hostile host while reading as the official one in a JSON diff. This
// corpus is the one rendered feed with no such gate, and the existing
// tests/end-user-talk-schedule.test.mjs cannot supply it: it asserts the
// component reproduces whatever the corpus says, so it passes unchanged on a
// re-pointed URL — its anchor filter matches the `/program/schedule/?id=`
// substring, which a hostile host keeps.
//
// The gate lives here rather than in a `validate:end-user-talks` script
// because package.json gates must be run by a step in .github/workflows/, and
// the unit suite is already run by both ci.yml (test:unit:coverage:check) and
// deploy-gh-pages.yml (test:unit), so these assertions block a pull request
// and a publish without a workflow change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The two hosts scripts/collect-end-user-talks.mjs builds its output from:
// `sourceUrl` is the Linux Foundation event schedule the talk links deep-link
// into, `apiUrl` is the Sessionize endpoint the corpus is generated from.
const SCHEDULE_HOST = 'events.linuxfoundation.org';
const API_HOST = 'sessionize.com';

const schedule = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../data/kubecon-na-2026-end-user-talks.json', import.meta.url),
    ),
    'utf8',
  ),
);

const talks = schedule.days.flatMap((day) =>
  day.slots.flatMap((slot) => slot.talks),
);

function publishableUrl(value, host) {
  if (typeof value !== 'string') return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.hostname.toLowerCase() !== host) return null;
  return url;
}

test('publishableUrl rejects the forms a re-pointed corpus would use', () => {
  const good = `https://${SCHEDULE_HOST}/program/schedule/?id=1`;
  assert.ok(publishableUrl(good, SCHEDULE_HOST));
  for (const bad of [
    undefined,
    42,
    'not a url',
    '/program/schedule/?id=1',
    `http://${SCHEDULE_HOST}/program/schedule/`,
    `javascript:alert(1)//${SCHEDULE_HOST}`,
    `https://${SCHEDULE_HOST}@evil.example/program/schedule/?id=1`,
    `https://user:pass@${SCHEDULE_HOST}.evil.example/`,
    `https://${SCHEDULE_HOST}.evil.example/program/schedule/`,
    `https://evil.example/program/schedule/?id=1`,
  ]) {
    assert.equal(
      publishableUrl(bad, SCHEDULE_HOST),
      null,
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test('the corpus provenance links resolve to their own documented hosts', () => {
  assert.ok(
    publishableUrl(schedule.sourceUrl, SCHEDULE_HOST),
    `sourceUrl must be an https URL, with no userinfo, on ${SCHEDULE_HOST}: ${JSON.stringify(schedule.sourceUrl)}`,
  );
  assert.ok(
    publishableUrl(schedule.apiUrl, API_HOST),
    `apiUrl must be an https URL, with no userinfo, on ${API_HOST}: ${JSON.stringify(schedule.apiUrl)}`,
  );
  // Rendered through `new Date(...).toLocaleDateString()`, which publishes the
  // literal string "Invalid Date" rather than failing the build.
  assert.ok(
    !Number.isNaN(Date.parse(schedule.generatedAt)),
    `generatedAt must be a parseable date: ${JSON.stringify(schedule.generatedAt)}`,
  );
});

test('every talk link is a deep link into the official schedule page', () => {
  assert.ok(talks.length > 0, 'expected a non-empty talk corpus');
  assert.equal(talks.length, schedule.talkCount);
  const schedulePath = publishableUrl(
    schedule.sourceUrl,
    SCHEDULE_HOST,
  ).pathname;
  for (const talk of talks) {
    const url = publishableUrl(talk.url, SCHEDULE_HOST);
    assert.ok(
      url,
      `talk ${talk.id} url must be an https URL, with no userinfo, on ${SCHEDULE_HOST}: ${JSON.stringify(talk.url)}`,
    );
    assert.equal(
      url.pathname,
      schedulePath,
      `talk ${talk.id} url must stay on the schedule page ${schedulePath}`,
    );
  }
});

// `day.id` is written into both an element id and the `href="#..."` of its
// jump link, so it has to be a plain slug rather than anything that could
// carry a scheme or a path.
test('every day id is a plain slug safe to use as a fragment', () => {
  assert.ok(schedule.days.length > 0, 'expected a non-empty day list');
  const ids = new Set();
  for (const day of schedule.days) {
    assert.match(
      day.id,
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      `day id must be a lowercase slug: ${JSON.stringify(day.id)}`,
    );
    assert.ok(!ids.has(day.id), `duplicate day id ${day.id}`);
    ids.add(day.id);
  }
});
