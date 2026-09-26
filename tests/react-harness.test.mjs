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

test('the hook driver resolves a lazy useState initialiser once', () => {
  // A component that passes an expensive initialiser as a function must get
  // its return value, not the function itself, and must not re-run it on a
  // later render the way a hand-rolled dispatcher easily would.
  let initialiserCalls = 0;
  const api = renderHook(() => {
    const [value] = React.useState(() => {
      initialiserCalls += 1;
      return 'lazy';
    });
    return value;
  });

  assert.equal(api.result, 'lazy');
  assert.equal(initialiserCalls, 1);

  api.rerender();
  assert.equal(api.result, 'lazy');
  assert.equal(initialiserCalls, 1, 'the initialiser must not run again');
});

test('a functional state update is applied to the current value', () => {
  // setCount((n) => n + 1) is the form every counter uses. If the driver
  // stored the updater instead of calling it, the suite under test would
  // assert against a function and silently pass on a truthiness check.
  let setCount;
  const api = renderHook(() => {
    const [count, set] = React.useState(1);
    setCount = set;
    return count;
  });

  setCount((current) => current + 1);
  assert.equal(api.result, 2);

  setCount((current) => current + 1);
  assert.equal(api.result, 3);
});

test('setting state to the value it already holds does not re-render', () => {
  // React bails out of an update that changes nothing. Without the same bail
  // out here, a hook that sets state from an effect would re-render forever
  // and the suite would hang rather than fail.
  let setValue;
  let renders = 0;
  const api = renderHook(() => {
    const [value, set] = React.useState('same');
    setValue = set;
    renders += 1;
    return value;
  });

  assert.equal(renders, 1);

  setValue('same');
  assert.equal(renders, 1, 'an equal value must not re-run the hook body');
  assert.equal(api.result, 'same');

  setValue('changed');
  assert.equal(renders, 2);
  assert.equal(api.result, 'changed');
});

test('an effect with unchanged dependencies is not run again', () => {
  // The whole point of a dependency array is that a rerender with the same
  // deps leaves the effect alone, cleanup included. A driver that re-ran it
  // would make a subscribe/unsubscribe hook look like it leaked listeners.
  const log = [];
  const api = renderHook(() => {
    React.useEffect(() => {
      log.push('setup');
      return () => log.push('cleanup');
    }, ['stable']);
  });

  assert.deepEqual(log, ['setup']);

  api.rerender();
  assert.deepEqual(log, ['setup'], 'identical deps must not re-run the effect');

  api.unmount();
  assert.deepEqual(log, ['setup', 'cleanup']);
});

test('an omitted dependency array re-runs the memo and the effect', () => {
  // useMemo(factory) and useEffect(create) with no deps must run on every
  // render. sameDeps treats an undefined array as "never equal", so this
  // pins the difference between "no deps" and "empty deps".
  let memoCalls = 0;
  const effectLog = [];
  const api = renderHook(() => {
    const memo = React.useMemo(() => {
      memoCalls += 1;
      return memoCalls;
    });
    React.useEffect(() => {
      effectLog.push('setup');
      return () => effectLog.push('cleanup');
    });
    return memo;
  });

  assert.equal(api.result, 1);
  assert.deepEqual(effectLog, ['setup']);

  api.rerender();
  assert.equal(api.result, 2, 'a memo without deps must be recomputed');
  assert.deepEqual(effectLog, ['setup', 'cleanup', 'setup']);
});

test('unmounting twice runs each cleanup only once', () => {
  // Suites unmount in a test body and again in an after hook. A second pass
  // over the effect list would call a cleanup on an already-torn-down
  // subscription, turning tidy teardown into a spurious failure.
  const log = [];
  const api = renderHook(() => {
    React.useEffect(() => () => log.push('cleanup'), []);
  });

  api.unmount();
  api.unmount();

  assert.deepEqual(log, ['cleanup']);
});
