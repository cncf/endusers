import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { checkUrl } from '../scripts/lib/validate-utils.mjs';

// This file is the pull-request lane's data contract for every snapshot in
// data/end-user-talks/. When it was written the dataset was the
// only committed one under data/ with no gate of its own, which is what the
// rest of this header argues from; scripts/validate-end-user-talks.mjs has
// since put the same link allow-list on the Netlify publish path,
// chained into validate:all.
//
// That validator is deliberately not a step in the ci.yml validate job -- the
// omission is recorded in GATES_NOT_RUN_BY_CI in
// tests/workflow-scripts.test.mjs, on the grounds that what follows already
// enforces the contract on this lane. So the two gates do not back each other
// up: this file is the whole of the pull-request lane's cover, and weakening
// it removes the allow-list from every pull request while the publish-path
// validator stays green.
//
// The other two tests that read the dataset are rendering contracts rather
// than data contracts, which is why neither stands in for this one.
// tests/end-user-talk-schedule.test.mjs derives its expectations from the same
// file it is checking, so both sides of every assertion move together, and
// tests/collect-end-user-talks.test.mjs exercises
// scripts/collect-end-user-talks.mjs against a synthetic API fixture and never
// looks at the committed output.
//
// The file says "Do not hand-edit", but it is committed, and the weekly
// refresh-metrics.yml run of `npm run collect:end-user-talks` lands through
// the ordinary pull-request path alongside any hand refresh, so a partial or
// corrupt snapshot can reach main the same way. What
// follows asserts the invariants the collector guarantees by construction, so
// that a snapshot which cannot have come out of the collector fails here
// rather than rendering a wrong /events page.
//
// The URL assertions at the end are the other half of that gate. The
// component renders `sourceUrl`, `apiUrl` and every `talk.url` straight out
// of this file under anchor text that never shows the destination, and the
// sibling feeds (validate-metrics, validate-case-studies,
// validate-radar-reports) all hold such hrefs to an https host allow-list via
// the shared checkUrl(). The rendering test cannot supply that: it derives its
// expectations from the same file, so it stays green on a re-pointed URL.

const dataDir = new URL('../data/', import.meta.url);
const { events } = JSON.parse(
  readFileSync(new URL('end-user-talk-events.json', dataDir), 'utf8'),
);
// Every snapshot is held to the same contract, each against its own event
// entry, so a second conference cannot ship a shape the first never had.
const snapshots = events.map((event) => ({
  event,
  schedule: JSON.parse(
    readFileSync(new URL(`end-user-talks/${event.slug}.json`, dataDir), 'utf8'),
  ),
}));

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
// A slot boundary must carry its UTC offset: without one, `<time dateTime>` is
// a local date-and-time string that a calendar importer or crawler resolves in
// its own zone rather than the event's.
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/u;

// The collector's day label: Intl's en-US long weekday/month rendering of the
// calendar date, formatted in UTC so the machine's timezone cannot shift which
// day is named.
const dayLabelFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * The anchor id the collector derives from a day label.
 *
 * Mirrors `label.toLowerCase().replace(',', '').replaceAll(' ', '-')` in
 * scripts/collect-end-user-talks.mjs. `replace` with a string pattern drops
 * only the first comma, which is the one the label carries.
 *
 * @param {string} label day label, e.g. `Tuesday, November 10`
 * @returns {string} anchor id, e.g. `tuesday-november-10`
 */
function dayId(label) {
  return label.toLowerCase().replace(',', '').replaceAll(' ', '-');
}

/**
 * The collector's 12-hour rendering of an event-local timestamp.
 *
 * Written as arithmetic rather than as the collector's `hour % 12 || 12` and
 * `hour < 12 ? 'AM' : 'PM'` so the expectation has no arm of its own that the
 * committed data might leave unvisited.
 *
 * @param {string} stamp `YYYY-MM-DDTHH:MM:SS`, event-local
 * @returns {string} label, e.g. `11:30 AM`
 */
function timeLabel(stamp) {
  const hour = Number(stamp.slice(11, 13));
  const hour12 = ((hour + 11) % 12) + 1;
  const meridiem = ['AM', 'PM'][Math.floor(hour / 12)];
  return `${hour12}:${stamp.slice(14, 16)} ${meridiem}`;
}

// The hosts scripts/collect-end-user-talks.mjs may build a snapshot from:
// `sourceUrl` and every `talk.url` deep-link into the Linux Foundation or LF
// Open Source China schedule, or the event's Sessionize subdomain; `apiUrl` is
// the Sessionize endpoint the corpus is generated from.
const SCHEDULE_HOSTS = [
  'events.linuxfoundation.org',
  'lfopensource.cn',
  'sessionize.com',
];
const SCHEDULE_HOST = SCHEDULE_HOSTS[0];
const API_HOST = 'sessionize.com';

