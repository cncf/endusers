#!/usr/bin/env node
// Verifies that each End User Group listed on the community page still has
// an active (non-archived, non-404) upstream GitHub repository, and records
// the result in data/community-groups.json for the freshness UI and
// validate-community-groups.mjs to consume.
//
// Run via: npm run check:community-group-links
// Requires GH_TOKEN (or GITHUB_TOKEN) to avoid the unauthenticated rate limit.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGitHubHeaders } from './lib/github.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'data/community-groups.json');

// Source-of-truth list of End User Groups linked from
// docs/community/user-groups/. Update here when a group is added,
// renamed, or its upstream repository changes.
const GROUPS = [
  {
    slug: 'public-sector',
    name: 'Public Sector User Group',
    repo: 'cncf/public-sector-user-group',
  },
  {
    slug: 'telecom',
    name: 'Telecom User Group',
    repo: 'cncf/telecom-user-group',
  },
];

const headers = makeGitHubHeaders(
  process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
);

// Last-known statuses from the previous report, keyed by slug. A group
// whose recheck comes back inconclusive (reachable === null) inherits
// these instead of writing nulls: both consumers (GroupLinkStatus and
// validate-community-groups.mjs) read null as healthy, so writing nulls
// over a known-archived or known-missing entry would let a transient
// network error silently dismiss the staleness banner.
const previousBySlug = new Map();
try {
  const report = JSON.parse(readFileSync(output, 'utf8'));
  for (const group of report.groups || []) {
    if (group && typeof group.slug === 'string') {
      previousBySlug.set(group.slug, group);
    }
  }
} catch {
  // No usable previous report (first run, missing or unparsable file):
  // nothing to carry forward.
}

const groups = [];
let staleCount = 0;

for (const { slug, name, repo } of GROUPS) {
  const repository = `https://github.com/${repo}`;
  let archived = null;
  let reachable = true;
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers,
    });
    if (response.status === 404) {
      reachable = false;
    } else if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    } else {
      const data = await response.json();
      archived = Boolean(data.archived);
    }
  } catch (error) {
    console.warn(`Could not check ${repo}: ${error.message}`);
    const known = previousBySlug.get(slug);
    archived = known ? (known.archived ?? null) : null;
    reachable = known ? (known.reachable ?? null) : null;
  }
  if (archived || reachable === false) {
    staleCount += 1;
    console.warn(
      `${name} (${repo}) is ${reachable === false ? 'missing/renamed' : 'archived'} upstream.`,
    );
  }
  groups.push({ slug, name, repository, archived, reachable });
}

// A run where every check came back inconclusive (token rejected, network
// down, API outage) has verified nothing: writing the report anyway would
// stamp a fresh checkedAt on stale knowledge, and both the freshness UI and
// validate-community-groups.mjs read that timestamp as a successful
// verification. Refuse to write so the previous report — and its honest,
// aging checkedAt — survives. Partial failure is still recorded.
const inconclusive = groups.filter((group) => group.reachable === null);
if (inconclusive.length === groups.length) {
  console.error(
    `All ${groups.length} End User Group checks were inconclusive; leaving the existing report untouched.`,
  );
  process.exit(1);
}

writeFileSync(
  output,
  JSON.stringify({ checkedAt: new Date().toISOString(), groups }, null, 2) +
    '\n',
);
console.log(
  `Checked ${groups.length} End User Group upstream repositories${staleCount ? ` (${staleCount} need attention)` : ''}`,
);
