// Helper for unit tests that need to render a component whose input is a
// checked-in data file rather than props.
//
// Components such as src/components/PeopleFreshness/index.js read
// `@site/data/<file>.json` at module scope and take no props, so the branches
// the live data does not happen to reach (a malformed timestamp, an archived
// upstream repo) are unreachable from a test that imports the real module.
//
// This helper imports the component from its real `src/components/**` URL and
// swaps the data instead: tests/tools/jsx-hooks.mjs resolves every
// `@site/data/**.json` specifier to a live-binding stub, and
// tests/tools/component-data-store.mjs reassigns that binding for the duration
// of the test. `cleanup()` restores the checked-in data, so live-data
// assertions and fixture-driven assertions can share one process — and the
// branches driven here are credited to the component's own file rather than to
// a temporary copy (#571).
//
// Usage:
//
//   const { default: Component, cleanup } = await importWithData(
//     'src/components/PeopleFreshness/index.js',
//     { '@site/data/community-people.json': { fetchedAt: 'nonsense' } },
//   );

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { importSource } from './helpers-jsx.mjs';
import {
  applyFixtures,
  restoreFixtures,
} from './tools/component-data-store.mjs';

const REPO_ROOT = new URL('../', import.meta.url);

/**
 * Imports a component with its `@site/...` data imports replaced by fixtures.
 *
 * @param {string} repoRelativePath e.g. 'src/components/Foo/index.js'
 * @param {Record<string, unknown>} fixtures data keyed by the exact `@site/...`
 *   specifier the source imports; every key must appear in the source.
 * @returns {Promise<Record<string, unknown> & {cleanup: () => void}>} the
 *   module namespace, plus a `cleanup` that restores the checked-in data.
 */
export async function importWithData(repoRelativePath, fixtures) {
  const source = readFileSync(
    fileURLToPath(new URL(repoRelativePath, REPO_ROOT)),
    'utf8',
  );
  for (const specifier of Object.keys(fixtures)) {
    if (!source.includes(specifier)) {
      throw new Error(
        `${repoRelativePath} does not import ${specifier}; the fixture would be ignored`,
      );
    }
  }

  // Importing first registers the stub bindings; a component already imported
  // elsewhere in the process is served from Node's cache and keeps the
  // bindings it registered then.
  const namespace = await importSource(repoRelativePath);
  applyFixtures(fixtures);

  const specifiers = Object.keys(fixtures);
  return {
    ...namespace,
    cleanup: () => restoreFixtures(specifiers),
  };
}
