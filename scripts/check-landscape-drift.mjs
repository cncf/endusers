#!/usr/bin/env node
// Reports whether data/enduser-landscape.json still describes the end user
// organisations cncf/landscape selects today.
//
// Run via: npm run check:landscape-drift
//
// The pinned snapshot is the input `npm run generate:members` turns into the
// member directory at /community/members/, and it only moves when someone runs
// the on-demand "Refresh metrics" workflow. Nothing else notices when it falls
// behind: every validator asks whether the committed file is well-formed and
// self-consistent, which it stays no matter how old it is, so an organisation
// CNCF has since listed as an end user member is simply absent from the
// directory until the next manual refresh.
//
// Exits non-zero when upstream and the snapshot disagree, naming each
// organisation, so the answer is a refresh instruction rather than a diff to
// read. Resolving upstream needs the network, which is why this is not a
// pull-request gate.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLandscapeDocument } from './lib/enduser-landscape.mjs';
import { readLandscape } from './lib/landscape-source.mjs';
import {
  diffLandscapeSelection,
  formatDrift,
  hasDrift,
} from './lib/landscape-drift.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(root, '.landscape-drift-'));

let drift;
let revision;
try {
  const snapshot = JSON.parse(
    readFileSync(join(root, 'data/enduser-landscape.json'), 'utf8'),
  );
  const upstream = readLandscape(join(work, 'landscape'));
  revision = upstream.revision;
  const fresh = classifyLandscapeDocument(upstream.document);
  drift = diffLandscapeSelection(snapshot.records, fresh.records);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (!hasDrift(drift)) {
  console.log(
    `data/enduser-landscape.json still matches cncf/landscape at ${revision}.`,
  );
  process.exit(0);
}

for (const line of formatDrift(drift)) console.error(line);
console.error(
  `data/enduser-landscape.json no longer matches cncf/landscape at ${revision}. ` +
    'Run the "Refresh metrics" workflow, or `npm run collect:enduser-members && ' +
    'npm run generate:members && npm run fix:format` locally, to bring the ' +
    'member directory back in step with upstream.',
);
process.exit(1);
