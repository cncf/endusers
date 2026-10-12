import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptInSandbox } from './helpers-script-sandbox.mjs';

const OUTPUT = 'data/kubecon-na-2026-end-user-talks.json';

function sessionizeFixture() {
  return {
    sessions: [
      {
        id: '1001',
        title: 'Platform Engineering at Acme',
        description: 'How Acme runs Kubernetes.',
        startsAt: '2026-11-10T10:30:00',
        endsAt: '2026-11-10T11:00:00',
        roomId: 1,
        speakers: [11],
        categoryItems: [999],
      },
      {
        id: '1002',
        title: 'Ignored Keynote',
        description: 'Keynote session.',
        startsAt: '2026-11-10T09:00:00',
        endsAt: '2026-11-10T09:30:00',
        roomId: 2,
        speakers: [12],
        categoryItems: [888],
      },
    ],
    rooms: [
      { id: 1, name: 'Grand Ballroom A' },
      { id: 2, name: 'Keynote Hall' },
    ],
    speakers: [
      { id: 11, fullName: 'Alice Doe' },
      { id: 12, fullName: 'Bob Keynote' },
    ],
    categories: [
      {
        id: 100,
        title: 'End User Programming',
        items: [{ id: 999, name: 'End User Talk' }],
      },
      {
        id: 200,
        title: 'Session Track',
        items: [{ id: 888, name: 'Keynote' }],
      },
    ],
  };
}

function collect(fixture = sessionizeFixture()) {
  return runScriptInSandbox({
    script: 'collect-end-user-talks.mjs',
    routes: [
      {
        match: 'sessionize.com/api/v2/svi82w6c/view/All',
        body: fixture,
      },
    ],
    outputs: [OUTPUT],
  });
}

test('collect-end-user-talks queries Sessionize and outputs filtered talks catalog', () => {
  const result = collect();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.outputs[OUTPUT], 'expected JSON catalog output');
  const catalog = JSON.parse(result.outputs[OUTPUT]);
  assert.equal(catalog.talkCount, 1);
  assert.equal(catalog.days.length, 1);
  assert.equal(catalog.days[0].date, '2026-11-10');
  assert.equal(catalog.days[0].slots.length, 1);
  assert.equal(catalog.days[0].slots[0].startLabel, '10:30 AM');
  assert.equal(catalog.days[0].slots[0].endLabel, '11:00 AM');
  const talk = catalog.days[0].slots[0].talks[0];
  assert.equal(talk.id, '1001');
  assert.equal(talk.title, 'Platform Engineering at Acme');
  assert.equal(talk.speakers, 'Alice Doe');
  assert.equal(talk.room, 'Grand Ballroom A');
});

test('throws an error if End User Programming category is missing', () => {
  const fixture = sessionizeFixture();
  fixture.categories = [];
  const result = collect(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Official End User Talk category is missing/);
});

test('throws an error if End User Talk category has no sessions', () => {
  const fixture = sessionizeFixture();
  fixture.sessions = [];
  const result = collect(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Official End User Talk category is empty/);
});

test('throws an error if session has incomplete data', () => {
  const fixture = sessionizeFixture();
  delete fixture.sessions[0].title;
  const result = collect(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /has incomplete schedule data/);
});

test('throws an error if Sessionize API returns non-200', () => {
  const result = runScriptInSandbox({
    script: 'collect-end-user-talks.mjs',
    routes: [
      {
        match: 'sessionize.com/api/v2/svi82w6c/view/All',
        status: 500,
        body: 'Internal Server Error',
      },
    ],
    outputs: [OUTPUT],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Sessionize API returned 500/);
});

test('groups multiple sessions in the same slot correctly and handles afternoon/noon time labels', () => {
  const fixture = sessionizeFixture();
  fixture.sessions.push(
    {
      id: '1003',
      title: 'Second Talk in Same Slot',
      startsAt: '2026-11-10T10:30:00',
      endsAt: '2026-11-10T11:00:00',
      roomId: 1,
      speakers: [11],
      categoryItems: [999],
    },
    {
      id: '1004',
      title: 'Noon Panel',
      startsAt: '2026-11-10T12:00:00',
      endsAt: '2026-11-10T12:45:00',
      roomId: 1,
      speakers: [11],
      categoryItems: [999],
    },
    {
      id: '1005',
      title: 'Afternoon Talk Same Start Different End',
      startsAt: '2026-11-10T12:00:00',
      endsAt: '2026-11-10T13:00:00',
      roomId: 2,
      speakers: [11],
      categoryItems: [999],
    },
  );
  const result = collect(fixture);
  assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(result.outputs[OUTPUT]);
  assert.equal(catalog.talkCount, 4);
  assert.equal(catalog.days[0].slots[0].talks.length, 2);
  assert.equal(catalog.days[0].slots[1].startLabel, '12:00 PM');
  assert.equal(catalog.days[0].slots[2].endLabel, '1:00 PM');
});
