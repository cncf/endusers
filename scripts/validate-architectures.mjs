#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDuplicateValue } from './lib/duplicate-check.mjs';
import { isSafeUrl, reportAndExit } from './lib/validate-utils.mjs';
import { findActiveContent } from './lib/mdx-active-content.mjs';
import { findRelativeDestinations } from './lib/architecture-content.mjs';
import {
  AUTHORED_KEYS,
  FRONT_MATTER_KEY,
  catalogRecords,
  collectArchitectureRecords,
  splitFrontMatter,
} from './lib/architecture-frontmatter.mjs';
import {
  REPO_AUTHORED_PAGES,
  isReservedPageId,
} from './lib/architecture-pages.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const docsDir = join(root, 'docs/architectures');
const idPattern = /^[a-z0-9][a-z0-9-]*$/;

const catalogPath = join(root, 'data/architectures/catalog.json');

// The catalog is regenerated from the third-party cncf/architecture repository,
// so every field that reaches an href or an <img src> is treated as untrusted.
// isSafeUrl() in ./lib/validate-utils.mjs is the shared gate: it rejects
// userinfo along with a non-https scheme, since
// "https://www.cncf.io@evil.example/x" parses with protocol "https:" while
// resolving to evil.example, so its visible prefix and its real host disagree.
function isHttpsUrl(value) {
  return typeof value === 'string' && Boolean(isSafeUrl(value));
}

// Docusaurus bundles the file a relative link or image destination names,
// whatever its type and wherever it sits in the repository, and publishes it
// under /assets/. A page may therefore only reach files in its own images/
// directory, which validate:architecture-assets gates. The destination is
// decoded the way Docusaurus decodes it, and any query or fragment dropped,
// before it is resolved; a value that cannot be decoded fails closed.
function staysInImages(page, url) {
  let path;
  try {
    path = decodeURIComponent(url.replace(/[?#].*$/, ''));
  } catch {
    return false;
  }
  const pageDir = join(docsDir, dirname(page));
  const imagesDir = resolve(join(pageDir, 'images'));
  return resolve(join(pageDir, path)).startsWith(imagesDir + sep);
}

// markdownlint's MD045/no-alt-text is disabled for docs/architectures/** (see
// .markdownlintignore) on the understanding that this validator gates the
// generated pages instead, so the alt-text check lives here: an image whose
// alt is empty renders with no text alternative at all, and a diagram is the
// content of a reference-architecture page.
function findMissingAltText(content) {
  const findings = [];
  content.split('\n').forEach((text, index) => {
    for (const match of text.matchAll(/!\[([^\]]*)\]\([^)]*\)/g))
      if (match[1].trim() === '')
        findings.push({ line: index + 1, snippet: match[0] });
  });
  return findings;
}

// published and updated are rendered on the catalog cards and drive the
// "Recently updated" sort, so each must be a real YYYY-MM-DD calendar date.
// Round-tripping through Date rejects impossible days such as 2026-02-30.
function isCalendarDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().startsWith(value)
  );
}

// Each page's front matter is the source of truth for its catalog record;
// data/architectures/catalog.json is the generated mirror. The rules below
// run on the records the pages describe, then the committed catalog is
// compared with them so a page edit that was not followed by
// `npm run generate:architectures` fails here rather than shipping stale.
const { records, problems, irregular } = collectArchitectureRecords(
  docsDir,
  REPO_AUTHORED_PAGES,
);
const ids = new Set();
const errors = [];
for (const { page, message } of problems)
  errors.push({ path: page, severity: 'error', message });

