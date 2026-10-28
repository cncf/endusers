// The front matter of docs/architectures/<id>/index.md is the source of truth
// for the architecture's catalog metadata. data/architectures/catalog.json is
// generated from it by scripts/generate-architectures.mjs and gated against
// drift by scripts/validate-architectures.mjs, so an author adds or edits one
// file and the catalog follows.
//
// A page's catalog record is its top-level `title` plus the fields nested
// under the `architecture` key, with two derived fields: `id` is the page's
// directory name and `assets` is the sorted listing of its images/ directory,
// published at /img/architectures/<id>/<file> by the build.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { listArchitecturePages, pageCatalogId } from './architecture-pages.mjs';
import { ARCHITECTURE_IMAGE_PREFIX } from './published-assets.mjs';

/** The key the catalog metadata nests under in a page's front matter. */
export const FRONT_MATTER_KEY = 'architecture';

/**
 * Catalog record keys in the order the generated catalog writes them. The
 * source keys are mutually exclusive by origin: a page imported from
 * cncf/architecture carries `sourceCommit`, a page imported from a submission
 * issue carries `sourceIssue`.
 */
export const RECORD_KEYS = [
  'id',
  'title',
  'organization',
  'summary',
  'industries',
  'tags',
  'projects',
  'sourceUrl',
  'sourceCommit',
  'sourceIssue',
  'published',
  'updated',
  'assets',
];

/** Record keys an author writes under `architecture:`; the rest are derived. */
export const AUTHORED_KEYS = RECORD_KEYS.filter(
  (key) => !['id', 'title', 'assets'].includes(key),
);

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Splits a page into its parsed YAML front matter and the body after it.
 * A page without a front matter block, or whose block does not parse to a
 * mapping, yields `data: null` so the caller can report it in context.
 *
 * @param {string} content
 * @returns {{ data: Record<string, unknown> | null, body: string }}
 */
export function splitFrontMatter(content) {
  const match = content.match(FRONT_MATTER);
  if (!match) return { data: null, body: content };
  return {
    data: parseMapping(match[1]),
    body: content.slice(match[0].length),
  };
}

// The parsed YAML when it is a mapping, else null: a list, a scalar, an empty
// block and a block that does not parse all carry no metadata.
function parseMapping(text) {
  try {
    const data = parse(text);
    return typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * The published asset URLs of an architecture directory: every regular file
 * in its images/ directory, sorted. A missing images/ directory is an empty
 * list, which is what an issue-sourced architecture starts with.
 *
 * @param {string} docsDir - Absolute path to docs/architectures.
 * @param {string} id
 * @returns {string[]}
 */
export function listPageAssets(docsDir, id) {
  let entries;
  try {
    entries = readdirSync(join(docsDir, id, 'images'), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return assetUrls(
    id,
    entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
  );
}

/**
 * The published URLs of an architecture's image files, sorted by name.
 * readdir order is whatever the filesystem returns, so the catalog would
 * otherwise differ between checkouts of the same tree.
 *
 * @param {string} id
 * @param {string[]} names - File names within `<id>/images/`.
 * @returns {string[]}
 */
export function assetUrls(id, names) {
  return names
    .map((name) => `${ARCHITECTURE_IMAGE_PREFIX}${id}/${name}`)
    .sort();
}

/**
 * Builds the catalog record for one page from its parsed front matter.
 * Only the keys a record may carry are copied, in catalog order, so an
 * unknown key under `architecture:` is left for the validator to report
 * rather than written into the catalog. Values are copied as parsed; the
 * validator decides whether they are well-formed.
 *
 * @param {string} docsDir - Absolute path to docs/architectures.
 * @param {string} id
 * @param {Record<string, unknown>} data - Parsed front matter.
 * @returns {Record<string, unknown>}
 */
export function recordFromFrontMatter(docsDir, id, data) {
  const authored =
    typeof data[FRONT_MATTER_KEY] === 'object' &&
    data[FRONT_MATTER_KEY] !== null &&
    !Array.isArray(data[FRONT_MATTER_KEY])
      ? data[FRONT_MATTER_KEY]
      : {};
  const record = { id, title: data.title };
  for (const key of AUTHORED_KEYS)
    if (key in authored) record[key] = authored[key];
  record.assets = listPageAssets(docsDir, id);
  return record;
}

/**
 * Reads every architecture page under docsDir and returns the catalog records
 * their front matter describes, in catalog order (by organization, then id),
 * together with the pages that could not yield one: a page outside the
 * `<id>/index.md` layout, or one without a front matter mapping. The
 * `irregular` entries from listArchitecturePages are passed through untouched.
 *
 * @param {string} docsDir - Absolute path to docs/architectures.
 * @param {Iterable<string>} skip - Relative page paths that are not
 *   architectures (the repo-authored catalog and submission pages).
 * @returns {{
 *   records: Array<Record<string, unknown> & { page: string }>,
 *   problems: Array<{ page: string, message: string }>,
 *   irregular: string[],
 * }}
 */
export function collectArchitectureRecords(docsDir, skip) {
  const skipped = new Set(skip);
  const { pages, irregular } = listArchitecturePages(docsDir);
  const records = [];
  const problems = [];
  for (const page of pages) {
    if (skipped.has(page)) continue;
    const id = pageCatalogId(page);
    if (!id) {
      problems.push({
        page,
        message:
          'page is not at <id>/index.md; an architecture is a directory holding index.md and images/',
      });
      continue;
    }
    const { data } = splitFrontMatter(
      readFileSync(join(docsDir, page), 'utf8'),
    );
    if (!data) {
      problems.push({
        page,
        message: 'page has no YAML front matter mapping to read metadata from',
      });
      continue;
    }
    records.push({ ...recordFromFrontMatter(docsDir, id, data), page });
  }
  records.sort(compareRecords);
  return { records, problems, irregular };
}

// The order the importer has always written the catalog in, with id as a
// tie-break so two architectures from one organization have a stable order.
function compareRecords(a, b) {
  return (
    String(a.organization ?? '').localeCompare(String(b.organization ?? '')) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * The catalog records as they are written to catalog.json: the record fields
 * in catalog order, without the `page` bookkeeping field.
 *
 * @param {Array<Record<string, unknown>>} records
 * @returns {Array<Record<string, unknown>>}
 */
export function catalogRecords(records) {
  return records.map((record) => {
    const out = {};
    for (const key of RECORD_KEYS) if (key in record) out[key] = record[key];
    return out;
  });
}

/**
 * The catalog.json text for a set of records, two-space indented with a
 * trailing newline like the other generated data files; `fix:format` then
 * folds short arrays onto one line. The validator compares parsed records,
 * not text, so that formatting pass is not drift.
 *
 * @param {Array<Record<string, unknown>>} records
 * @returns {string}
 */
export function serializeCatalog(records) {
  return JSON.stringify(catalogRecords(records), null, 2) + '\n';
}
