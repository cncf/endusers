// Helper for unit tests that need to import a React source file from src/.
//
// Node cannot parse JSX or resolve CSS Modules on its own, so importing
// `src/components/**/index.js` from a test requires the module customization
// hooks in ./tools/jsx-hooks.mjs. Registering them here — rather than through
// a CLI flag — keeps `npm run test:unit` (`node --test`) working unchanged and
// confines the transpilation to the tests that ask for it.
//
// Usage:
//
//   import { importSource } from './helpers-jsx.mjs';
//   const { filterArchitectures } = await importSource(
//     'src/components/ArchitectureFilters/index.js',
//   );

import { register, registerHooks } from 'node:module';

const HOOKS_URL = new URL('./tools/jsx-hooks.mjs', import.meta.url);
const REPO_ROOT = new URL('../', import.meta.url);

let registration = null;

async function ensureHooks() {
  if (!registration) {
    registration = (async () => {
      if (typeof registerHooks === 'function') {
        // Synchronous, in-thread hooks: the non-deprecated path, available
        // from Node 22.15 onwards.
        registerHooks(await import(HOOKS_URL.href));
      } else {
        register(HOOKS_URL);
      }
    })();
  }
  return registration;
}

/**
 * Import a source file from the repository root, transpiling JSX and stubbing
 * CSS Modules imports.
 *
 * @param {string} repoRelativePath e.g. 'src/components/Foo/index.js'
 * @returns {Promise<Record<string, unknown>>} the module namespace
 */
export async function importSource(repoRelativePath) {
  await ensureHooks();
  return import(new URL(repoRelativePath, REPO_ROOT).href);
}
