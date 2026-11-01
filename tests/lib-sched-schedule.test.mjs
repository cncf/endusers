import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSchedOutage,
  parseSchedListing,
  parseSchedSession,
  stripSpeakerSuffix,
} from '../scripts/lib/sched-schedule.mjs';

// Trimmed from the markup Sched serves for the KubeCon India 2026 schedule.
const LISTING = `
<div class="sched-container-inner">
<a href="event/2IW2R/who-watches-the-watchers" id="a1b2c3d4e5f6" class="name"><span class="session-title">Who Watches the Watchers? - Sandeep Kanabar, Gen</span></a>
<a href="speaker/sandeep" title="Sandeep Kanabar">Sandeep Kanabar</a>
<a href="event/2PEvQ/keynote-shopify" id="0123456789ab" class="name"><span class="session-title">Keynote: Shopify - A Speaker, Shopify</span></a>
<a href="event/2IW2R/who-watches-the-watchers">See More →</a>
<a href="sponsors" id="ffffffffffff" class="name">Sponsors</a>
</div>`;

function sessionPage({
  name = 'Who Watches the Watchers? From Closed Observability To Open Control at Scale - Sandeep Kanabar &amp; Aditi Gupta, Gen; Madhu Patel, Gen',
  startDate = '2026-06-18T14:30:00+0530',
  endDate = '2026-06-18T15:00:00+0530',
  description = 'Observability is your safety net.<br><br>At scale, it <b>fails</b> first &amp; loudly.<br>  <br>Join us.<br><br><br>Soon.<br>',
  speakers = ['Sandeep Kanabar', 'Aditi Gupta', 'Madhu Patel'],
  venue = `<div class="sched-event-details-timeandplace">Thursday June 18, 2026 2:30pm - 3:00pm IST<br>
 <a href='venue/Lotus+2+%28Level+3%29'>Lotus 2 (Level 3)</a></div>`,
  jsonLd = true,
} = {}) {
  // A null field is left out of the Event data, the way Sched omits an
  // unset one; undefined would fall back to the default above.
  const ld = jsonLd
    ? `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Event',
        name,
        startDate,
        endDate,
        description,
      })}</script>`
    : '';
  return `<html><head>${ld}</head><body>
<div class="sched-event-details">
<div class="event a2 sched-event-type-breakout">${name}</div>
${venue}
<div class="sched-event-details-description">${description}</div>
</div>
<div class="sched-person">
${speakers
  .map(
    (speaker) =>
      `<h2><a href="speaker/${speaker.toLowerCase().replace(' ', '_')}" title="${speaker}">${speaker}</a></h2>`,
  )
  .join('\n')}
</div></body></html>`;
}

test('parseSchedListing collects the id of every session link once', () => {
  const ids = parseSchedListing(LISTING);
  assert.deepEqual([...ids].sort(), ['2IW2R', '2PEvQ']);
});

test('parseSchedListing ignores markup without an event link', () => {
  assert.equal(parseSchedListing('<div class="name">nothing</div>').size, 0);
});

test('isSchedOutage recognises the maintenance interstitial only', () => {
  assert.equal(
    isSchedOutage(
      '<html><head><title>We’ll be back in a minute – Sched</title></head></html>',
    ),
    true,
  );
  assert.equal(isSchedOutage(sessionPage()), false);
  assert.equal(isSchedOutage(''), false);
});

test('stripSpeakerSuffix cuts at the last separator naming a speaker', () => {
  assert.equal(
    stripSpeakerSuffix(
      'Rab Ne Bana Di Jodi - Why Platforms & AI Need Each Other - Ravi Sharma, Flipkart',
      ['Ravi Sharma'],
    ),
    'Rab Ne Bana Di Jodi - Why Platforms & AI Need Each Other',
  );
});

test('stripSpeakerSuffix handles several speakers in any order', () => {
  assert.equal(
    stripSpeakerSuffix(
      'Clinic - Neel Shah, Middleware & Suman Chakraborty, P9',
      ['Suman Chakraborty', 'Neel Shah'],
    ),
    'Clinic',
  );
});

test('stripSpeakerSuffix matches the surname of a recased or abbreviated name', () => {
  assert.equal(
    stripSpeakerSuffix('Edge Storage - parth ARORA, Acme', ['Parth arora']),
    'Edge Storage',
  );
  assert.equal(
    stripSpeakerSuffix('Edge Storage  - S. K. Kanabar, Acme', [
      'Sandeep Kumar Kanabar',
    ]),
    'Edge Storage',
  );
});

