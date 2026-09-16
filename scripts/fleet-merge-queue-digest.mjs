#!/usr/bin/env node
// Builds a weekly cross-repo merge-queue digest for the hive fleet (issue #81).
//
// The hive App can only see one repo's PR queue at a time, so mergeable PRs
// pile up per-repo with no fleet-wide view for the human merge gate to
// triage by value. This script queries each fleet repo's open PRs (public
// data) and produces a markdown digest: per-repo open/mergeable/conflicting
// counts, oldest-PR age, days-since-last-push, and a security-first
// ordering of open PRs across the fleet.
//
// Usage: node scripts/fleet-merge-queue-digest.mjs
//
// `gh pr list --json` goes through the GraphQL API, which (unlike the plain
// REST API) rejects fully unauthenticated requests even for public repos --
// so the cross-repo reads below do need *some* token. What they must NOT
// use is the caller's own single-repo GITHUB_TOKEN, which isn't guaranteed
// to have cross-repo read access to the rest of the fleet and shouldn't be
// conflated with whatever credential is used to post the digest comment.
// FLEET_READ_TOKEN lets the caller supply a token scoped for reading the
// fleet (e.g. a fine-grained PAT with public-repo read access) separately
// from GH_TOKEN/GITHUB_TOKEN, which stays reserved for the caller's own
// follow-up (posting the digest). If FLEET_READ_TOKEN isn't set, this falls
// back to GH_TOKEN/GITHUB_TOKEN so existing single-token setups keep working.

import { execFileSync } from 'node:child_process';

const FLEET_REPOS = [
  'cncf/endusers',
  'castrojo/peoplehub',
  'castrojo/bootc-ecosystem',
  'castrojo/firehose',
  'castrojo/cncf-darkmode',
];

// Ordered from highest to lowest triage priority, per GOVERNANCE.md
// (security > bugfix > feature > deps > other).
const CLASS_ORDER = ['security', 'bugfix', 'feature', 'deps', 'other'];

// Env for the read-only, cross-repo `gh` calls: prefers a dedicated
// FLEET_READ_TOKEN over the ambient GH_TOKEN/GITHUB_TOKEN, so a caller can
// supply credentials actually authorized for cross-repo reads without
// changing what token is used to post the resulting comment (see module
// comment above).
function readEnv() {
  const token =
    process.env.FLEET_READ_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN;
  const env = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  if (token) env.GH_TOKEN = token;
  return env;
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', env: readEnv() });
}