function urlErrors(field, value, hosts) {
  const errors = [];
  checkUrl(errors, 'end-user-talks', field, value, {
    requireNonEmptyString: true,
    allowedHostSuffixes: hosts,
  });
  return errors.map((error) => error.message);
}

for (const { event, schedule } of snapshots) {
  test.describe(event.slug, () => {
    const days = schedule.days;
    const slots = days.flatMap((day) =>
      day.slots.map((slot) => ({
        day,
        slot,
        where: `${day.date} ${slot.start}`,
      })),
    );
    const talks = slots.flatMap(({ slot, where }) =>
      slot.talks.map((talk) => ({ talk, where: `${where} talk ${talk.id}` })),
    );

    test('the snapshot carries the provenance fields the collector writes', () => {
      for (const field of [
        'description',
        'sourceUrl',
        'apiUrl',
        'selection',
        'location',
        'generatedAt',
        'timezone',
      ]) {
        assert.equal(
          typeof schedule[field],
          'string',
          `${field} must be a string`,
        );
        assert.notEqual(
          schedule[field].trim(),
          '',
          `${field} must not be empty`,
        );
      }
      assert.ok(Array.isArray(days), 'days must be an array');
      assert.ok(days.length > 0, 'days must not be empty');
    });

    // A future stamp means the snapshot was written against a clock that is not
    // this repository's, which is the signature of a hand-edited file.
    test('generatedAt is a real instant that is not in the future', () => {
      const generated = new Date(schedule.generatedAt);
      assert.ok(
        !Number.isNaN(generated.getTime()),
        `generatedAt ${schedule.generatedAt} is not a real instant`,
      );
      assert.ok(
        generated.getTime() <= Date.now(),
        `generatedAt ${schedule.generatedAt} is in the future`,
      );
    });

    // EndUserTalkSchedule renders every talk it is given and reports nothing about
    // the count, so a talkCount that disagrees with the array is invisible on the
    // page while every consumer that trusts the field is wrong.
    test('talkCount matches the talks the days actually contain', () => {
      assert.equal(schedule.talkCount, talks.length);
    });

    test('each day is a calendar date with a non-empty slot list', () => {
      for (const day of days) {
        assert.match(day.date, DATE, `day ${day.id} has a malformed date`);
        assert.ok(Array.isArray(day.slots), `day ${day.id} has no slot array`);
        assert.ok(day.slots.length > 0, `day ${day.id} has no slots`);
      }
    });

    // The component emits `id={day.id}` on each heading and `href={'#' + day.id}`
    // in the jump nav. Both come from this array, so
    // tests/end-user-talk-schedule.test.mjs compares a duplicate against itself and
    // passes while the rendered page carries duplicate DOM ids and jump links that
    // land on the wrong day.
    test('day ids and day dates are unique across the snapshot', () => {
      assert.equal(new Set(days.map((day) => day.id)).size, days.length);
      assert.equal(new Set(days.map((day) => day.date)).size, days.length);
    });

    test('each day id and label is the collector derivation of its date', () => {
      for (const day of days) {
        const label = dayLabelFormat.format(new Date(`${day.date}T00:00:00Z`));
        assert.equal(day.label, label, `day ${day.date} has a stale label`);
        assert.equal(day.id, dayId(label), `day ${day.date} has a stale id`);
      }
    });

    // The collector sorts sessions by start before grouping, so both orders hold by
    // construction; the page renders the arrays as they are, so losing either one
    // silently reorders the schedule.
    test('days ascend by date and each day ascends by slot start', () => {
      const dates = days.map((day) => day.date);
      assert.deepEqual(dates, [...dates].sort());
      for (const day of days) {
        const starts = day.slots.map((slot) => slot.start);
        assert.deepEqual(
          starts,
          [...starts].sort(),
          `day ${day.id} is unsorted`,
        );
      }
    });

    test('each slot is an event-local interval inside the day that holds it', () => {
      for (const { day, slot, where } of slots) {
        assert.match(slot.start, STAMP, `slot ${where} has a malformed start`);
        assert.match(slot.end, STAMP, `slot ${where} has a malformed end`);
        assert.equal(
          slot.start.slice(0, 10),
          day.date,
          `slot ${where} starts outside its day`,
        );
        assert.equal(
          slot.end.slice(0, 10),
          day.date,
          `slot ${where} ends outside its day`,
        );
        assert.ok(
          slot.end > slot.start,
          `slot ${where} ends at or before it starts`,
        );
      }
    });

    test('each slot label matches the timestamp it is drawn from', () => {
      for (const { slot, where } of slots) {
        assert.equal(
          slot.startLabel,
          timeLabel(slot.start),
          `slot ${where} has a stale startLabel`,
        );
        assert.equal(
          slot.endLabel,
          timeLabel(slot.end),
          `slot ${where} has a stale endLabel`,
        );
      }
    });

    // The collector folds sessions sharing a start and end into one slot, so a
    // repeated pair is a snapshot that was not produced by it -- and the page would
    // render the same time heading twice.
    test('a day never repeats a start and end pair', () => {
      for (const day of days) {
        const pairs = day.slots.map((slot) => `${slot.start}/${slot.end}`);
        assert.equal(
          new Set(pairs).size,
          pairs.length,
          `day ${day.id} repeats`,
        );
      }
    });

    test('every slot holds at least one talk', () => {
      for (const { slot, where } of slots) {
        assert.ok(Array.isArray(slot.talks), `slot ${where} has no talk array`);
        assert.ok(slot.talks.length > 0, `slot ${where} holds no talks`);
      }
    });

    // The component renders these three as bare text, and the collector refuses a
    // session missing any of them, so an empty one here is corruption rather than
    // an upstream gap.
    test('each talk carries the text the card renders', () => {
      for (const { talk, where } of talks) {
        for (const field of ['id', 'title', 'speakers', 'room']) {
          assert.equal(
            typeof talk[field],
            'string',
            `${where}: ${field} must be a string`,
          );
          assert.notEqual(
            talk[field].trim(),
            '',
            `${where}: ${field} is empty`,
          );
        }
      }
    });

    // The card splits the abstract on blank lines and renders slides and recording
    // links when present, so a missing description or a non-URL link reaches the
    // page as a broken toggle or a dead anchor.
    test('each talk carries a string abstract and only https links', () => {
      for (const { talk, where } of talks) {
        assert.equal(
          typeof talk.description,
          'string',
          `${where}: description must be a string`,
        );
        assert.equal(
          talk.description.includes('\r'),
          false,
          `${where}: description keeps a CRLF the collector should drop`,
        );
        for (const field of ['slides', 'recording']) {
          if (field in talk) {
            assert.match(
              talk[field],
              /^https:\/\//,
              `${where}: ${field} must be an https URL`,
            );
          }
        }
      }
    });

    // Talk ids are session ids, which are unique upstream. A duplicate means two
    // cards were built from one session, so the page claims a talk that is not on
    // the official schedule.
    test('talk ids are unique across the snapshot', () => {
      const ids = talks.map(({ talk }) => talk.id);
      assert.equal(new Set(ids).size, ids.length, 'a talk id appears twice');
    });

    test('the provenance links resolve to their own documented hosts', () => {
      assert.deepEqual(
        urlErrors('sourceUrl', schedule.sourceUrl, SCHEDULE_HOSTS),
        [],
      );
      assert.deepEqual(urlErrors('apiUrl', schedule.apiUrl, [API_HOST]), []);
      assert.equal(schedule.sourceUrl, event.sourceUrl);
      assert.equal(schedule.apiUrl, event.apiUrl);
    });

    // A talk's title says nothing about where its link goes, so a hostile host, a
    // userinfo component that disguises one, or a path elsewhere on the real host
    // all read as fine in a JSON diff. Hold every link to the event's own deep
    // link for that session and nothing else.
    test('every talk link is the official deep link for its session', () => {
      for (const { talk, where } of talks) {
        assert.deepEqual(
          urlErrors('url', talk.url, SCHEDULE_HOSTS),
          [],
          `${where}: ${JSON.stringify(talk.url)}`,
        );
        assert.equal(
          talk.url,
          event.sessionUrl.replace('{id}', talk.id),
          where,
        );
      }
    });
  });
}

// Pins the gate to evidence: the forms a re-pointed corpus would take must
// each produce an error, or the loops above pass while asserting nothing.
test('the talk link gate rejects the forms a re-pointed corpus would use', () => {
  assert.deepEqual(
    urlErrors(
      'url',
      `https://${SCHEDULE_HOST}/program/schedule/?id=1`,
      SCHEDULE_HOSTS,
    ),
    [],
  );
  for (const bad of [
    undefined,
    'not a url',
    '/program/schedule/?id=1',
    `http://${SCHEDULE_HOST}/program/schedule/`,
    `javascript:alert(1)//${SCHEDULE_HOST}`,
    `https://${SCHEDULE_HOST}@evil.example/program/schedule/?id=1`,
    `https://${SCHEDULE_HOST}.evil.example/program/schedule/`,
    'https://evil.example/program/schedule/?id=1',
  ]) {
    assert.notEqual(
      urlErrors('url', bad, SCHEDULE_HOSTS).length,
      0,
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
});
