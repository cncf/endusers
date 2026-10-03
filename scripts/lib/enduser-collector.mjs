import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, sep } from 'node:path';
import {
  findActiveContent,
  findRemoteReferences,
  hasDoctype,
  stripActiveContent,
  stripDoctype,
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

function logoDestination(content, filename) {
  const digest = createHash('sha256')
    .update(content)
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

function containedPath(path, root) {
  return path.startsWith(`${root}${sep}`);
}

export function assertLandscapeSnapshotReady(snapshot) {
  if (snapshot?.generated !== true) {
    throw new Error('landscape snapshot is not marked generated');
  }
  if (
    typeof snapshot?.source?.revision !== 'string' ||
    !/^[0-9a-f]{40}$/.test(snapshot.source.revision) ||
    snapshot.source.sourceUrl !==
      `https://github.com/cncf/landscape/blob/${snapshot.source.revision}/landscape.yml`
  ) {
    throw new Error('landscape snapshot source provenance is incomplete');
  }
  const records = Array.isArray(snapshot.records) ? snapshot.records : [];
  const included = records.filter((record) => record.included);
  if (included.length === 0) {
    throw new Error(
      'landscape snapshot contains no current Member/Contributor records',
    );
  }
  const sourceIds = new Set();
  for (const record of records) {
    if (sourceIds.has(record.sourceId)) {
      throw new Error(`duplicate landscape sourceId: ${record.sourceId}`);
    }
    sourceIds.add(record.sourceId);
    if (
      record.included &&
      !['member', 'contributor'].includes(record.sourceRole)
    ) {
      throw new Error(
        `included landscape record has an invalid current role: ${record.sourceId}`,
      );
    }
    if (
      record.included &&
      record.logoFilename &&
      !record.localLogo &&
      !record.logoWarning
    ) {
      throw new Error(
        `included landscape record has no logo or logo warning: ${record.sourceId}`,
      );
    }
  }
}

/**
 * Mirrors one landscape logo into a staging directory. Logo failure is
 * explicit and organization-preserving: the record remains in the snapshot
 * and the UI uses its initials fallback.
 */
export function mirrorLandscapeLogo({
  record,
  sourceRoot,
  destinationRoot,
  realpath = realpathSync,
}) {
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

  let source;
  let destinationName;
  try {
    const rootStat = lstatSync(sourceRoot, { throwIfNoEntry: false });
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
      return warning(record, 'landscape checkout root is not a real directory');
    }
    const realRoot = realpath(sourceRoot);
    const logoRoot = join(sourceRoot, 'hosted_logos');
    const logoRootStat = lstatSync(logoRoot, { throwIfNoEntry: false });
    if (!logoRootStat?.isDirectory() || logoRootStat.isSymbolicLink()) {
      return warning(record, 'landscape hosted_logos is not a real directory');
    }
    const candidate = join(logoRoot, filename);
    const candidateStat = lstatSync(candidate, { throwIfNoEntry: false });
    if (!candidateStat || candidateStat.isSymbolicLink()) {
      return warning(
        record,
        `landscape logo is a symlink or is missing: ${filename}`,
      );
    }
    if (!candidateStat.isFile()) {
      return warning(
        record,
        `landscape logo is not a regular file: ${filename}`,
      );
    }
    source = realpath(candidate);
    if (!containedPath(source, realRoot)) {
      return warning(
        record,
        `landscape logo resolves outside the checkout: ${filename}`,
      );
    }
  } catch (error) {
    return warning(
      record,
      `could not inspect landscape logo ${filename}: ${error.message}`,
    );
  }

  try {
    let content;
    if (extension === '.svg') {
      const original = readFileSync(source, 'utf8');
      const stripped = stripActiveContent(original);
      const cleaned = stripDoctype(stripped.source)
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .join('\n')
        .replace(/\s+$/, '');
      // stripActiveContent() verifies the string it returns, but the DOCTYPE
      // removal and trimming above delete text, which can join two inert
      // fragments into a live one ("<sc" + "ript>"). Verify the bytes that are
      // actually written rather than the ones that were checked earlier.
      // hasDoctype() covers stripDoctype()'s documented failure mode: a
      // malformed declaration is left in place instead of guessed at, and an
      // unstripped external DTD reference is inert to the two scans below, so
      // without this gate it would be published as cleaned.
      if (hasDoctype(cleaned)) {
        return warning(
          record,
          `landscape logo contains a DOCTYPE that could not be removed: ${filename}`,
        );
      }
      const residual = findActiveContent(cleaned);
      if (residual.length > 0) {
        return warning(
          record,
          `landscape logo still contains active content after cleanup: ${filename} (${residual.join('; ')})`,
        );
      }
      if (findRemoteReferences(cleaned).length > 0) {
        return warning(
          record,
          `landscape logo contains remote resource references: ${filename}`,
        );
      }
      content = Buffer.from(cleaned, 'utf8');
    } else {
      content = readFileSync(source);
    }

    destinationName = logoDestination(content, filename);
    const destination = join(destinationRoot, destinationName);
    mkdirSync(destinationRoot, { recursive: true });
    const existing = lstatSync(destination, { throwIfNoEntry: false });
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
      return warning(
        record,
        `landscape logo destination is not a regular file: ${destinationName}`,
      );
    }
    if (!existing || !Buffer.from(readFileSync(destination)).equals(content)) {
      writeFileSync(destination, content);
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
  const snapshot = {
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
  assertLandscapeSnapshotReady(snapshot);
  return snapshot;
}

/**
 * Publishes a validated snapshot and staged assets transactionally. Existing
 * output and owned assets remain intact if any rename fails.
 */
export function publishLandscapeSnapshot({
  snapshot,
  stagedAssets,
  outputTempPath,
  outputPath,
  assetDestination,
}) {
  assertLandscapeSnapshotReady(snapshot);
  mkdirSync(assetDestination, { recursive: true });
  const outputBackup = `${outputPath}.backup-${process.pid}-${Date.now()}`;
  const movedAssets = [];
  let outputBackedUp = false;

  try {
    if (existsSync(outputPath)) {
      copyFileSync(outputPath, outputBackup);
      outputBackedUp = true;
    }

    if (existsSync(stagedAssets)) {
      for (const entry of readdirSync(stagedAssets, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw new Error(`staged asset is not a regular file: ${entry.name}`);
        }
        const source = join(stagedAssets, entry.name);
        const destination = join(assetDestination, entry.name);
        const existing = lstatSync(destination, { throwIfNoEntry: false });
        if (existing?.isSymbolicLink()) {
          throw new Error(
            `owned asset destination is a symlink: ${entry.name}`,
          );
        }
        if (existing) {
          if (!existing.isFile()) {
            throw new Error(
              `owned asset destination is not a regular file: ${entry.name}`,
            );
          }
          if (
            !Buffer.from(readFileSync(source)).equals(
              Buffer.from(readFileSync(destination)),
            )
          ) {
            throw new Error(
              `owned asset destination bytes differ: ${entry.name}`,
            );
          }
          continue;
        }
        renameSync(source, destination);
        movedAssets.push(destination);
      }
    }

    renameSync(outputTempPath, outputPath);
  } catch (error) {
    if (outputBackedUp && existsSync(outputBackup)) {
      copyFileSync(outputBackup, outputPath);
      rmSync(outputBackup, { force: true });
    }
    for (const path of movedAssets.reverse()) {
      rmSync(path, { force: true });
    }
    throw error;
  }

  if (outputBackedUp) rmSync(outputBackup, { force: true });
}
