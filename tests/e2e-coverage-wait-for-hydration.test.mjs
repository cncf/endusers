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

// The two helpers below are pure functions of their input so the fixtures at
// the bottom can show each arm of the guard going red. A guard nobody has seen
// fail is indistinguishable from one that cannot, which is the same reason
// tests/e2e-docs-threshold-parity.test.mjs parses text rather than the files
// it ultimately reads.

// `recursive: true` because tests/e2e is not flat -- fixtures/ and its
// data-*/ and docs/ children already live under it -- so a top-level listing
// would read past a spec added one directory down and report the tree clean.
function specNames(entries) {
  return entries
    .map((entry) => String(entry))
    .filter((name) => name.endsWith('.spec.js'))
    .sort();
}

// A spec takes the helper as a named import
// (`import { test, expect, waitForHydration } from '../tools/e2e-coverage.cjs'`),
// which binds it through a destructuring pattern. Every shape below instead
// *defines* the name locally, which is the copy this guard exists to catch:
// the `function` declaration the original pattern matched, plus the arrow and
// function-expression bindings it did not.
function definesWaitForHydration(source) {
  return /(?:\bfunction\s+waitForHydration\b)|(?:\b(?:const|let|var)\s+waitForHydration\s*=)/.test(
    source,
  );
}

test('no e2e spec keeps a local copy of waitForHydration', () => {
  const specs = specNames(readdirSync(e2eDir, { recursive: true }));
  // A mis-resolved path yields an empty listing, and an empty listing has no
  // offenders: without this the guard would report a directory it never read
  // as a clean one.
  assert.ok(
    specs.length > 0,
    `no .spec.js found under ${e2eDir}; the guard read nothing rather than finding nothing`,
  );
  const offenders = specs.filter((name) =>
    definesWaitForHydration(readFileSync(join(e2eDir, name), 'utf8')),
  );
  assert.deepEqual(
    offenders,
    [],
    'import waitForHydration from tests/tools/e2e-coverage.cjs instead of redefining it',
  );
});

test('the listing keeps a spec nested below tests/e2e', () => {
  assert.deepEqual(
    specNames(['interactions.spec.js', 'nested/copy.spec.js', 'helpers.js']),
    ['interactions.spec.js', 'nested/copy.spec.js'],
  );
});

test('the detector catches every local definition of the helper', () => {
  for (const source of [
    'function waitForHydration(locator) {}',
    'async function waitForHydration(locator) {}',
    'const waitForHydration = async (locator) => {};',
    'const waitForHydration = (locator) => {};',
    'let waitForHydration = function (locator) {};',
  ]) {
    assert.equal(definesWaitForHydration(source), true, source);
  }
});

test('the detector leaves the named import alone', () => {
  for (const source of [
    "import { test, expect, waitForHydration } from '../tools/e2e-coverage.cjs';",
    "const { waitForHydration } = require('../tools/e2e-coverage.cjs');",
    'await waitForHydration(trigger);',
  ]) {
    assert.equal(definesWaitForHydration(source), false, source);
  }
});
