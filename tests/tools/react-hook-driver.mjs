import React from 'react';

// React routes useRef/useEffect through a per-render "dispatcher" object.
// Swapping that slot lets a plain Node test call a hook directly, with no DOM,
// no renderer and no extra dependency. The slot is restored immediately after
// the hook body runs, so this never leaks into other tests in the same process.
const Internals =
  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false;
  return a.length === b.length && a.every((dep, i) => Object.is(dep, b[i]));
}

/**
 * Drives a hook that uses useRef, useEffect, useState, useMemo or useCallback.
 *
 * Effects run after the hook body returns, mirroring React's ordering, and
 * re-run on rerender only when their dependency array changes — the previous
 * cleanup fires first, as React does. A state setter records the new value and
 * immediately re-runs the hook body, so `api.result` reflects the update the
 * way a re-render would.
 *
 * @param {Function} hook - Invokes the hook under test and returns its result.
 * @returns {{ result: any, rerender: Function, unmount: Function }}
 */
export function renderHook(hook) {
  const refs = [];
  const effects = [];
  const states = [];
  const memos = [];
  let unmounted = false;
  // Stryker disable next-line BooleanLiteral: runHookBody assigns rendering before it calls hook(), and only a setter called from inside hook() reads it, so this seed is never read
  let rendering = false;

  function runHookBody() {
    let refIndex = 0;
    let effectIndex = 0;
    let stateIndex = 0;
    let memoIndex = 0;
    const pending = [];
    const previousDispatcher = Internals.H;
    Internals.H = {
      useRef(initial) {
        // Stryker disable next-line ConditionalExpression: refIndex counts up from 0 and push appends past the indices this render reads, so pushing unconditionally changes only how much the array grows
        if (refIndex === refs.length) refs.push({ current: initial });
        return refs[refIndex++];
      },
      useEffect(create, deps) {
        pending.push({ slot: effectIndex++, create, deps });
      },
      useState(initial) {
        const slot = stateIndex++;
        if (slot === states.length) {
          states.push({
            value: typeof initial === 'function' ? initial() : initial,
            setter: (next) => {
              const current = states[slot].value;
              const value = typeof next === 'function' ? next(current) : next;
              if (Object.is(value, current)) return;
              states[slot].value = value;
              // React batches updates and re-renders once; a setter called
              // from inside the hook body must not recurse here.
              if (!rendering && !unmounted) api.result = runHookBody();
            },
          });
        }
        return [states[slot].value, states[slot].setter];
      },
      useMemo(factory, deps) {
        // Stryker disable next-line UpdateOperator: counting down hands out 0, -1, -2 instead of 0, 1, 2, and memos is only ever indexed by these slots, so every render still reads back what the one before it wrote
        const slot = memoIndex++;
        const previous = memos[slot];
        if (previous && sameDeps(previous.deps, deps)) return previous.value;
        const value = factory();
        memos[slot] = { deps, value };
        return value;
      },
      useCallback(fn, deps) {
        return Internals.H.useMemo(() => fn, deps);
      },
    };
    let result;
    rendering = true;
    try {
      result = hook();
    } finally {
      rendering = false;
      Internals.H = previousDispatcher;
    }

    for (const { slot, create, deps } of pending) {
      const previous = effects[slot];
      if (previous && sameDeps(previous.deps, deps)) continue;
      previous?.cleanup?.();
      effects[slot] = { deps, cleanup: create() };
    }
    return result;
  }

  const api = {
    result: runHookBody(),
    rerender() {
      api.result = runHookBody();
      return api.result;
    },
    unmount() {
      if (unmounted) return;
      unmounted = true;
      // Stryker disable next-line OptionalChaining: effect slots are handed out in call order from 0, so effects never has a hole for this walk to read as undefined
      for (const effect of effects) effect?.cleanup?.();
    },
  };
  return api;
}
