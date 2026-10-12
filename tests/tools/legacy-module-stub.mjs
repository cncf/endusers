// A stand-in for `node:module` as it looked before Node 22.15, used by
// tests/helpers-jsx-legacy-register.test.mjs to reach the `register()` arm of
// tests/helpers-jsx.mjs on an interpreter where `registerHooks` exists.
//
// `registerHooks` is exported as `undefined` rather than omitted so the import
// in helpers-jsx.mjs still binds: a missing named export is a link-time error,
// which would fail the import instead of exercising the fallback.

export const registerHooks = undefined;

/** URLs passed to `register`, in call order. */
export const registerCalls = [];

export function register(url) {
  registerCalls.push(String(url));
}
