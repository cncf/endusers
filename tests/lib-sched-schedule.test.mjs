import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSchedOutage,
  parseSchedCalendar,
  parseSchedDescription,
  parseSchedListing,
  stripSpeakerSuffix,
  toLocalStamp,
} from '../scripts/lib/sched-schedule.mjs';

// Trimmed from the markup Sched serves for the KubeCon India and Europe 2026
// listings; India prints a 12-hour clock, Europe a 24-hour one.
function listingEntry({
  id = '2IW2R',
  uid = 'a1b2c3d4e5f6',
  title = 'Who Watches the Watchers? - Sandeep Kanabar &amp; Aditi Gupta, Gen',
  date = 'Thursday June 18, 2026  2:30pm -  3:00pm',
  room = `<div class="list-single__location">
  <a target="_blank" href="venue/Lotus+2"> Lotus&nbsp;2 (Level 3) </a>
</div>`,
  speakers = ['Sandeep Kanabar', 'Aditi Gupta'],
} = {}) {
  return `<div class="sched-container-inner">
<span class="event"><a href="event/${id}/slug" id="${uid}" class="name">
  <span class="session-title">${title}</span>
</a></span>
<div class="list-single__date">
  ${date}<span class='tz'>IST</span>
</div>
${room}
<div class="tip-description">Preview...<br><a href="/event/${id}">See More &rarr;</a></div>
${speakers
  .map(
    (speaker) =>
      `<h2><a href="speaker/${speaker.toLowerCase().replace(' ', '.')}" title="${speaker}">${speaker}</a></h2><div class="sched-event-details-role-company">Role, Gen</div>`,
  )
  .join('\n')}
</div>`;
}

const LISTING = `<div id="sched-content">${listingEntry()}${listingEntry({
  id: '2PEvQ',
  uid: '0123456789ab',
  title: 'Keynote: Shopify - A Speaker, Shopify',
  date: 'Wednesday March 25, 2026 16:00 - 16:30',
  room: '',
  speakers: ['A Speaker'],
})}<div class="sched-container-inner"><a href="sponsors" id="ffffffffffff" class="name">Sponsors</a></div>`;

function calendar(events) {
  return [
    'BEGIN:VCALENDAR\r\nX-WR-TIMEZONE:UTC',
    ...events.map(
      ({ uid, start, end, description }) =>
        `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:Title\r\n${description === undefined ? '' : `DESCRIPTION:${description}\r\n`}END:VEVENT`,
    ),
    'END:VCALENDAR\r\n',
  ].join('\r\n');
}

function sessionPage({
  description = 'Observability is your safety net.<br><br>At scale, it <b>fails</b> first &amp; loudly.<br>  <br>Join us.<br><br><br>Soon.<br>',
  jsonLd = true,
} = {}) {
  // A null description is left out of the Event data, the way Sched omits an
  // unset one; undefined would fall back to the default above.
  const ld = jsonLd
    ? `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: 'Who Watches the Watchers? - Sandeep Kanabar, Gen',
        description,
      })}</script>`
    : '';
  return `<html><head>${ld}</head><body>
<div class="sched-event-details-description">${description}</div>
</body></html>`;
}

test('parseSchedListing reads every session on the listing by short id', () => {
  const sessions = parseSchedListing(LISTING);
  assert.deepEqual([...sessions.keys()], ['2IW2R', '2PEvQ']);
  assert.deepEqual(sessions.get('2IW2R'), {
    uid: 'a1b2c3d4e5f6',
    title: 'Who Watches the Watchers?',
    speakers: ['Sandeep Kanabar', 'Aditi Gupta'],
    room: 'Lotus 2 (Level 3)',
    startsAt: '2026-06-18T14:30:00',
    endsAt: '2026-06-18T15:00:00',
  });
  assert.deepEqual(sessions.get('2PEvQ'), {
    uid: '0123456789ab',
    title: 'Keynote: Shopify',
    speakers: ['A Speaker'],
    room: '',
    startsAt: '2026-03-25T16:00:00',
    endsAt: '2026-03-25T16:30:00',
  });
});

test('parseSchedListing converts the 12-hour clock around noon and midnight', () => {
  const times = (date) => {
    const [session] = parseSchedListing(listingEntry({ date })).values();
    return [session.startsAt, session.endsAt];
  };
  assert.deepEqual(times('Friday June 19, 2026 12:00am - 12:30pm'), [
    '2026-06-19T00:00:00',
    '2026-06-19T12:30:00',
  ]);
  assert.deepEqual(times('Monday December 7, 2026 11:59am - 1:05pm'), [
    '2026-12-07T11:59:00',
    '2026-12-07T13:05:00',
  ]);
  // A 24-hour clock has no meridiem to adjust for.
  assert.deepEqual(times('Monday December 7, 2026 12:00 - 0:30'), [
    '2026-12-07T12:00:00',
    '2026-12-07T00:30:00',
  ]);
});

test('parseSchedListing knows every month name', () => {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  months.forEach((month, index) => {
    const [session] = parseSchedListing(
      listingEntry({ date: `Monday ${month} 1, 2026 10:00 - 11:00` }),
    ).values();
    assert.equal(
      session.startsAt,
      `2026-${String(index + 1).padStart(2, '0')}-01T10:00:00`,
    );
  });
});

