#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildLandscapeSnapshot } from './lib/enduser-collector.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(root, '.enduser-landscape-'));
const landscapeRoot = join(work, 'landscape');
const stagedAssets = join(work, 'end-user-members');
const output = join(root, 'data/enduser-landscape.json');
const outputTemp = `${output}.tmp`;
const assetDestination = join(root, 'static/img/end-user-members');

try {
  execFileSync(
    'git',
    [
      'clone',
      '--depth',
      '1',
      'https://github.com/cncf/landscape.git',
      landscapeRoot,
    ],
    { stdio: 'inherit' },
  );
  const revision = execFileSync(
    'git',
    ['-C', landscapeRoot, 'rev-parse', 'HEAD'],
    { encoding: 'utf8' },
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error(
      `landscape clone returned an invalid revision: ${revision}`,
    );
  }

  const document = parse(
    readFileSync(join(landscapeRoot, 'landscape.yml'), 'utf8'),
  );
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
  rmSync(assetDestination, { recursive: true, force: true });
  mkdirSync(dirname(assetDestination), { recursive: true });
  renameSync(stagedAssets, assetDestination);
  renameSync(outputTemp, output);

  const included = snapshot.records.filter((record) => record.included).length;
  console.log(
    `Collected ${included} selected End User Member/Contributor records from ${revision}.`,
  );
} finally {
  rmSync(outputTemp, { force: true });
  rmSync(work, { recursive: true, force: true });
}
