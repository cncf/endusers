import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

// `tests/helpers-jsx.mjs` picks one of two module-customization APIs:
//
//   registerHooks(await import(HOOKS_URL.href))   // Node >= 22.15
//   register(HOOKS_URL)                           // everything older
//
// package.json pins `engines.node` to `22.x`, and `registerHooks` only landed
// in 22.15, so the second arm is live code for a supported interpreter rather
// than dead compatibility ballast. It is also unreachable from inside a test
// process, which always runs a Node where `registerHooks` exists — so the arm
// that the oldest supported Node would take was the one nothing checked. A
// regression there (a typo in the `register` call, the wrong argument shape)
// would be invisible in CI and would break `npm run test:unit` outright on
// 22.0-22.14, because every test that imports a `src/**` React file depends on
// those hooks being installed.
//
// The branch is driven by redirecting the helper's own `node:module` import at
// a stub, using a `registerHooks` resolve hook — public API, no flags. The
// redirect is keyed on the importing module, so only the cache-busted copy of
// the helper loaded below sees the stub; `node:module` resolves normally
// everywhere else in this process, including for the hook machinery itself.
const STUB_URL = new URL('./tools/legacy-module-stub.mjs', import.meta.url)
  .href;

// A fresh query string defeats the module cache, which matters twice over: the
// helper memoizes its registration in a module-scoped `registration`, and the
// instance under test has to be the one resolved through the redirect.
const HELPER_URL = new URL(
  './helpers-jsx.mjs?legacy-register-fallback',
  import.meta.url,
).href;

function withModuleStubbedFor(importerUrl, run) {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'node:module' && context.parentURL === importerUrl) {
        return { url: STUB_URL, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    return run();
  } finally {
    hooks.deregister();
  }
}

test('importSource falls back to register() when registerHooks is absent', async () => {
  const { calls, importSource } = await withModuleStubbedFor(
    HELPER_URL,
    async () => {
      const helper = await import(HELPER_URL);
      const stub = await import(STUB_URL);
      return { calls: stub.registerCalls, importSource: helper.importSource };
    },
  );

  assert.deepEqual(calls, [], 'the helper must not register at import time');

  // `src/lib/profile-links.mjs` is plain ESM, so it imports successfully even
  // though the stubbed `register` installed nothing. That keeps the assertion
  // on the helper's own contract -- the fallback still resolves the requested
  // path against the repository root and returns its namespace -- rather than
  // on what the hooks would have done.
  const mod = await importSource('src/lib/profile-links.mjs');
  assert.equal(typeof mod.websiteUrl, 'function');

  assert.equal(calls.length, 1, 'the legacy arm registers exactly once');
  // Asserted as the exact `file:` URL, not a suffix: `register()` resolves a
  // bare string against the caller, so handing it a plain filesystem path
  // instead of a URL would not register anything.
  assert.equal(
    calls[0],
    new URL('./tools/jsx-hooks.mjs', import.meta.url).href,
  );

  // The memoized `registration` is shared by the fallback arm too: a second
  // call must reuse it rather than register the hooks again.
  await importSource('src/lib/profile-links.mjs');
  assert.equal(calls.length, 1, 'a second import reuses the registration');
});
