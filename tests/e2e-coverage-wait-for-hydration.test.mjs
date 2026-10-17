import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { waitForHydration } from './tools/e2e-coverage.cjs';

const e2eDir = fileURLToPath(new URL('./e2e', import.meta.url));

// A locator stand-in that records the calls the helper makes and runs the
// in-page predicate against a plain object, the way Playwright would run it
// against the DOM node.
function fakeLocator(element) {
  const calls = [];
  return {
    calls,
    async waitFor(options) {
      calls.push(['waitFor', options]);
    },
    async evaluate(fn) {
      calls.push(['evaluate']);
      return fn(element);
    },
  };
}

test('waits for visibility before inspecting the element', async () => {
  const locator = fakeLocator({ __reactFiber$abc: {} });
  await waitForHydration(locator);
  assert.deepEqual(locator.calls, [
    ['waitFor', { state: 'visible' }],
    ['evaluate'],
  ]);
});

test('resolves immediately once a __react* property is present', async () => {
  const locator = fakeLocator({ __reactProps$abc: {}, id: 'trigger' });
  await waitForHydration(locator);
  assert.equal(locator.calls.length, 2);
});

test('polls until React attaches its fiber', async () => {
  const element = { id: 'trigger' };
  const locator = fakeLocator(element);
  const pending = waitForHydration(locator);
  let settled = false;
  pending.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(settled, false, 'resolved before any __react* key existed');
  element.__reactFiber$abc = {};
  await pending;
  assert.equal(settled, true);
});

test('no e2e spec keeps a local copy of waitForHydration', () => {
  const offenders = readdirSync(e2eDir)
    .filter((name) => name.endsWith('.spec.js'))
    .filter((name) =>
      /function waitForHydration\b/.test(
        readFileSync(join(e2eDir, name), 'utf8'),
      ),
    );
  assert.deepEqual(
    offenders,
    [],
    'import waitForHydration from tests/tools/e2e-coverage.cjs instead of redefining it',
  );
});
