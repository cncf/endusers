#!/usr/bin/env node
// Resolves the outbound URLs that the member directory renders from
// data/members.json, so link rot in generated data is caught by the same
// weekly lane that catches it in markdown.
//
// Run via: npm run check:links (the "Check links" workflow already invokes
// it; see .github/workflows/check-links.yml). It is deliberately absent from
// ci.yml for the reason recorded in that workflow: resolving third-party URLs
// on a pull request would fail unrelated changes during someone else's
// outage.
//
// Exits non-zero when a URL is gone (DNS name missing, 404 or 410), or when
// every probe was inconclusive and the run therefore verified nothing.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyProbe,
  collectRenderedMemberLinks,
  formatFinding,
  resolveVerdicts,
} from './lib/data-links.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const TIMEOUT_MS = 20000;
const CONCURRENCY = 8;
const ATTEMPTS = 3;
// Backoff between attempts. Overridable so the tests can exercise the retry
// path without spending the production delay on every simulated failure.
const RETRY_BASE_MS = Number(process.env.ENDUSERS_LINK_RETRY_MS || 1000);

// Matches the User-Agent markdown-link-check sends. Several of these hosts
// serve a bare automated client a block page but answer a browser-shaped
// request normally, and an identifiable agent is the polite way to ask.
const USER_AGENT =
  'Mozilla/5.0 (compatible; cncf-endusers-link-check/1.0; +https://endusers.cncf.io)';

/**
 * Probe one URL, retrying transport failures.
 *
 * HEAD first (cheap, and enough for a liveness question), falling back to GET
 * for the hosts that reject HEAD outright with 405.
 */
async function probe(url) {
  let last = { status: null, errorCode: null };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    for (const method of ['HEAD', 'GET']) {
      try {
        const response = await fetch(url, {
          method,
          redirect: 'follow',
          headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (method === 'HEAD' && response.status === 405) continue;
        return { status: response.status, errorCode: null };
      } catch (error) {
        // fetch() wraps the transport failure; the cause carries the code
        // that distinguishes a missing name from a transient failure. A
        // failure raised without one (an abort, a thrown non-network error)
        // is reported under its own name instead.
        const code = error?.cause?.code;
        last = { status: null, errorCode: code || error?.name };
      }
    }
    if (attempt < ATTEMPTS) {
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BASE_MS * attempt),
      );
    }
  }
  return last;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await worker(items[index]);
      }
    })(),
  );
  await Promise.all(runners);
  return results;
}

const membersData = JSON.parse(
  readFileSync(join(root, 'data/members.json'), 'utf8'),
);
const links = collectRenderedMemberLinks(membersData);
const entries = [...links];

if (entries.length === 0) {
  console.error(
    'No outbound member links were collected from data/members.json; the ' +
      'collection rules in scripts/lib/data-links.mjs no longer match the data.',
  );
  process.exit(1);
}

const probes = await mapWithConcurrency(entries, CONCURRENCY, ([url]) =>
  probe(url),
);

const dead = [];
const inconclusive = [];
const verdicts = resolveVerdicts(
  probes.map((probe) => ({ verdict: classifyProbe(probe), probe })),
);
entries.forEach(([url, citations], index) => {
  const result = probes[index];
  const verdict = verdicts[index];
  if (verdict === 'dead')
    dead.push(formatFinding(verdict, url, citations, result));
  else if (verdict === 'inconclusive')
    inconclusive.push(formatFinding(verdict, url, citations, result));
});

for (const line of inconclusive) console.warn(line);
for (const line of dead) console.error(line);

// A run where nothing could be resolved has verified nothing; reporting a
// clean result would be worse than failing. Same reasoning as the all-
// inconclusive guard in scripts/check-community-group-links.mjs.
if (inconclusive.length === entries.length) {
  console.error(
    `All ${entries.length} member link probes were inconclusive; the run ` +
      'verified nothing.',
  );
  process.exit(1);
}

console.log(
  `Checked ${entries.length} outbound member links from data/members.json ` +
    `(${dead.length} dead, ${inconclusive.length} unverified)`,
);

if (dead.length > 0) process.exit(1);
