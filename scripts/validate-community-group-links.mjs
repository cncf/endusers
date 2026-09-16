#!/usr/bin/env node
// Verifies each End User Group / working group listed in
// data/community-groups.json still has a reachable upstream GitHub repo
// (issue #79 acceptance criteria: "verify each listed End User Group still
// has an active upstream page"). This does a live network call, so — like
// collect-metrics.mjs, fetch-community-people.mjs, and
// import-architectures.mjs — it is intentionally excluded from the offline
// validator smoke test (tests/validators-smoke.test.mjs) and is meant to be
// run manually or from a CI job with network access.
import { readFileSync } from 'node:fs';
import { reportAndExit } from './lib/validate-utils.mjs';

const { groups } = JSON.parse(
  readFileSync(new URL('../data/community-groups.json', import.meta.url)),
);

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'cncf-endusers-site-build',
};
if (process.env.GH_TOKEN) headers.Authorization = `token ${process.env.GH_TOKEN}`;

const errors = [];

for (const { slug, name, repo } of groups) {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, { headers });
    if (response.status === 404) {
      errors.push({
        path: slug,
        severity: 'error',
        message: `${name}'s upstream repo ${repo} no longer exists (404) — update docs/community/${slug}.md and data/community-groups.json`,
      });
    } else if (!response.ok) {
      errors.push({
        path: slug,
        severity: 'error',
        message: `${name}'s upstream repo ${repo} returned ${response.status}`,
      });
    } else {
      const body = await response.json();
      if (body.archived) {
        errors.push({
          path: slug,
          severity: 'warn',
          message: `${name}'s upstream repo ${repo} is archived — the page is still reachable but the group may be inactive; consider updating docs/community/${slug}.md`,
        });
      }
    }
  } catch (error) {
    errors.push({
      path: slug,
      severity: 'error',
      message: `Could not verify ${name}'s upstream repo ${repo}: ${error.message}`,
    });
  }
}

reportAndExit(errors, 'community group links');
console.log(`Validated ${groups.length} community group upstream links`);
