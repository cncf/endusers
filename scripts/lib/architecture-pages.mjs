// Single source of truth for which files under docs/architectures/ are
// imported pages.
//
// Docusaurus routes docs/ by filesystem, not by data/architectures/catalog.json,
// so every .md in this directory is published whether or not a catalog record
// names it. Driving either the import pruner or the active-content gate from
// the catalog (or from the upstream checkout) therefore leaves any file the
// two disagree about published and unguarded — the failure mode
// scripts/validate-community-people.mjs already documents for its own loop.
// Both callers enumerate the directory through this module instead.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pages written by this repository rather than imported from
 * cncf/architecture. `index.md` is the hand-authored catalog landing page: it
 * renders <div>/<h3> layout and imports <ReferenceArchitectures />, all of
 * which findActiveContent() is correct to reject in an *imported* body. They
 * are exempt from the imported-content gate and are never pruned by the
 * importer.
 */
export const REPO_AUTHORED_PAGES = new Set(['index.md']);

/**
 * Lists every Markdown page under docs/architectures/, as paths relative to
 * that directory, sorted for stable output.
 *
 * Entries that are neither a regular file nor a directory are returned in
 * `irregular` rather than skipped: `Dirent.isFile()` and `isDirectory()` are
 * both false for a symbolic link, so silently ignoring one would publish a
 * symlinked page that no caller ever reads. The caller decides what to do
 * with them; nothing here follows a link.
 *
 * @param {string} docsDir - Absolute path to docs/architectures.
 * @returns {{ pages: string[], irregular: string[] }}
 */
export function listArchitecturePages(docsDir) {
  const pages = [];
  const irregular = [];
  if (!existsSync(docsDir)) return { pages, irregular };

  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), relativePath);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      if (entry.isFile()) pages.push(relativePath);
      else irregular.push(relativePath);
    }
  };

  walk(docsDir, '');
  return { pages: pages.sort(), irregular: irregular.sort() };
}

/**
 * The catalog id a page path corresponds to, or null when the path is not a
 * top-level `<id>.md`. Nested paths have no catalog record by construction.
 *
 * @param {string} relativePath
 * @returns {string|null}
 */
export function pageCatalogId(relativePath) {
  if (relativePath.includes('/')) return null;
  return relativePath.endsWith('.md') ? relativePath.slice(0, -3) : null;
}
