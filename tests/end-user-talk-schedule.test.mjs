import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { importWithData } from './helpers-component-data.mjs';
import { importSource } from './helpers-jsx.mjs';
import {
  findAllByType,
  findByType,
  textOf,
} from './tools/react-element-tree.mjs';

const { default: EndUserTalkSchedule } = await importSource(
  'src/components/EndUserTalkSchedule/index.js',
);

const schedule = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../data/end-user-talks.json', import.meta.url)),
    'utf8',
  ),
);

test('renders exactly every talk in corpus order without dropping any session', () => {
  const tree = EndUserTalkSchedule();
  const anchors = findAllByType(tree, 'a').filter((node) =>
    node.props?.href?.includes('/program/schedule/?id='),
  );
  const expectedTalks = schedule.days.flatMap((day) =>
    day.slots.flatMap((slot) => slot.talks),
  );

  assert.equal(anchors.length, schedule.talkCount);
  assert.equal(anchors.length, expectedTalks.length);
  assert.deepEqual(
    anchors.map((node) => node.props.href),
    expectedTalks.map((talk) => talk.url),
  );
});

test('renders day jump links that match every day section id', () => {
  const tree = EndUserTalkSchedule();
  const nav = findByType(tree, 'nav');
  assert.ok(nav, 'expected day navigation');
  const navLinks = findAllByType(nav, 'a');
  const dayHeadings = findAllByType(tree, 'h3');

  assert.deepEqual(
    navLinks.map((node) => node.props.href),
    schedule.days.map((day) => `#${day.id}`),
  );
  assert.deepEqual(
    dayHeadings.map((node) => node.props.id),
    schedule.days.map((day) => day.id),
  );
});

test('each card includes title, speakers, room, and official schedule link', () => {
  const tree = EndUserTalkSchedule();
  const cards = findAllByType(tree, 'li');
  const expectedTalks = schedule.days.flatMap((day) =>
    day.slots.flatMap((slot) => slot.talks),
  );

  assert.equal(cards.length, expectedTalks.length);
  for (let i = 0; i < cards.length; i += 1) {
    const talk = expectedTalks[i];
    const cardText = textOf(cards[i]);
    assert.ok(
      cardText.includes(talk.title),
      `expected card to contain title "${talk.title}"`,
    );
    assert.ok(
      cardText.includes(talk.speakers),
      `expected card to contain speakers "${talk.speakers}"`,
    );
    assert.ok(
      cardText.includes(talk.room),
      `expected card to contain room "${talk.room}"`,
    );
    const anchor = findByType(cards[i], 'a');
    assert.equal(anchor.props.href, talk.url);
  }
});

// The badge beside each slot must come from the data file's timezone field,
// the same source the intro sentence uses, so regenerating the snapshot for
// an event in another timezone cannot leave a stale hardcoded label.
test('every slot badge renders the timezone from the data file', () => {
  const tree = EndUserTalkSchedule();
  const slotCount = schedule.days.reduce(
    (count, day) => count + day.slots.length,
    0,
  );
  const badges = findAllByType(tree, 'span').filter(
    (node) =>
      typeof node.props?.className === 'string' &&
      node.props.className.includes('timezone'),
  );

  assert.equal(badges.length, slotCount);
  for (const badge of badges) {
    assert.equal(textOf(badge), schedule.timezone);
  }
});

test('the intro sentence spaces the count, track and timezone correctly', () => {
  const tree = EndUserTalkSchedule();
  const [intro] = findAllByType(tree, 'p');
  assert.equal(
    textOf(intro),
    `${schedule.talkCount} sessions in End User Programming → End User Talk. All times are ${schedule.timezone}, local to Salt Lake City. Some sessions overlap; talks in the same time slot run concurrently.`,
  );
});

test('the source line links the API and the live schedule in one sentence', () => {
  const tree = EndUserTalkSchedule();
  const source = findAllByType(tree, 'p').find(
    (node) => node.props.className === 'source',
  );
  const verified = new Date(schedule.generatedAt).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  assert.equal(
    textOf(source),
    `Source: official Sessionize API · Verified ${verified}. Times, rooms, and speakers may change; check the live official schedule for updates.`,
  );
  assert.deepEqual(
    findAllByType(source, 'a').map((node) => node.props.href),
    [schedule.apiUrl, schedule.sourceUrl],
  );
});

test('each slot is keyed by its time range and its list names the day and slot', () => {
  const tree = EndUserTalkSchedule();
  const expectedSlots = schedule.days.flatMap((day) =>
    day.slots.map((slot) => ({ day, slot })),
  );
  const slots = findAllByType(tree, 'div').filter(
    (node) => node.props.className === 'slot',
  );
  assert.equal(slots.length, expectedSlots.length);
  slots.forEach((node, index) => {
    const { day, slot } = expectedSlots[index];
    assert.equal(node.key, `${slot.start}/${slot.end}`);
    const list = findByType(node, 'ul');
    assert.equal(
      list.props['aria-label'],
      `${day.label}, ${slot.startLabel}–${slot.endLabel}`,
    );
    const [start, end] = findAllByType(node, 'time');
    assert.equal(start.props.dateTime, slot.start);
    assert.equal(end.props.dateTime, slot.end);
  });
});

