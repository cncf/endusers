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
    fileURLToPath(
      new URL('../data/kubecon-na-2026-end-user-talks.json', import.meta.url),
    ),
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
