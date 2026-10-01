import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

export const LANDSCAPE_ASSET_PREFIX = '/img/end-user-members/';

function isSafeAssetPath(value) {
  return (
    typeof value === 'string' &&
    value.startsWith(LANDSCAPE_ASSET_PREFIX) &&
    !value.slice(LANDSCAPE_ASSET_PREFIX.length).includes('/') &&
    !value.includes('..')
  );
}

function refsFromSnapshot(snapshot) {
  return (snapshot?.records || [])
    .filter((record) => record.included && record.localLogo)
    .map((record) => record.localLogo);
}

function refsFromMembers(members) {
  return (members || []).flatMap((member) =>
    (member.membershipSources || [])
      .map((source) => source.localLogo)
      .filter(Boolean),
  );
}

export function currentLandscapeAssetReferences(snapshot, members) {
  return new Set(
    [...refsFromSnapshot(snapshot), ...refsFromMembers(members)].filter(
      isSafeAssetPath,
    ),
  );
}

function manifestValue(assets) {
  return {
    generated: true,
    assets: [...new Set(assets)].sort(),
  };
}

export function readOwnedAssetManifest(manifestPath) {
  if (!existsSync(manifestPath)) return [];
  const data = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (data?.generated !== true || !Array.isArray(data.assets)) {
    throw new Error('end-user asset manifest is invalid');
  }
  if (data.assets.some((asset) => !isSafeAssetPath(asset))) {
    throw new Error('end-user asset manifest contains an unsafe path');
  }
  return [...new Set(data.assets)];
}

export function ensureOwnedAssetManifest(manifestPath, previousSnapshot) {
  if (existsSync(manifestPath)) return;
  const assets = refsFromSnapshot(previousSnapshot).filter(isSafeAssetPath);
  writeFileSync(
    manifestPath,
    JSON.stringify(manifestValue(assets), null, 2) + '\n',
  );
}

/**
 * Prune only paths recorded as collector-owned, and only after generation has
 * successfully produced the current members output.
 */
export function pruneOwnedLandscapeAssets({
  assetRoot,
  manifestPath,
  snapshot,
  members,
}) {
  const previous = readOwnedAssetManifest(manifestPath);
  const current = currentLandscapeAssetReferences(snapshot, members);
  for (const asset of previous) {
    if (current.has(asset)) continue;
    const target = join(assetRoot, basename(asset));
    const stat = lstatSync(target, { throwIfNoEntry: false });
    if (stat?.isFile() && !stat.isSymbolicLink()) {
      rmSync(target, { force: true });
    }
  }

  const next = manifestValue(current);
  const temp = `${manifestPath}.tmp`;
  writeFileSync(temp, JSON.stringify(next, null, 2) + '\n');
  renameSync(temp, manifestPath);
}