for (const record of records) {
  if (!record.title || !record.organization)
    errors.push({
      path: record.page,
      severity: 'error',
      message: `front matter must set title and ${FRONT_MATTER_KEY}.organization`,
    });
  if (typeof record.summary !== 'string' || !record.summary.trim())
    errors.push({
      path: record.page,
      severity: 'error',
      message: `${FRONT_MATTER_KEY}.summary must be a non-empty string; it is the catalog card's description`,
    });
  for (const key of ['industries', 'tags', 'projects'])
    if (
      !Array.isArray(record[key]) ||
      record[key].some((item) => typeof item !== 'string' || !item.trim())
    )
      errors.push({
        path: record.page,
        severity: 'error',
        message: `${FRONT_MATTER_KEY}.${key} must be a list of non-empty strings`,
      });
  if ('sourceCommit' in record && 'sourceIssue' in record)
    errors.push({
      path: record.page,
      severity: 'error',
      message: `${FRONT_MATTER_KEY} must set at most one of sourceCommit (cncf/architecture import) or sourceIssue (submission issue)`,
    });
  if ('sourceIssue' in record && !Number.isInteger(record.sourceIssue))
    errors.push({
      path: record.page,
      severity: 'error',
      message: `${FRONT_MATTER_KEY}.sourceIssue must be an issue number`,
    });
  if ('sourceCommit' in record && !/^[0-9a-f]{40}$/.test(record.sourceCommit))
    errors.push({
      path: record.page,
      severity: 'error',
      message: `${FRONT_MATTER_KEY}.sourceCommit must be a full 40-character commit SHA`,
    });
  if (!idPattern.test(record.id))
    errors.push({
      path: record.page,
      severity: 'error',
      message:
        'directory name must be a lowercase slug matching /^[a-z0-9][a-z0-9-]*$/; it is the catalog id, a route segment and a filesystem path component',
    });
  if (isReservedPageId(record.id))
    errors.push({
      path: record.page,
      severity: 'error',
      message:
        'id is reserved for a repo-authored page; a directory claiming it serves the same route as docs/architectures/' +
        `${record.id}.md, which the active-content scan below skips — so the imported body would publish unscanned`,
    });
  checkDuplicateValue(errors, record.page, record.id, ids, 'duplicate id');
  if (!isHttpsUrl(record.sourceUrl))
    errors.push({
      path: record.page,
      severity: 'error',
      message:
        'sourceUrl must be an https URL; it is rendered as an href in the member directory',
    });
  for (const key of ['published', 'updated'])
    if (!isCalendarDate(record[key]))
      errors.push({
        path: record.page,
        severity: 'error',
        message: `${key} must be a YYYY-MM-DD calendar date`,
      });
  if (
    isCalendarDate(record.published) &&
    isCalendarDate(record.updated) &&
    record.updated < record.published
  )
    errors.push({
      path: record.page,
      severity: 'error',
      message: 'updated must not be earlier than published',
    });
  for (const tag of record.tags ?? [])
    if (typeof tag === 'string' && tag.includes('_'))
      errors.push({
        path: record.page,
        severity: 'error',
        message: `tag ${JSON.stringify(tag)} must be a string using spaces, not underscores`,
      });
}

// The active-content scan is driven by the files on disk, not by the catalog.
// Docusaurus publishes every .md under docs/architectures/ regardless of
// whether a record names it, so scanning per-record left any page the catalog
// did not mention published and completely unguarded. That is reachable
// unattended: a record deleted from the catalog leaves its page behind, and
// nothing else would ever scan it again.
for (const page of irregular)
  errors.push({
    path: page,
    severity: 'error',
    message:
      'page must be a regular file; a symlinked page, or a symlinked directory of pages, is published but cannot be gated',
  });

// Every page collectArchitectureRecords could not turn into a record is
// already an error above (wrong layout, no front matter), so the content
// scan runs over the records' pages plus those problem pages: a page is
// published whether or not its metadata parses, and must be gated either way.
// REPO_AUTHORED_PAGES are excluded by collectArchitectureRecords; that is
// safe only because the reserved-id check above rejects a directory that
// would serve the same route as one of them.
const scannedPages = [
  ...records.map((record) => record.page),
  ...problems.map((problem) => problem.page),
].sort();

for (const page of scannedPages) {
  const content = readFileSync(join(docsDir, page), 'utf8');
  const { data } = splitFrontMatter(content);
  const authored = data?.[FRONT_MATTER_KEY];
  if (authored && typeof authored === 'object')
    for (const key of Object.keys(authored))
      if (!AUTHORED_KEYS.includes(key))
        errors.push({
          path: page,
          severity: 'error',
          message: `${FRONT_MATTER_KEY}.${key} is not a catalog field; the fields are ${AUTHORED_KEYS.join(', ')}`,
        });

  for (const { line, reason, snippet } of findActiveContent(content))
    errors.push({
      path: `${page}:${line}`,
      severity: 'error',
      message: `active content in imported page (${reason}): ${snippet}`,
    });

  for (const { line, url } of findRelativeDestinations(content))
    if (!staysInImages(page, url))
      errors.push({
        path: `${page}:${line}`,
        severity: 'error',
        message: `relative destination ${url} must stay inside this architecture's images/ directory`,
      });

  for (const { line, snippet } of findMissingAltText(content))
    errors.push({
      path: `${page}:${line}`,
      severity: 'error',
      message: `image has no alt text: ${snippet}`,
    });
}
// The committed catalog is a generated mirror of the pages. Compare parsed
// records so a `fix:format` refold is not drift, and report before exiting
// so the page errors above (the cause) are shown alongside.
const expected = JSON.stringify(catalogRecords(records));
let committed = null;
if (existsSync(catalogPath))
  try {
    committed = JSON.stringify(JSON.parse(readFileSync(catalogPath, 'utf8')));
  } catch {
    committed = null;
  }
if (committed !== expected)
  errors.push({
    path: 'data/architectures/catalog.json',
    severity: 'error',
    message:
      committed === null
        ? 'catalog is missing or not valid JSON; run `npm run generate:architectures`'
        : "catalog is behind the pages' front matter; run `npm run generate:architectures` and commit the result",
  });

reportAndExit(errors, 'architecture catalog');
console.log(`Validated ${records.length} architecture records`);
