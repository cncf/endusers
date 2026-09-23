// Helper for unit tests that need to render a component whose input is a
// checked-in data file rather than props.
//
// Components such as src/components/PeopleFreshness/index.js read
// `@site/data/<file>.json` at module scope and take no props, so the branches
// the live data does not happen to reach (a malformed timestamp, an archived
// upstream repo) are unreachable from a test that imports the real module.
//
// This helper copies the component source into a temp directory, rewrites its
// `@site/...` JSON imports to point at fixture files written alongside the
// copy, and imports the copy through tests/helpers-jsx.mjs so the JSX and CSS
// Modules hooks still apply. The component source itself stays unchanged.
//
// Usage:
//
//   const { default: Component, cleanup } = await importWithData(
//     'src/components/PeopleFreshness/index.js',
//     { '@site/data/community-people.json': { fetchedAt: 'nonsense' } },
//   );

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { importSource } from './helpers-jsx.mjs';

const REPO_ROOT = new URL('../', import.meta.url);

/**
 * Imports a copy of a component with its `@site/...` data imports replaced by
 * fixtures.
 *
 * @param {string} repoRelativePath e.g. 'src/components/Foo/index.js'
 * @param {Record<string, unknown>} fixtures data keyed by the exact `@site/...`
 *   specifier the source imports; every key must appear in the source.
 * @returns {Promise<Record<string, unknown> & {cleanup: () => void}>} the
 *   module namespace of the copy, plus a `cleanup` that removes the temp copy.
 */
export async function importWithData(repoRelativePath, fixtures) {
  const source = readFileSync(
    fileURLToPath(new URL(repoRelativePath, REPO_ROOT)),
    'utf8',
  );

  const work = mkdtempSync(join(tmpdir(), 'endusers-component-'));
  let rewritten = source;
  for (const [specifier, data] of Object.entries(fixtures)) {
    if (!rewritten.includes(specifier)) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(
        `${repoRelativePath} does not import ${specifier}; the fixture would be ignored`,
      );
    }
    const fixtureName = basename(specifier);
    writeFileSync(join(work, fixtureName), JSON.stringify(data));
    rewritten = rewritten.split(specifier).join(`./${fixtureName}`);
  }

  // Each import gets its own directory so Node's module cache does not hand
  // back a copy built from a previous fixture.
  const copy = join(work, 'index.js');
  mkdirSync(work, { recursive: true });
  writeFileSync(copy, rewritten);
  // The copy still imports `react`, which Node resolves from the directory the
  // module lives in; link the repository install so the temp copy sees it.
  symlinkSync(
    fileURLToPath(new URL('node_modules', REPO_ROOT)),
    join(work, 'node_modules'),
  );

  // importSource resolves its argument against the repository root; an
  // absolute path resolves to itself, which is what a temp copy needs.
  const namespace = await importSource(copy);
  return {
    ...namespace,
    cleanup: () => rmSync(work, { recursive: true, force: true }),
  };
}
