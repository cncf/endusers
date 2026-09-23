// PeopleFreshness renders the "last refreshed" line under the TAB/staff
// profile grids on docs/community/*. Nothing imported the module before this
// file, so its two behaviours — formatting data/community-people.json's
// fetchedAt, and rendering nothing at all when that timestamp is unusable —
// had no unit coverage and a regression in either would ship silently.
//
// The component takes no props and reads its data at module scope, so the
// live-data assertions below are invariants that hold for any shape of
// data/community-people.json; the branches the live file does not reach are
// driven through a fixture copy of the module.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importWithData } from './helpers-component-data.mjs';
import { importSource } from './helpers-jsx.mjs';
import { textOf } from './tools/react-element-tree.mjs';

const DATA_SPECIFIER = '@site/data/community-people.json';

const { default: PeopleFreshness } = await importSource(
  'src/components/PeopleFreshness/index.js',
);
const { default: peopleData } = await importSource(
  'data/community-people.json',
);

async function renderWith(fetchedAt) {
  const module = await importWithData(
    'src/components/PeopleFreshness/index.js',
    { [DATA_SPECIFIER]: { fetchedAt } },
  );
  try {
    return module.default();
  } finally {
    module.cleanup();
  }
}

test('the live data file renders a single freshness paragraph', () => {
  const tree = PeopleFreshness();
  assert.notEqual(
    tree,
    null,
    'data/community-people.json has an unusable fetchedAt',
  );
  assert.equal(tree.type, 'p');
});

test('the rendered date is the fetchedAt of the live data file', () => {
  const expected = new Date(peopleData.fetchedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  assert.match(textOf(PeopleFreshness()), /last refreshed from public GitHub/);
  assert.ok(
    textOf(PeopleFreshness()).includes(expected),
    `expected the rendered text to include ${expected}`,
  );
});

test('a known timestamp is rendered as a long-form US date', async () => {
  const tree = await renderWith('2026-03-04T05:06:07.000Z');
  assert.match(textOf(tree), /March 4, 2026/);
});

test('an unparseable fetchedAt renders nothing rather than "Invalid Date"', async () => {
  assert.equal(await renderWith('not a timestamp'), null);
});

test('a missing fetchedAt renders nothing', async () => {
  assert.equal(await renderWith(undefined), null);
});