// Escapes Markdown special characters and neutralizes @mentions in
// untrusted, PR-author-controlled text (titles) before it's embedded in a
// digest comment that will be posted publicly -- otherwise a crafted PR
// title could break table formatting or ping arbitrary GitHub users/teams.
function sanitizeMarkdown(text) {
  return String(text)
    .replace(/[\\`*_{}[\]()#+\-.!|>~]/g, '\\$&')
    .replace(/@/g, '@\u200b');
}

// Classifies a PR's triage priority using structured signals (labels, the
// PR author, and body content referencing an advisory) rather than title
// text alone, since a title like "fix: bump lodash" would otherwise be
// misclassified as a plain bugfix even when it's actually a Dependabot
// security-advisory fix. Falls back to the title heuristic only when none
// of the structured signals apply.
function classify({ title, labels = [], author, body = '' }) {
  const labelNames = labels.map((l) =>
    (typeof l === 'string' ? l : l.name).toLowerCase(),
  );
  if (labelNames.some((l) => /security|vulnerab|cve/.test(l)))
    return 'security';

  const isDependabot =
    author?.login === 'dependabot[bot]' || author === 'dependabot[bot]';
  const referencesAdvisory =
    /\bGHSA-|\bCVE-\d{4}-\d+|security vulnerability|dependabot alert/i.test(
      body,
    );
  if (isDependabot && referencesAdvisory) return 'security';

  if (labelNames.some((l) => /\bfix\b|bug/.test(l))) return 'bugfix';
  if (labelNames.some((l) => /\bfeature\b|enhancement/.test(l)))
    return 'feature';
  if (isDependabot || labelNames.some((l) => /\bdependencies\b/.test(l)))
    return 'deps';

  const t = title.toLowerCase();
  if (/\bsec(urity)?\b|\bcve-|vulnerab|checksum|sha-?256/.test(t))
    return 'security';
  if (/^fix|bugfix|\bfix:|\bfix\(/.test(t)) return 'bugfix';
  if (/^feat|\bfeat:|\bfeat\(/.test(t)) return 'feature';
  if (/depend|\bbump\b|\bdeps?\b/.test(t)) return 'deps';
  return 'other';
}

function daysSince(dateStr) {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function fetchRepoQueue(repo) {
  const repoInfo = JSON.parse(
    gh(['api', `repos/${repo}`, '--jq', '{pushed_at: .pushed_at}']),
  );
  const prsRaw = gh([
    'pr',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--limit',
    '200',
    '--json',
    'number,title,createdAt,mergeable,isDraft,url,labels,author,body',
  ]);
  const prs = JSON.parse(prsRaw);

  const open = prs.filter((pr) => !pr.isDraft);
  const mergeable = open.filter((pr) => pr.mergeable === 'MERGEABLE');
  const conflicting = open.filter((pr) => pr.mergeable === 'CONFLICTING');
  const oldest = open.reduce(
    (acc, pr) => (!acc || pr.createdAt < acc.createdAt ? pr : acc),
    null,
  );

  return {
    repo,
    pushedAt: repoInfo.pushed_at,
    daysSincePush: daysSince(repoInfo.pushed_at),
    open,
    mergeable,
    conflicting,
    oldestAgeDays: oldest ? daysSince(oldest.createdAt) : null,
    prs: open.map((pr) => ({ ...pr, repo, class: classify(pr) })),
  };
}

function buildDigest(queues) {
  const lines = [];
  lines.push('## Fleet-wide merge-queue digest');
  lines.push('');
  lines.push(
    `Cross-repo view for the ${queues.length} repos in the hive fleet (issue #81) — ` +
      "no need to open each repo's PR tab separately.",
  );
  lines.push('');
  lines.push(
    '| Repo | Open | Mergeable | Conflicting | Oldest PR | Days since last push |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const q of queues.sort(
    (a, b) => b.mergeable.length - a.mergeable.length,
  )) {
    const stale = q.daysSincePush >= 30 ? ` (stale)` : '';
    lines.push(
      `| ${q.repo} | ${q.open.length} | ${q.mergeable.length} | ${q.conflicting.length} | ` +
        `${q.oldestAgeDays === null ? '-' : `${q.oldestAgeDays}d`} | ${q.daysSincePush}d${stale} |`,
    );
  }

  const totalOpen = queues.reduce((n, q) => n + q.open.length, 0);
  const totalMergeable = queues.reduce((n, q) => n + q.mergeable.length, 0);
  const totalConflicting = queues.reduce((n, q) => n + q.conflicting.length, 0);
  lines.push('');
  lines.push(
    `**Fleet totals**: ${totalOpen} open, ${totalMergeable} mergeable, ${totalConflicting} conflicting.`,
  );

  const dormant = queues.filter(
    (q) => q.daysSincePush >= 30 && q.mergeable.length > 0,
  );
  if (dormant.length > 0) {
    lines.push('');
    lines.push(
      '**Dormant repos with mergeable PRs queued** (default branch has not moved in 30+ days):',
    );
    for (const q of dormant) {
      lines.push(
        `- ${q.repo}: ${q.mergeable.length} mergeable, last push ${q.daysSincePush}d ago`,
      );
    }
  }

  lines.push('');
  lines.push('### Mergeable PRs, security-first');
  const allMergeable = queues.flatMap((q) =>
    q.prs.filter((pr) => pr.mergeable === 'MERGEABLE'),
  );
  for (const cls of CLASS_ORDER) {
    const inClass = allMergeable
      .filter((pr) => pr.class === cls)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (inClass.length === 0) continue;
    lines.push('');
    lines.push(`**${cls}** (${inClass.length})`);
    for (const pr of inClass) {
      lines.push(
        `- [${pr.repo}#${pr.number}](${pr.url}) ${sanitizeMarkdown(pr.title)} (${daysSince(pr.createdAt)}d old)`,
      );
    }
  }

  return lines.join('\n');
}

async function main() {
  const queues = FLEET_REPOS.map(fetchRepoQueue);
  const digest = buildDigest(queues);
  process.stdout.write(digest + '\n');
}

// Only run when executed directly (`node scripts/fleet-merge-queue-digest.mjs`),
// not when imported by tests -- classify()/sanitizeMarkdown() are pure and
// unit-testable without triggering the network-calling main().
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export { classify, sanitizeMarkdown };
