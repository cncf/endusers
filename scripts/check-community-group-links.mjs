#!/usr/bin/env node
// Verifies that each End User Group listed on the community page still has
// an active (non-archived, non-404) upstream GitHub repository, and records
// the result in data/community-groups.json for the freshness UI and
// validate-community-groups.mjs to consume.
//
// Run via: npm run check:community-group-links
// Requires GH_TOKEN (or GITHUB_TOKEN) to avoid the unauthenticated rate limit.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeGitHubHeaders } from './lib/github.mjs';

const root = new URL('..', import.meta.url).pathname;
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
    reachable = null;
  }
  if (archived || reachable === false) {
    staleCount += 1;
    console.warn(
      `${name} (${repo}) is ${reachable === false ? 'missing/renamed' : 'archived'} upstream.`,
    );
  }
  groups.push({ slug, name, repository, archived, reachable });
}

writeFileSync(
  output,
  JSON.stringify({ checkedAt: new Date().toISOString(), groups }, null, 2) +
    '\n',
);
console.log(
  `Checked ${groups.length} End User Group upstream repositories${staleCount ? ` (${staleCount} need attention)` : ''}`,
);