// Every talk's abstract and links are rendered by the hook-free TalkDetails
// element inside each card, so these walk with `expand` to see its markup.
const expandAll = { expand: () => true };

function cardFor(tree, talk) {
  return findAllByType(tree, 'li', expandAll).find(
    (node) => node.key === talk.id,
  );
}

test('each talk with an abstract gets a collapsed Abstract toggle split into paragraphs', () => {
  const tree = EndUserTalkSchedule();
  const talks = schedule.days.flatMap((day) =>
    day.slots.flatMap((slot) => slot.talks),
  );
  const withAbstract = talks.filter((talk) => talk.description);
  assert.ok(withAbstract.length > 0, 'the corpus carries abstracts');
  for (const talk of withAbstract) {
    const card = cardFor(tree, talk);
    const details = findByType(card, 'details', expandAll);
    assert.ok(details, `talk ${talk.id} has no abstract toggle`);
    assert.equal(details.props.open, undefined, 'the abstract starts closed');
    assert.equal(textOf(findByType(details, 'summary')), 'Abstract');
    const rendered = findAllByType(details, 'p').map(textOf);
    const expected = talk.description
      .split(/\n\s*\n/)
      .filter((part) => part.trim() !== '');
    assert.deepEqual(rendered, expected);
    assert.equal(textOf(details).includes('\n\n'), false);
  }
});

test('the links row appears only on talks that carry slides or a recording', () => {
  const tree = EndUserTalkSchedule();
  const talks = schedule.days.flatMap((day) =>
    day.slots.flatMap((slot) => slot.talks),
  );
  const rows = findAllByType(tree, 'p', expandAll).filter(
    (node) => node.props.className === 'links',
  );
  assert.equal(
    rows.length,
    talks.filter((talk) => talk.slides || talk.recording).length,
  );
});

test('TalkDetails renders slides and recording links only when present, naming the talk for screen readers', async () => {
  // Swap the data import for a fixture rather than mutate the shared corpus.
  const { default: Patched, cleanup } = await importWithData(
    'src/components/EndUserTalkSchedule/index.js',
    {
      '@site/data/end-user-talks.json': {
        ...schedule,
        days: [
          {
            date: '2031-01-01',
            id: 'fixture-day',
            label: 'Fixture day',
            slots: [
              {
                start: '2031-01-01T09:00:00-07:00',
                end: '2031-01-01T09:30:00-07:00',
                startLabel: '9:00 AM',
                endLabel: '9:30 AM',
                talks: [
                  {
                    id: 'both',
                    title: 'Both links',
                    speakers: 'A',
                    room: 'R',
                    url: `${schedule.sourceUrl}?id=both`,
                    description: '',
                    slides: 'https://example.com/both.pdf',
                    recording: 'https://youtu.be/both',
                  },
                  {
                    id: 'recording-only',
                    title: 'Recording only',
                    speakers: 'B',
                    room: 'R',
                    url: `${schedule.sourceUrl}?id=recording-only`,
                    description:
                      'First paragraph.\n \nSecond paragraph.\n\n\nThird.\n\n',
                    recording: 'https://youtu.be/only',
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  );
  let tree;
  try {
    tree = Patched();
  } finally {
    cleanup();
  }
  const [both, recordingOnly] = findAllByType(tree, 'li', expandAll);

  assert.equal(findByType(both, 'details', expandAll), undefined);
  const bothLinks = findAllByType(both, 'a', expandAll).slice(1);
  // The visible text stays short; the accessible name adds the talk so a
  // screen reader's link list does not read the same label eighty times.
  assert.deepEqual(
    bothLinks.map((node) => [
      node.props.href,
      textOf(node),
      node.props['aria-label'],
    ]),
    [
      ['https://example.com/both.pdf', 'Slides', 'Slides: Both links'],
      [
        'https://youtu.be/both',
        'Recording (YouTube)',
        'Recording (YouTube): Both links',
      ],
    ],
  );
  for (const link of bothLinks) {
    assert.equal(link.props.rel, 'noreferrer');
  }

  // A blank line carrying a space and a run of blank lines are each one
  // paragraph break; a trailing break yields no empty paragraph.
  assert.deepEqual(
    findAllByType(findByType(recordingOnly, 'details', expandAll), 'p').map(
      textOf,
    ),
    ['First paragraph.', 'Second paragraph.', 'Third.'],
  );
  assert.deepEqual(
    findAllByType(recordingOnly, 'a', expandAll)
      .slice(1)
      .map((node) => node.props.href),
    ['https://youtu.be/only'],
  );
});
