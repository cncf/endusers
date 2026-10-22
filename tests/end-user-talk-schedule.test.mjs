import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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
  const dayHeadings = findAllByType(tree, 'h5');

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
