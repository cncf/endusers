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
  loadLogoOverrides,
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
const overridesPath = join(root, 'data/enduser-logo-overrides.json');
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
    publishedRoot: assetDestination,
    overrides: loadLogoOverrides(overridesPath),
  });

  for (const record of snapshot.records) {
    if (record.logoWarning) console.warn(`[warn] ${record.logoWarning}`);
  }

  const included = snapshot.records.filter((record) => record.included).length;
  // Only bump collectedAt and republish when the records themselves changed
  // (ADR 0009). The end user member list is stable for weeks at a time, so
  // republishing on every weekly refresh-metrics.yml run would open a no-op
  // PR each time (#1935). collectedAt and the upstream source revision are
  // this run's envelope: they record when the published data last changed,
  // so they are excluded from the comparison and stay pinned to the run
  // that last changed it.
  const contentOnly = (value) =>
    JSON.stringify(value, (key, field) =>
      key === 'collectedAt' || key === 'source' ? undefined : field,
    );
  if (
    previousSnapshot &&
    contentOnly(previousSnapshot) === contentOnly(snapshot)
  ) {
    console.log(
      'No end user member changes detected; leaving data/enduser-landscape.json untouched.',
    );
  } else {
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

    console.log(
      `Collected ${included} selected End User Member/Contributor records from ${revision}.`,
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
