#!/usr/bin/env node
// Flags open PRs that have been conflicting with the base branch for more
// than 48 hours, per GOVERNANCE.md merge-queue hygiene (issue #58).
//
// This fetches mergeability per-PR (`GET /repos/{owner}/{repo}/pulls/{n}`)
// rather than relying on the list endpoint's `mergeable` field, which
// GitHub computes asynchronously and frequently returns as `UNKNOWN` on
// list responses -- silently letting conflicting PRs slip past a check
// gated on that value (see issue #217). Two related bugs are fixed here
// too:
//
// 1. Pagination: `gh pr list` defaults to --limit 30, which silently drops
//    PRs once the fleet queue passes 30 open PRs. This paginates through
//    every open PR instead of relying on a single bounded call.
// 2. Conflict age: `updatedAt` is *any* update to the PR (a new commit, a
//    label, a comment) -- it does not measure how long the PR has actually
//    been conflicting with the base branch. Instead, this persists a
//    first-conflict-observed marker as an HTML comment on the PR itself
//    (the only durable, per-PR storage a stateless scheduled job has
//    available) the first time a PR is seen as conflicting, and only flags
//    it once 48 hours have elapsed since *that* timestamp -- not since the
//    PR's last unrelated update.
//
// Usage: node scripts/pr-queue-hygiene.mjs
// Requires `gh` authenticated with `pull-requests: write` on this repo (as
// the workflow already grants). Set DRY_RUN=1 to log intended actions
// without labeling/commenting.

import { execFileSync } from 'node:child_process';

const REPO = process.env.REPO || process.env.GITHUB_REPOSITORY;
const DRY_RUN = process.env.DRY_RUN === '1';
const STALE_HOURS = 48;
const LABEL = 'needs-rebase-or-close';
export const MARKER_PREFIX = '<!-- pr-queue-hygiene:first-conflict-observed:';
const MARKER_RE = /<!-- pr-queue-hygiene:first-conflict-observed:(.+?) -->/;

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

// Fetches every open PR, paginating past gh's default --limit 30 so a
// queue deeper than one page isn't silently truncated.
export function fetchAllOpenPRs(repo) {
  const prs = [];
  let page = 1;
  const perPage = 100;
  for (;;) {
    const raw = gh([
      'api',
      `repos/${repo}/pulls?state=open&per_page=${perPage}&page=${page}`,
    ]);
    const batch = JSON.parse(raw);
    prs.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return prs;
}

// Extracts the first-conflict-observed timestamp (if any) from a PR's
// issue comments, by finding this script's own hidden marker comment.
export function findFirstConflictObservedAt(comments) {
  for (const comment of comments) {
    const match = MARKER_RE.exec(comment.body || '');
    if (match) return match[1];
  }
  return null;
}

export function hoursSince(isoString, now = Date.now()) {
  return (now - Date.parse(isoString)) / (1000 * 60 * 60);
}

function labelNames(pr) {
  return (pr.labels || []).map((l) => l.name);
}

// Re-fetches a single PR's mergeability via the single-PR endpoint, which
// forces GitHub to compute a fresh value instead of returning the async,
// often-`UNKNOWN` field on the list endpoint.
export function isConflicting(repo, number, fetchDetail = defaultFetchDetail) {
  const detail = fetchDetail(repo, number);
  return detail.mergeable === false || detail.mergeable_state === 'dirty';
}

function defaultFetchDetail(repo, number) {
  return JSON.parse(
    gh([
      'api',
      `repos/${repo}/pulls/${number}`,
      '--jq',
      '{mergeable: .mergeable, mergeable_state: .mergeable_state}',
    ]),
  );
}

async function main() {
  if (!REPO) throw new Error('REPO or GITHUB_REPOSITORY must be set');

  const prs = fetchAllOpenPRs(REPO);
  console.log(`Fetched ${prs.length} open PR(s) from ${REPO}`);

  for (const pr of prs) {
    const number = pr.number;
    const conflicting = isConflicting(REPO, number);

    const commentsRaw = gh([
      'api',
      `repos/${REPO}/issues/${number}/comments?per_page=100`,
    ]);
    const comments = JSON.parse(commentsRaw);
    const firstObservedAt = findFirstConflictObservedAt(comments);

    if (!conflicting) {
      continue;
    }

    if (!firstObservedAt) {
      console.log(
        `PR #${number}: newly observed as conflicting, recording marker`,
      );
      if (!DRY_RUN) {
        gh([
          'pr',
          'comment',
          String(number),
          '--repo',
          REPO,
          '--body',
          `${MARKER_PREFIX}${new Date().toISOString()} -->`,
        ]);
      }
      continue;
    }

    const ageHours = hoursSince(firstObservedAt);
    if (ageHours < STALE_HOURS) {
      continue;
    }

    if (labelNames(pr).includes(LABEL)) {
      continue;
    }

    console.log(
      `Flagging stale conflicting PR #${number} (conflicting for ${ageHours.toFixed(1)}h)`,
    );
    if (!DRY_RUN) {
      gh(['pr', 'edit', String(number), '--repo', REPO, '--add-label', LABEL]);
      gh([
        'pr',
        'comment',
        String(number),
        '--repo',
        REPO,
        '--body',
        'This PR has been conflicting with the base branch for more than 48 hours. Per [GOVERNANCE.md](../../blob/main/GOVERNANCE.md) merge-queue hygiene: please rebase, or close this PR if it has been superseded by other merged work. Flagged automatically by the PR queue hygiene workflow.',
      ]);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