test('parseSchedListing decodes entities in titles, speakers and rooms', () => {
  const [session] = parseSchedListing(
    listingEntry({
      title:
        'Tom &amp; Jerry&#39;s &quot;Clinic&quot; - Jos&#233; D&#39;Souza, Acme',
      speakers: ['Jos&#233; D&#39;Souza '],
      room: `<div class="list-single__location"><a href="venue/x">Hall&nbsp;&lt;A&gt; &amp; B</a></div>`,
    }),
  ).values();
  assert.equal(session.title, 'Tom & Jerry\'s "Clinic"');
  assert.deepEqual(session.speakers, ["José D'Souza"]);
  assert.equal(session.room, 'Hall <A> & B');
});

test('parseSchedListing ignores markup without an event link', () => {
  assert.equal(
    parseSchedListing(
      '<div class="sched-container-inner"><div class="name">nothing</div></div>',
    ).size,
    0,
  );
});

test('parseSchedListing rejects a session whose time it cannot read', () => {
  for (const date of [
    'Thursday Juno 18, 2026 2:30pm - 3:00pm',
    'Thursday June 18, 2026 2:30pm',
    'EU Thursday June 18, 2026 2:30pm - 3:00pm',
    'Thursday June 18, 2026 2:30pm - 3:00pm IST',
    '',
  ]) {
    assert.throws(
      () => parseSchedListing(listingEntry({ date })),
      new RegExp(`no usable session time: ${date}$`),
    );
  }
  assert.throws(
    () =>
      parseSchedListing(
        listingEntry().replace(
          /<div class="list-single__date">[^]*?<\/div>/,
          '',
        ),
      ),
    /no usable session time: $/,
  );
});

test('parseSchedCalendar reads UTC times and unescaped text by uid', () => {
  const events = parseSchedCalendar(
    calendar([
      {
        uid: 'a1b2c3d4e5f6',
        start: '20260618T090000Z',
        end: '20260618T093000Z',
        description:
          'Observability is your safety net.\\n\\nAt scale\\, it fails first\\; loudly.\\n \\n\\n Join us\\\\ soon.\\N',
      },
      {
        uid: '0123456789ab',
        start: '20260325T150000Z',
        end: '20260325T153000Z',
      },
    ]),
  );
  assert.deepEqual(events.get('a1b2c3d4e5f6'), {
    startsAt: '2026-06-18T09:00:00Z',
    endsAt: '2026-06-18T09:30:00Z',
    description:
      'Observability is your safety net.\n\nAt scale, it fails first; loudly.\n\nJoin us\\ soon.',
  });
  assert.deepEqual(events.get('0123456789ab'), {
    startsAt: '2026-03-25T15:00:00Z',
    endsAt: '2026-03-25T15:30:00Z',
    description: '',
  });
});

test('parseSchedCalendar unfolds continuation lines', () => {
  const folded = calendar([
    {
      uid: 'a1b2c3d4e5f6',
      start: '20260618T090000Z',
      end: '20260618T093000Z',
      description: 'A long abstract that Sched wr',
    },
  ]).replace('Sched wr', 'Sched wr\r\n aps\n\t across lines');
  assert.equal(
    parseSchedCalendar(folded).get('a1b2c3d4e5f6').description,
    'A long abstract that Sched wraps across lines',
  );
});

test('parseSchedCalendar rejects an event without a uid or a UTC timestamp', () => {
  assert.throws(
    () =>
      parseSchedCalendar('BEGIN:VEVENT\nDTSTART:20260618T090000Z\nEND:VEVENT'),
    /event without a UID/,
  );
  for (const start of [
    '20260618T090000',
    '2026-06-18T09:00:00Z',
    'x20260618T090000Z',
    '20260618T090000Zx',
    '',
  ]) {
    assert.throws(
      () =>
        parseSchedCalendar(
          calendar([{ uid: 'a', start, end: '20260618T093000Z' }]),
        ),
      new RegExp(`no usable UTC timestamp: ${start}$`),
    );
  }
});

test('toLocalStamp shifts a UTC instant by a positive or negative offset', () => {
  assert.equal(
    toLocalStamp('2026-06-18T09:00:00Z', '+05:30'),
    '2026-06-18T14:30:00',
  );
  assert.equal(
    toLocalStamp('2026-03-25T15:00:00Z', '+01:00'),
    '2026-03-25T16:00:00',
  );
  assert.equal(
    toLocalStamp('2026-06-19T03:00:00Z', '-07:00'),
    '2026-06-18T20:00:00',
  );
  assert.equal(
    toLocalStamp('2026-06-18T23:30:00Z', '+00:00'),
    '2026-06-18T23:30:00',
  );
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

test('parseSchedDescription keeps line breaks and strips other markup', () => {
  assert.equal(
    parseSchedDescription(sessionPage()),
    'Observability is your safety net.\n\nAt scale, it fails first & loudly.\n\nJoin us.\n\nSoon.',
  );
  assert.equal(
    parseSchedDescription(sessionPage({ description: 'a &lt; b &gt; c' })),
    'a < b > c',
  );
  assert.equal(parseSchedDescription(sessionPage({ description: null })), '');
});

// A tag nested inside another must not reassemble into markup once the inner
// tag is stripped; the abstract is plain text by the time the page renders it.
test('parseSchedDescription strips tags that only appear once another tag is removed', () => {
  assert.equal(
    parseSchedDescription(
      sessionPage({
        description:
          'Watch <scr<b>ipt>the</scr<i>ipt> dashboards.<br>Then <em>act</em>.',
      }),
    ),
    'Watch the dashboards.\nThen act.',
  );
});

test('parseSchedDescription rejects a page without Event data', () => {
  assert.throws(
    () => parseSchedDescription(sessionPage({ jsonLd: false })),
    /no schema.org Event data/,
  );
});