test('stripSpeakerSuffix leaves a title that names no speaker after a separator alone', () => {
  assert.equal(
    stripSpeakerSuffix('  Trivia Challenge! Hosted by Someone Else ', [
      'Fazlur Khan',
    ]),
    'Trivia Challenge! Hosted by Someone Else',
  );
  assert.equal(
    stripSpeakerSuffix('Fireside Chat With Jane Doe', ['Jane Doe']),
    'Fireside Chat With Jane Doe',
  );
  assert.equal(
    stripSpeakerSuffix('A Chat With Doe - Live Edition', ['Jane Doe']),
    'A Chat With Doe - Live Edition',
  );
  assert.equal(stripSpeakerSuffix('Talk - Nobody', []), 'Talk - Nobody');
});

test('parseSchedSession reads the schedule fields out of a session page', () => {
  const session = parseSchedSession(sessionPage());
  assert.deepEqual(session, {
    title:
      'Who Watches the Watchers? From Closed Observability To Open Control at Scale',
    startsAt: '2026-06-18T14:30:00',
    endsAt: '2026-06-18T15:00:00',
    utcOffset: '+05:30',
    room: 'Lotus 2 (Level 3)',
    speakers: ['Sandeep Kanabar', 'Aditi Gupta', 'Madhu Patel'],
    description:
      'Observability is your safety net.\n\nAt scale, it fails first & loudly.\n\nJoin us.\n\nSoon.',
  });
});

// A tag nested inside another must not reassemble into markup once the inner
// tag is stripped; the abstract is plain text by the time the page renders it.
test('parseSchedSession strips tags that only appear once another tag is removed', () => {
  const session = parseSchedSession(
    sessionPage({
      description:
        'Watch <scr<b>ipt>the</scr<i>ipt> dashboards.<br>Then <em>act</em>.',
    }),
  );
  assert.equal(session.description, 'Watch the dashboards.\nThen act.');
});

test('parseSchedSession decodes entities in names, rooms and text', () => {
  const session = parseSchedSession(
    sessionPage({
      name: 'Tom &amp; Jerry&#39;s &quot;Clinic&quot; - Jos&#233; D&#39;Souza, Acme',
      speakers: ['Jos&#233; D&#39;Souza '],
      venue: `<div class="sched-event-details-timeandplace"><a href='venue/x'> Hall&nbsp;&lt;A&gt; &amp; B </a></div>`,
      description: 'a &lt; b &gt; c',
    }),
  );
  assert.equal(session.title, 'Tom & Jerry\'s "Clinic"');
  assert.deepEqual(session.speakers, ["José D'Souza"]);
  assert.equal(session.room, 'Hall <A> & B');
  assert.equal(session.description, 'a < b > c');
});

test('parseSchedSession accepts an offset with a colon and an empty page body', () => {
  const session = parseSchedSession(
    sessionPage({
      startDate: '2026-06-18T09:00:00-07:00',
      endDate: '2026-06-18T09:30:00-07:00',
      description: null,
      venue: '',
      name: null,
      speakers: [],
    }),
  );
  assert.equal(session.utcOffset, '-07:00');
  assert.equal(session.title, '');
  assert.equal(session.room, '');
  assert.deepEqual(session.speakers, []);
  assert.equal(session.description, '');
});

test('parseSchedSession rejects a page without Event data', () => {
  assert.throws(
    () => parseSchedSession(sessionPage({ jsonLd: false })),
    /no schema.org Event data/,
  );
});

test('parseSchedSession rejects a malformed or missing timestamp', () => {
  assert.throws(
    () => parseSchedSession(sessionPage({ startDate: '2026-06-18 14:30' })),
    /no usable timestamp: 2026-06-18 14:30/,
  );
  assert.throws(
    () => parseSchedSession(sessionPage({ endDate: null })),
    /no usable timestamp: null/,
  );
  for (const stamp of [
    'x2026-06-18T14:30:00+0530',
    '2026-06-18T14:30:00+0530Z',
  ]) {
    assert.throws(
      () => parseSchedSession(sessionPage({ startDate: stamp })),
      /no usable timestamp/,
    );
  }
});

test('parseSchedSession rejects a session that changes offset', () => {
  assert.throws(
    () =>
      parseSchedSession(sessionPage({ endDate: '2026-06-18T15:00:00+0000' })),
    /different UTC offsets: 2026-06-18T14:30:00\+0530 2026-06-18T15:00:00\+0000/,
  );
});
