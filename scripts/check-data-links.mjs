#!/usr/bin/env node

// Resolves every outbound URL the site renders from data/ and fails when one
// has rotted. Companion to `npm run check:links`, which covers Markdown; the
// two run together as `check:links` from .github/workflows/check-links.yml,
// weekly and on demand, never on the pull_request lane (see that workflow's
// header for why a third party's uptime is kept away from contributor PRs).
//
// Verdicts, from scripts/lib/data-links.mjs: `ok`, `broken` (404, 410, DNS or
// connection failure: exit 1) and `unverifiable` (bot blocks, rate limits,
// 5xx, timeouts: listed, exit 0). A URL in KNOWN_BROKEN_URLS is reported as
// `known` and does not fail the run; once it resolves again the run fails
// until the entry is removed, so the allow-list cannot outlive its reason.

import { readFileSync } from 'node:fs';

import {
  KNOWN_BROKEN_URLS,
  RENDERED_DATA_FILES,
  checkUrl,
  collectUrls,
  mapWithConcurrency,
} from './lib/data-links.mjs';

const documents = Object.fromEntries(
  RENDERED_DATA_FILES.map((file) => [
    file,
    JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')),
  ]),
);

const urls = collectUrls(documents);
const results = await mapWithConcurrency([...urls.keys()], 8, (url) =>
  checkUrl(url),
);

const byVerdict = {
  ok: [],
  broken: [],
  unverifiable: [],
  known: [],
  stale: [],
};
for (const result of results) {
  const reason = KNOWN_BROKEN_URLS.get(result.url);
  if (reason === undefined) {
    byVerdict[result.verdict].push(result);
  } else if (result.verdict === 'ok') {
    byVerdict.stale.push({ ...result, detail: `${result.detail}; ${reason}` });
  } else {
    byVerdict.known.push({ ...result, detail: `${result.detail}; ${reason}` });
  }
}

for (const verdict of ['unverifiable', 'known', 'broken', 'stale']) {
  for (const { url, detail } of byVerdict[verdict]) {
    console.log(`${verdict}: ${url} (${detail})`);
    for (const location of urls.get(url)) console.log(`    at ${location}`);
  }
}

console.log(
  `check-data-links: ${urls.size} URL(s) in ${RENDERED_DATA_FILES.length} ` +
    `file(s): ${byVerdict.ok.length} ok, ${byVerdict.unverifiable.length} ` +
    `unverifiable, ${byVerdict.known.length} known, ` +
    `${byVerdict.broken.length} broken, ${byVerdict.stale.length} stale ` +
    'allow-list entries',
);

if (byVerdict.stale.length > 0) {
  console.error(
    'check-data-links: an allow-listed URL resolves again; remove it from ' +
      'KNOWN_BROKEN_URLS in scripts/lib/data-links.mjs',
  );
}
if (byVerdict.broken.length > 0 || byVerdict.stale.length > 0) process.exit(1);
