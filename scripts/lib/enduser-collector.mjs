import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import {
  findRemoteReferences,
  stripActiveContent,
} from './svg-active-content.mjs';
import {
  classifyLandscapeDocument,
  END_USER_SUPPORTER_SUBCATEGORY,
} from './enduser-landscape.mjs';

const MIRRORABLE_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);
const LOCAL_LOGO_PREFIX = '/img/end-user-members/';

function logoDestination(sourceId, filename) {
  const digest = createHash('sha256')
    .update(sourceId)
    .digest('hex')
    .slice(0, 16);
  return `${digest}-${basename(filename)}`;
}

function warning(record, message) {
  return {
    ...record,
    localLogo: null,
    logoWarning: `${record.sourceId}: ${message}`,
  };
}

/**
 * Mirrors one landscape logo into a staging directory. Logo failure is
 * explicit and organization-preserving: the record remains in the snapshot
 * and the UI uses its initials fallback.
 */
export function mirrorLandscapeLogo({ record, sourceRoot, destinationRoot }) {
  if (!record.logoFilename) {
    return { ...record, localLogo: null, logoWarning: null };
  }

  const filename = basename(record.logoFilename);
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (
    filename !== record.logoFilename ||
    filename.includes('..') ||
    !MIRRORABLE_EXTENSIONS.has(extension)
  ) {
    return warning(record, `unsupported or unsafe logo filename: ${filename}`);
  }

  const source = join(sourceRoot, 'hosted_logos', filename);
  if (!existsSync(source) || !statSync(source).isFile()) {
    return warning(record, `landscape logo is missing: ${filename}`);
  }

  const destinationName = logoDestination(record.sourceId, filename);
  const destination = join(destinationRoot, destinationName);

  try {
    mkdirSync(destinationRoot, { recursive: true });
    if (extension === '.svg') {
      const original = readFileSync(source, 'utf8');
      const stripped = stripActiveContent(original);
      const cleaned = stripped.source
        .replace(/<!DOCTYPE\s[^>]*>\s*/gi, '')
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .join('\n')
        .replace(/\s+$/, '');
      if (findRemoteReferences(cleaned).length > 0) {
        return warning(
          record,
          `landscape logo contains remote resource references: ${filename}`,
        );
      }
      writeFileSync(destination, cleaned, 'utf8');
    } else {
      copyFileSync(source, destination);
    }
  } catch (error) {
    return warning(
      record,
      `could not mirror logo ${filename}: ${error.message}`,
    );
  }

  return {
    ...record,
    localLogo: `${LOCAL_LOGO_PREFIX}${destinationName}`,
    logoWarning: null,
  };
}

export function buildLandscapeSnapshot({
  document,
  revision,
  collectedAt,
  sourceRoot,
  destinationRoot,
}) {
  const { records } = classifyLandscapeDocument(document);
  const processed = records.map((record) =>
    record.included
      ? mirrorLandscapeLogo({ record, sourceRoot, destinationRoot })
      : { ...record, localLogo: null, logoWarning: null },
  );
  const sourceUrl = `https://github.com/cncf/landscape/blob/${revision}/landscape.yml`;
  return {
    generated: true,
    collectedAt,
    source: {
      repository: 'https://github.com/cncf/landscape',
      revision,
      file: 'landscape.yml',
      sourceUrl,
    },
    selection: {
      member: 'CNCF Members item.enduser === true and name suffix "(member)"',
      contributor: `CNCF Members / ${END_USER_SUPPORTER_SUBCATEGORY} name suffix "(contributor)"`,
      supporter: 'audit-only',
    },
    records: processed,
  };
}
