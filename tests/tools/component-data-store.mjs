// Backing store for the fixture bindings that tests/helpers-component-data.mjs
// swaps in and out.
//
// Components such as src/components/PeopleFreshness/index.js import their data
// with `import data from '@site/data/<file>.json'` at module scope, so a test
// that wants a shape the checked-in file does not contain has to change what
// that import evaluates to. The module customization hooks in ./jsx-hooks.mjs
// resolve every `@site/data/**.json` specifier to a generated stub module that
// re-exports a *mutable* binding and publishes its setter on the global map
// this module reads; swapping a fixture in is then an assignment, and the
// component keeps its real `src/components/**` URL rather than being imported
// from a rewritten copy.
//
// Keeping the real URL is the point: V8 attributes coverage by script URL, so
// a copy under /tmp credits its branches to a path that does not survive the
// run (#571).
//
// The baseline recorded at registration is the checked-in file's own data, so
// `restoreFixtures` returns the module to the state an unqualified
// `importSource` would have seen. Tests that render live data and tests that
// render fixtures can therefore share one process.

// The stubs are `data:` URL modules with no way to import this file by a
// relative specifier, and importing it by absolute URL would give it a
// coverage record in every process that merely renders a component. They
// publish their setters on this global instead; the key is shared by literal
// with ./jsx-hooks.mjs.
/** @type {Map<string, {baseline: unknown, setValue: (value: unknown) => void}>} */
const bindings = (globalThis[Symbol.for('endusers:component-data-bindings')] ??=
  new Map());

/** Specifiers whose value is currently a fixture rather than the baseline. */
const active = new Set();

/**
 * Points each named specifier at fixture data.
 *
 * @param {Record<string, unknown>} fixtures keyed by `@site/...` specifier
 */
export function applyFixtures(fixtures) {
  for (const specifier of Object.keys(fixtures)) {
    if (!bindings.has(specifier)) {
      throw new Error(
        `${specifier} has not been imported by any module under test; ` +
          'the fixture would be ignored',
      );
    }
    if (active.has(specifier)) {
      throw new Error(
        `a fixture for ${specifier} is already active; call cleanup() before ` +
          'importing with another fixture',
      );
    }
  }
  for (const [specifier, data] of Object.entries(fixtures)) {
    bindings.get(specifier).setValue(data);
    active.add(specifier);
  }
}

/**
 * Restores each named specifier to the checked-in file's data.
 *
 * @param {Iterable<string>} specifiers
 */
export function restoreFixtures(specifiers) {
  for (const specifier of specifiers) {
    const binding = bindings.get(specifier);
    if (!binding) continue;
    binding.setValue(binding.baseline);
    active.delete(specifier);
  }
}
