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
// LAUNCH.md is an undated readiness checklist. The committed baseline was
// captured at its "success-metrics baseline" milestone; the checkpoint label
// and targetDate below are retained verbatim because tests and the committed
// data pin them, and because they name the checkpoint the capture was taken
// under at the time. Re-run this script immediately before launch and record
// capturedAt so the 90-day comparison starts from the announcement-day numbers.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  githubAllPages,
  githubFetch,
  makeGitHubHeaders,
} from './lib/github.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
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
  const headers = makeGitHubHeaders(token, USER_AGENT);
  const [repo, contributors, goodFirstIssues] = await Promise.all([
    githubFetch(`https://api.github.com/repos/${REPO}`, token, USER_AGENT),
    githubAllPages(
      `https://api.github.com/repos/${REPO}/contributors?per_page=100&anon=false`,
      headers,
    ),
    githubAllPages(
      `https://api.github.com/repos/${REPO}/issues?state=all&labels=good+first+issue&per_page=100`,
      headers,
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

main();
