#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { reportAndExit } from './lib/validate-utils.mjs';
import {
  END_USER_SUPPORTER_SUBCATEGORY,
  LANDSCAPE_CATEGORY,
} from './lib/enduser-landscape.mjs';

const staticRoot = fileURLToPath(new URL('../static/', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(new URL('../data/enduser-landscape.json', import.meta.url)),
);
const errors = [];
const allowedRoles = new Set(['member', 'contributor', 'supporter']);
const allowedImageExtensions = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);

function error(path, message) {
  errors.push({ path, severity: 'error', message });
}

function nonEmpty(path, value) {
  if (typeof value !== 'string' || !value.trim()) {
    error(path, 'must be a non-empty string');
    return false;
  }
  return true;
}

function checkUrl(path, value, protocols = ['http:', 'https:']) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string' || !value.trim()) {
    error(path, 'must be null or a non-empty URL');
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    error(path, 'must be a parseable URL');
    return;
  }
  if (!protocols.includes(parsed.protocol)) {
    error(path, `must use ${protocols.join(' or ')}`);
  }
  if (parsed.username || parsed.password) {
    error(path, 'must not carry userinfo');
  }
}

function localAsset(path, value) {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== 'string' || !value.trim()) {
    error(path, 'must be null or a non-empty site-local path');
    return;
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    error(path, 'must be an absolute site-local path');
    return;
  }
  if (value.split('/').includes('..')) {
    error(path, 'must not traverse out of static/');
    return;
  }
  const extension = value.slice(value.lastIndexOf('.')).toLowerCase();
  if (!allowedImageExtensions.has(extension)) {
    error(path, `unsupported image extension: ${extension}`);
  }
  if (!existsSync(join(staticRoot, value.slice(1)))) {
    error(path, `asset does not exist under static/: ${value}`);
  }
}

if (snapshot?.generated !== true) {
  error('generated', 'must be true');
}
if (Number.isNaN(Date.parse(snapshot?.collectedAt))) {
  error('collectedAt', 'must be an ISO timestamp');
}

const source = snapshot?.source;
if (!source || typeof source !== 'object') {
  error('source', 'must be an object');
} else {
  if (source.repository !== 'https://github.com/cncf/landscape') {
    error('source.repository', 'must identify cncf/landscape');
  }
  if (source.file !== 'landscape.yml') {
    error('source.file', 'must be landscape.yml');
  }
  if (
    typeof source.revision !== 'string' ||
    !/^[0-9a-f]{40}$/.test(source.revision)
  ) {
    error('source.revision', 'must be a full lowercase commit SHA');
  }
  if (
    typeof source.revision === 'string' &&
    source.revision.length === 40 &&
    source.sourceUrl !==
      `https://github.com/cncf/landscape/blob/${source.revision}/landscape.yml`
  ) {
    error('source.sourceUrl', 'must point to the pinned landscape revision');
  }
  checkUrl('source.sourceUrl', source.sourceUrl, ['https:']);
}

for (const field of ['member', 'contributor', 'supporter']) {
  nonEmpty(`selection.${field}`, snapshot?.selection?.[field]);
}

const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
if (!records.length) error('records', 'must be a non-empty array');

const sourceIds = new Set();
let includedCount = 0;
for (const [index, record] of records.entries()) {
  const path = `records[${index}]`;
  const sourceName = record?.sourceName;
  const role = record?.sourceRole;
  const suffix =
    typeof sourceName === 'string'
      ? sourceName.match(/ \((member|contributor|supporter)\)$/)?.[1]
      : null;

  nonEmpty(`${path}.sourceId`, record?.sourceId);
  nonEmpty(`${path}.sourceName`, sourceName);
  nonEmpty(`${path}.displayName`, record?.displayName);
  nonEmpty(`${path}.category`, record?.category);
  nonEmpty(`${path}.subcategory`, record?.subcategory);

  if (sourceIds.has(record?.sourceId)) {
    error(path, 'duplicate sourceId');
  }
  sourceIds.add(record?.sourceId);

  if (!allowedRoles.has(role)) {
    error(`${path}.sourceRole`, `unsupported role: ${String(role)}`);
  }
  if (suffix !== role) {
    error(`${path}.sourceName`, 'role suffix does not match sourceRole');
  }
  if (
    typeof sourceName === 'string' &&
    record?.displayName !==
      sourceName.replace(/ \((member|contributor|supporter)\)$/, '')
  ) {
    error(`${path}.displayName`, 'must remove only the role suffix');
  }

  const expectedSourceId = `cncf/landscape#${record?.category}/${record?.subcategory}/${sourceName}`;
  if (record?.sourceId !== expectedSourceId) {
    error(
      `${path}.sourceId`,
      'must preserve category, subcategory, and source name',
    );
  }

  const included = record?.included === true;
  if (included) includedCount += 1;
  if (role === 'member') {
    if (record?.category !== LANDSCAPE_CATEGORY || record?.enduser !== true) {
      error(path, 'member records require the enduser flag');
    }
    if (!included || record?.classificationReason !== 'selected-member') {
      error(path, 'member records must be selected');
    }
  } else if (role === 'contributor') {
    if (
      record?.subcategory !== END_USER_SUPPORTER_SUBCATEGORY ||
      !included ||
      record?.classificationReason !== 'selected-contributor'
    ) {
      error(
        path,
        'contributor records must be selected from the authoritative subcategory',
      );
    }
  } else if (
    included ||
    record?.classificationReason !== 'legacy-supporter-audit-only'
  ) {
    error(path, 'supporter records must be audit-only');
  }

  checkUrl(`${path}.homepageUrl`, record?.homepageUrl);
  if (record?.joined !== null && record?.joined !== undefined) {
    if (
      typeof record.joined !== 'string' ||
      Number.isNaN(Date.parse(record.joined))
    ) {
      error(`${path}.joined`, 'must be null or a parseable date');
    }
  }

  const needsAsset =
    included && typeof record?.logoFilename === 'string' && record.logoFilename;
  if (
    typeof record?.logoFilename === 'string' &&
    (record.logoFilename.includes('/') ||
      record.logoFilename.includes('..') ||
      !allowedImageExtensions.has(
        record.logoFilename
          .slice(record.logoFilename.lastIndexOf('.'))
          .toLowerCase(),
      ))
  ) {
    error(`${path}.logoFilename`, 'must be a safe supported image filename');
  }
  const logoUnavailable = needsAsset && !record?.localLogo;
  localAsset(`${path}.localLogo`, record?.localLogo);
  if (
    logoUnavailable &&
    (typeof record?.logoWarning !== 'string' || !record.logoWarning.trim())
  ) {
    error(
      `${path}.logoWarning`,
      'is required when an included logo is unavailable',
    );
  }
}

if (includedCount === 0)
  error('records', 'must include at least one selected record');

reportAndExit(errors, 'end-user landscape');
console.log(`Validated ${records.length} landscape records`);
