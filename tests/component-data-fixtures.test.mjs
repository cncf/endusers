// The fixture machinery behind tests/helpers-component-data.mjs.
//
// Three test files drive component branches that the checked-in data cannot
// reach by swapping the module-scope `@site/data/**.json` import for a
// fixture. That swap is now a mutable binding shared by every importer in the
// process rather than a rewritten copy of the component (#571), which buys
// correct coverage attribution at the cost of shared state: if `cleanup()`
// stopped restoring the checked-in data, every later live-data assertion in
// the same file would be asserting against a fixture, and the tests that
// remain green would be green for the wrong reason.
//
// Nothing else exercises the harness itself, so its guards are pinned here.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importWithData } from './helpers-component-data.mjs';
import { importSource } from './helpers-jsx.mjs';
import {
  applyFixtures,
  restoreFixtures,
} from './tools/component-data-store.mjs';
import { textOf } from './tools/react-element-tree.mjs';

const SOURCE = 'src/components/PeopleFreshness/index.js';
const SPECIFIER = '@site/data/community-people.json';

test('a fixture keyed by a specifier the component does not import is rejected', async () => {
  await assert.rejects(
    () => importWithData(SOURCE, { '@site/data/not-imported.json': {} }),
    /does not import @site\/data\/not-imported\.json/,
  );
});

test('a fixture for a specifier no module under test imported is rejected', () => {
  assert.throws(
    () => applyFixtures({ '@site/data/never-loaded.json': {} }),
    /has not been imported by any module under test/,
  );
});

test('a second fixture for a live specifier is rejected rather than silently winning', async () => {
  const { cleanup } = await importWithData(SOURCE, {
    [SPECIFIER]: { fetchedAt: '2024-03-01T00:00:00.000Z' },
  });
  try {
    await assert.rejects(
      () => importWithData(SOURCE, { [SPECIFIER]: { fetchedAt: null } }),
      /already active; call cleanup\(\) before/,
    );
  } finally {
    cleanup();
  }
});

test('restoring a specifier that was never registered is a no-op', () => {
  assert.doesNotThrow(() => restoreFixtures(['@site/data/never-loaded.json']));
});

test('cleanup restores the checked-in data for a component imported directly', async () => {
  const { default: PeopleFreshness } = await importSource(SOURCE);
  const live = textOf(PeopleFreshness());

  const { cleanup } = await importWithData(SOURCE, {
    [SPECIFIER]: { fetchedAt: '2024-03-01T00:00:00.000Z' },
  });
  try {
    // The same module instance the direct import returned now sees the
    // fixture; that sharing is what makes restoring it afterwards load-bearing.
    assert.match(textOf(PeopleFreshness()), /March 1, 2024/);
  } finally {
    cleanup();
  }

  assert.equal(textOf(PeopleFreshness()), live);
  assert.doesNotMatch(textOf(PeopleFreshness()), /March 1, 2024/);
});
