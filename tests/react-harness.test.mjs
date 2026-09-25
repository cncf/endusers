// tests/tools/react-hook-driver.mjs and tests/tools/react-element-tree.mjs are
// the two harness modules every component suite reads its subject through: the
// driver supplies the hook dispatcher, the tree walker supplies the assertions.
// The branches pinned here are the ones no component suite happens to reach, so
// a regression in them would surface as an unexplained component failure — or,
// worse, as a suite that keeps passing while asserting nothing.

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';

import { renderHook } from './tools/react-hook-driver.mjs';
import { textOf } from './tools/react-element-tree.mjs';

test('the hook driver memoises useCallback on its dependency array', () => {
  // No component under test uses useCallback today, so the dispatcher slot is
  // unexercised: it could return a fresh function on every render — or throw —
  // without any suite noticing until a component adopts the hook.
  let deps = [1];
  const seen = [];
  const api = renderHook(() => {
    const fn = React.useCallback(() => deps[0], deps);
    seen.push(fn);
    return fn;
  });

  api.rerender();
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1], 'identical deps must reuse the callback');
  assert.equal(api.result(), 1);

  deps = [2];
  api.rerender();
  assert.equal(seen.length, 3);
  assert.notEqual(seen[2], seen[1], 'changed deps must produce a new callback');
  assert.equal(api.result(), 2);
});

test('textOf returns an empty string for a non-renderable child', () => {
  // A render-prop child is a function, which is neither primitive, array nor
  // element. textOf must contribute nothing for it rather than stringifying
  // the function body into the text an assertion is matching against.
  assert.equal(
    textOf(() => 'never rendered'),
    '',
  );
  assert.equal(textOf(Symbol('child')), '');
  assert.equal(
    textOf({ type: 'p', props: { children: ['a', () => 'b', 'c'] } }),
    'ac',
  );
});
