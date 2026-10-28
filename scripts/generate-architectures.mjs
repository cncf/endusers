#!/usr/bin/env node
// Regenerates data/architectures/catalog.json from the front matter of every
// docs/architectures/<id>/index.md. The page is the source of truth; this
// writes the mirror the catalog component, member directory and data-link
// checks read. `validate:architectures` fails when the committed catalog is
// behind the pages, and names this script as the fix.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectArchitectureRecords,
  serializeCatalog,
} from './lib/architecture-frontmatter.mjs';
import { REPO_AUTHORED_PAGES } from './lib/architecture-pages.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const docsDir = join(root, 'docs/architectures');
const catalogPath = join(root, 'data/architectures/catalog.json');

const { records, problems, irregular } = collectArchitectureRecords(
  docsDir,
  REPO_AUTHORED_PAGES,
);
for (const { page, message } of problems)
  console.error(`generate-architectures: ${page}: ${message}`);
for (const page of irregular)
  console.error(
    `generate-architectures: ${page}: not a regular file or directory`,
  );
if (problems.length > 0 || irregular.length > 0) {
  console.error(
    'generate-architectures: fix the pages above; the catalog was not written',
  );
  process.exit(1);
}

const next = serializeCatalog(records);
let previous = null;
try {
  previous = readFileSync(catalogPath, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
// fix:format refolds the committed file, so compare parsed records, not text.
if (previous !== null && sameJson(previous, next)) {
  console.log(
    `generate-architectures: catalog.json is current (${records.length} records)`,
  );
} else {
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, next);
  console.log(
    `generate-architectures: wrote catalog.json (${records.length} records)`,
  );
}

function sameJson(a, b) {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return false;
  }
}
