#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDuplicateValue } from './lib/duplicate-check.mjs';
import { isSafeUrl, reportAndExit } from './lib/validate-utils.mjs';
import { findActiveContent } from './lib/mdx-active-content.mjs';
import {
  REPO_AUTHORED_PAGES,
  isReservedPageId,
  listArchitecturePages,
  pageCatalogId,
} from './lib/architecture-pages.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const staticRoot = resolve(join(root, 'static'));
const assetPrefix = '/img/architectures/';
const assetRoot = resolve(join(staticRoot, assetPrefix.slice(1)));
const idPattern = /^[a-z0-9][a-z0-9-]*$/;

const catalogPath = join(root, 'data/architectures/catalog.json');
if (!existsSync(catalogPath))
  throw new Error('Missing data/architectures/catalog.json');

// The catalog is regenerated from the third-party cncf/architecture repository,
// so every field that reaches an href or an <img src> is treated as untrusted.
// isSafeUrl() in ./lib/validate-utils.mjs is the shared gate: it rejects
// userinfo along with a non-https scheme, since
// "https://www.cncf.io@evil.example/x" parses with protocol "https:" while
// resolving to evil.example, so its visible prefix and its real host disagree.
function isHttpsUrl(value) {
  return typeof value === 'string' && Boolean(isSafeUrl(value));
}

// Resolve first, then assert containment: '..' segments are normalised away by
// join()/resolve(), so testing the raw value would let the guard be bypassed.
function resolveContainedAsset(asset) {
  if (typeof asset !== 'string' || !asset.startsWith(assetPrefix)) return null;
  const resolved = resolve(join(staticRoot, asset.slice(1)));
  if (resolved !== assetRoot && !resolved.startsWith(assetRoot + sep))
    return null;
  return resolved;
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

const records = JSON.parse(readFileSync(catalogPath, 'utf8'));
const ids = new Set();
const errors = [];
for (const record of records) {
  if (!record.id || !record.title || !record.organization)
    errors.push({
      path: record.id || '<unknown>',
      severity: 'error',
      message: 'missing id, title, or organization',
    });
  if (record.id && !idPattern.test(record.id))
    errors.push({
      path: record.id,
      severity: 'error',
      message:
        'id must be a lowercase slug matching /^[a-z0-9][a-z0-9-]*$/; it is used as a route segment and as a filesystem path component',
    });
  if (isReservedPageId(record.id))
    errors.push({
      path: record.id,
      severity: 'error',
      message:
        'id is reserved for a repo-authored page; a record claiming it overwrites docs/architectures/' +
        `${record.id}.md, which the active-content scan below skips — so the imported body would publish unscanned`,
    });
  checkDuplicateValue(errors, record.id, record.id, ids, 'duplicate id');
  if (!isHttpsUrl(record.sourceUrl))
    errors.push({
      path: record.id || '<unknown>',
      severity: 'error',
      message:
        'sourceUrl must be an https URL; it is rendered as an href in the member directory',
    });
  for (const key of ['published', 'updated'])
    if (!isCalendarDate(record[key]))
      errors.push({
        path: record.id || '<unknown>',
        severity: 'error',
        message: `${key} must be a YYYY-MM-DD calendar date`,
      });
  if (
    isCalendarDate(record.published) &&
    isCalendarDate(record.updated) &&
    record.updated < record.published
  )
    errors.push({
      path: record.id,
      severity: 'error',
      message: 'updated must not be earlier than published',
    });
  for (const tag of record.tags ?? [])
    if (typeof tag !== 'string' || tag.includes('_'))
      errors.push({
        path: record.id,
        severity: 'error',
        message: `tag ${JSON.stringify(tag)} must be a string using spaces, not underscores`,
      });
  for (const asset of record.assets ?? []) {
    const file = resolveContainedAsset(asset);
    if (!file) {
      errors.push({
        path: record.id,
        severity: 'error',
        message: `asset ${asset} must be a site-absolute path contained in ${assetPrefix}`,
      });
      continue;
    }
    if (!existsSync(file))
      errors.push({
        path: record.id,
        severity: 'error',
        message: `missing asset ${asset}`,
      });
  }
}

// The active-content scan is driven by the files on disk, not by the catalog.
// Docusaurus publishes every .md under docs/architectures/ regardless of
// whether a record names it, so scanning per-record left any page the catalog
// did not mention published and completely unguarded. That is reachable
// unattended: a record deleted from the catalog leaves its page behind, and
// nothing else would ever scan it again.
const docsDir = join(root, 'docs/architectures');
const { pages, irregular } = listArchitecturePages(docsDir);
const catalogIds = new Set(records.map((record) => record.id).filter(Boolean));

for (const page of irregular)
  errors.push({
    path: page,
    severity: 'error',
    message:
      'page must be a regular file; a symlinked page, or a symlinked directory of pages, is published but cannot be gated',
  });

for (const page of pages) {
  // Safe only because no imported record can claim a repo-authored id: the
  // reserved-id check above rejects the catalog record an importer writes
  // alongside the page, so nothing imported ever reaches this `continue`.
  if (REPO_AUTHORED_PAGES.has(page)) continue;

  const catalogId = pageCatalogId(page);
  if (!catalogId || !catalogIds.has(catalogId))
    errors.push({
      path: page,
      severity: 'error',
      message:
        'page has no catalog record; it is published but nothing in data/architectures/ describes it — delete it or add its catalog record',
    });

  const content = readFileSync(join(docsDir, page), 'utf8');
  for (const { line, reason, snippet } of findActiveContent(content))
    errors.push({
      path: `${page}:${line}`,
      severity: 'error',
      message: `active content in imported page (${reason}): ${snippet}`,
    });

  for (const { line, snippet } of findMissingAltText(content))
    errors.push({
      path: `${page}:${line}`,
      severity: 'error',
      message: `image has no alt text: ${snippet}`,
    });
}
reportAndExit(errors, 'architecture catalog');
console.log(`Validated ${records.length} architecture records`);
