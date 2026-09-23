#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportAndExit } from './lib/validate-utils.mjs';
import { findActiveContent } from './lib/mdx-active-content.mjs';

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
function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
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
  if (record.id) {
    const docPath = join(root, 'docs/architectures', `${record.id}.md`);
    if (existsSync(docPath)) {
      for (const { line, reason, snippet } of findActiveContent(
        readFileSync(docPath, 'utf8'),
      ))
        errors.push({
          path: `${record.id}.md:${line}`,
          severity: 'error',
          message: `active content in imported page (${reason}): ${snippet}`,
        });
    }
  }
}
reportAndExit(errors, 'architecture catalog');
console.log(`Validated ${records.length} architecture records`);
