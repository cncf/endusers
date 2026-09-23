#!/usr/bin/env node
// Collects the launch success-metrics baseline defined by issue #100: a small
// set of signals (GitHub stars, watchers, forks, unique human contributors,
// good-first-issue conversion) that turn "launch" into something falsifiable.
//
// The 90-day post-launch targets are policy decisions, not measured data, so
// they live in TARGET_90_DAY below rather than being fetched. Everything else
// is live GitHub API data, refreshed by re-running this script — the same
// generated/never-hand-edited pattern as data/metrics.json.
//
// Per LAUNCH.md, the pre-launch checkpoint that should be treated as the
// final launch baseline lands at W-6 (2026-09-28). Re-run this script at (or
// after) that date and record capturedAt so the baseline reflects the actual
// checkpoint rather than whatever day someone happened to run it.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { githubFetch } from './lib/github.mjs';

const root = new URL('..', import.meta.url).pathname;
const REPO = 'cncf/endusers';
const USER_AGENT = 'cncf-endusers-launch-metrics';

const TARGET_90_DAY = {
  'github-stars': 50,
  'github-watchers': 10,
  'github-forks': 5,
  'new-contributors-since-baseline': 5,
  'good-first-issues-claimed': 3,
};

async function main() {
  const token = process.env.GH_TOKEN;
  const [repo, contributors, goodFirstIssues] = await Promise.all([
    githubFetch(`https://api.github.com/repos/${REPO}`, token, USER_AGENT),
    githubAll(
      `https://api.github.com/repos/${REPO}/contributors?per_page=100&anon=false`,
      token,
    ),
    githubAll(
      `https://api.github.com/repos/${REPO}/issues?state=all&labels=good+first+issue&per_page=100`,
      token,
    ),
  ]);

  const capturedAt = new Date().toISOString();
  // The repository's commit history long predates this launch plan (200+
  // merged PRs from dozens of human contributors already), so a raw
  // cumulative contributor count is never a small number and can never sit
  // below a "5 by launch+90d" target. The falsifiable signal is *new*
  // contributors who show up after this baseline is captured, which is 0 by
  // definition at capture time. priorContributorLogins is the snapshot a
  // future run diffs against to count that delta.
  const humanContributors = contributors.filter(
    (c) => c.type !== 'Bot' && !/\[bot\]$|Bot$/i.test(c.login),
  );
  const claimedGoodFirstIssues = goodFirstIssues.filter(
    (issue) => !issue.pull_request && (issue.assignees || []).length > 0,
  );

  const data = {
    generated: true,
    generatedAt: capturedAt,
    capturedAt,
    checkpoint: {
      label: 'W-6 pre-launch checkpoint (LAUNCH.md)',
      targetDate: '2026-09-28',
      note: 'Re-run npm run collect:launch-metrics on or after targetDate and commit the refreshed file before this baseline is treated as final for the launch retrospective.',
    },
    source: `https://api.github.com/repos/${REPO}`,
    signals: [
      signal(
        'github-stars',
        'GitHub stars',
        repo.stargazers_count,
        `https://github.com/${REPO}/stargazers`,
        capturedAt,
      ),
      signal(
        'github-watchers',
        'GitHub watchers',
        repo.subscribers_count,
        `https://github.com/${REPO}/watchers`,
        capturedAt,
      ),
      signal(
        'github-forks',
        'GitHub forks',
        repo.forks_count,
        `https://github.com/${REPO}/forks`,
        capturedAt,
      ),
      {
        ...signal(
          'new-contributors-since-baseline',
          'New unique human contributors since baseline',
          0,
          `https://github.com/${REPO}/graphs/contributors`,
          capturedAt,
        ),
        note: 'Baseline is 0 by definition (a delta metric). priorContributorLogins is the snapshot of existing human contributor logins at capture time; the 90-day re-measurement counts human contributor logins present then but absent from this list.',
        priorContributorLogins: humanContributors.map((c) => c.login).sort(),
      },
      signal(
        'good-first-issues-claimed',
        'Good-first-issues claimed',
        claimedGoodFirstIssues.length,
        `https://github.com/${REPO}/issues?q=is%3Aissue+label%3A%22good+first+issue%22`,
        capturedAt,
      ),
    ],
  };

  writeFileSync(
    join(root, 'data/launch-metrics.json'),
    JSON.stringify(data, null, 2) + '\n',
  );
  console.log(
    `Collected ${data.signals.length} launch metrics at ${capturedAt}`,
  );
}

function signal(id, label, baseline, sourceUrl, collectedAt) {
  return {
    id,
    label,
    baseline,
    target90Day: TARGET_90_DAY[id],
    sourceUrl,
    collectedAt,
  };
}

async function githubAll(url, token) {
  const origin = new URL(url).origin;
  const results = [];
  let next = url;
  while (next) {
    const response = await fetch(next, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${next}`);
    results.push(...(await response.json()));
    const link = response.headers.get('link') || '';
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    next = match ? sameOriginNext(match[1], origin) : null;
  }
  return results;
}

// The Authorization header travels with every paginated request, so a Link
// header naming a different origin would hand the token to that host. Only
// continue paginating within the origin the first request was sent to.
function sameOriginNext(candidate, origin) {
  let parsed;
  try {
    parsed = new URL(candidate, origin);
  } catch {
    console.warn(`Ignoring unparseable Link rel="next" target: ${candidate}`);
    return null;
  }
  if (parsed.origin !== origin) {
    console.warn(
      `Ignoring cross-origin Link rel="next" target: ${parsed.origin}`,
    );
    return null;
  }
  return parsed.toString();
}

main();
