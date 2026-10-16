#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLandscapeSnapshot,
  publishLandscapeSnapshot,
} from './lib/enduser-collector.mjs';
import { ensureOwnedAssetManifest } from './lib/enduser-assets.mjs';
import { readLandscape } from './lib/landscape-source.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(root, '.enduser-landscape-'));
const landscapeRoot = join(work, 'landscape');
const stagedAssets = join(work, 'end-user-members');
const output = join(root, 'data/enduser-landscape.json');
const outputTemp = join(work, 'enduser-landscape.json');
const assetDestination = join(root, 'static/img/end-user-members');
const manifestPath = join(root, 'data/enduser-landscape-assets.json');
const previousSnapshot = existsSync(output)
  ? JSON.parse(readFileSync(output, 'utf8'))
  : null;

try {
  const { revision, document } = readLandscape(landscapeRoot);
  const snapshot = buildLandscapeSnapshot({
    document,
    revision,
    collectedAt: new Date().toISOString(),
    sourceRoot: landscapeRoot,
    destinationRoot: stagedAssets,
  });

  for (const record of snapshot.records) {
    if (record.logoWarning) console.warn(`[warn] ${record.logoWarning}`);
  }

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(outputTemp, JSON.stringify(snapshot, null, 2) + '\n');
  publishLandscapeSnapshot({
    snapshot,
    stagedAssets,
    outputTempPath: outputTemp,
    outputPath: output,
    assetDestination,
  });
  ensureOwnedAssetManifest(manifestPath, previousSnapshot);

  const included = snapshot.records.filter((record) => record.included).length;
  console.log(
    `Collected ${included} selected End User Member/Contributor records from ${revision}.`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
