#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportAndExit } from './lib/validate-utils.mjs';
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
  throw new Error(
    'Missing data/architectures/catalog.json; run npm run import:architectures',
  );

// The catalog is regenerated from the third-party cncf/architecture repository,
// so every field that reaches an href or an <img src> is treated as untrusted.
// Userinfo is rejected along with a non-https scheme:
// "https://www.cncf.io@evil.example/x" parses with protocol "https:" while
// resolving to evil.example, so its visible prefix and its real host disagree.
function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
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
  if (ids.has(record.id))
    errors.push({
      path: record.id,
      severity: 'error',
      message: 'duplicate id',
    });
  ids.add(record.id);
  if (!isHttpsUrl(record.sourceUrl))
    errors.push({
      path: record.id || '<unknown>',
      severity: 'error',
      message:
        'sourceUrl must be an https URL; it is rendered as an href in the member directory',
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
// unattended: the importer only pruned pages whose directory still existed
// upstream, so an architecture removed from cncf/architecture dropped out of
// the catalog while its page stayed behind forever.
const docsDir = join(root, 'docs/architectures');
const { pages, irregular } = listArchitecturePages(docsDir);
const catalogIds = new Set(records.map((record) => record.id).filter(Boolean));

for (const page of irregular)
  errors.push({
    path: page,
    severity: 'error',
    message:
      'page must be a regular file; a symlinked page is published but cannot be gated',
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
        'page has no catalog record; it is published but nothing regenerates it — delete it or re-run npm run import:architectures',
    });

  for (const { line, reason, snippet } of findActiveContent(
    readFileSync(join(docsDir, page), 'utf8'),
  ))
    errors.push({
      path: `${page}:${line}`,
      severity: 'error',
      message: `active content in imported page (${reason}): ${snippet}`,
    });
}
reportAndExit(errors, 'architecture catalog');
console.log(`Validated ${records.length} architecture records`);
