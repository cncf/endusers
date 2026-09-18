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
 * Drives a hook that uses only useRef and useEffect.
 *
 * Effects run after the hook body returns, mirroring React's ordering, and
 * re-run on rerender only when their dependency array changes — the previous
 * cleanup fires first, as React does.
 *
 * @param {Function} hook - Invokes the hook under test and returns its result.
 * @returns {{ result: any, rerender: Function, unmount: Function }}
 */
export function renderHook(hook) {
  const refs = [];
  const effects = [];
  let unmounted = false;

  function runHookBody() {
    let refIndex = 0;
    let effectIndex = 0;
    const pending = [];
    const previousDispatcher = Internals.H;
    Internals.H = {
      useRef(initial) {
        if (refIndex === refs.length) refs.push({ current: initial });
        return refs[refIndex++];
      },
      useEffect(create, deps) {
        pending.push({ slot: effectIndex++, create, deps });
      },
    };
    let result;
    try {
      result = hook();
    } finally {
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
      for (const effect of effects) effect?.cleanup?.();
    },
  };
  return api;
}
