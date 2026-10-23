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
// 3. Hold safety: PRs carrying `hold`, `on-hold`, or `do-not-merge` are
//    skipped entirely per GOVERNANCE.md agent-automation policy.
// 4. Marker authorship: the marker lives in a comment thread anyone can
//    write to, so it is only honored when this job's own bot identity
//    posted it and the timestamp is parseable and not in the future.
//    Otherwise any commenter could post a far-future marker to exempt a PR
//    from the 48h gate forever, or a backdated one to have this job label
//    and nag somebody else's freshly-conflicting PR.
// 5. Marker clearing: when a PR stops conflicting, its first-conflict
//    marker is neutralized with a trusted "resolved" marker (and the
//    `needs-rebase-or-close` label is removed), so a later reconflict
//    starts a fresh 48h window instead of inheriting the old marker's
//    timestamp and being flagged as stale immediately.
// 6. Comment pagination: issue comments are fetched a page at a time
//    instead of relying on a single `per_page=100` call, so a marker
//    posted early in a PR with a long comment thread is still found.
//
// The same pass also applies the ADR 0008 remit check: an agent-authored PR
// whose description has no `Remit:` line is labelled `needs-human` and told
// once, in a comment, what is missing (see REMIT_LABEL below).
//
// Usage: node scripts/pr-queue-hygiene.mjs
// Requires `gh` authenticated with `pull-requests: write` on this repo (as
// the workflow already grants). When the runner image has no `gh` binary
// (observed on the self-hosted `gpus` fleet, run 39478332070), the script
// falls back to the same REST endpoints through `curl` with
// GH_TOKEN/GITHUB_TOKEN, which every image used here carries.
// Set DRY_RUN=1 to log intended actions
// without labeling/commenting. Set MARKER_AUTHORS to a comma-separated list
// of bot logins when the job comments under an identity other than
// github-actions[bot] (a GitHub App, for example). Set AGENT_AUTHORS to a
// comma-separated list of bot logins whose PRs the remit check applies to
// (default hivecommons-hive[bot]).

import { execFileSync } from 'node:child_process';

const REPO = process.env.REPO || process.env.GITHUB_REPOSITORY;
const DRY_RUN = process.env.DRY_RUN === '1';
export const STALE_HOURS = 48;
export const LABEL = 'needs-rebase-or-close';
export const HOLD_LABELS = new Set(['hold', 'on-hold', 'do-not-merge']);
export const MARKER_PREFIX = '<!-- pr-queue-hygiene:first-conflict-observed:';
const MARKER_RE = /<!-- pr-queue-hygiene:first-conflict-observed:(.+?) -->/;

// Posted once a previously-conflicting PR is observed as no longer
// conflicting, so a later re-conflict starts a fresh 48h window instead of
// inheriting the stale first-conflict marker's timestamp (see
// findFirstConflictObservedAt).
export const RESOLVED_MARKER_PREFIX = '<!-- pr-queue-hygiene:resolved:';
const RESOLVED_MARKER_RE = /<!-- pr-queue-hygiene:resolved:(.+?) -->/;

// Logins whose markers are believed. The marker is this job's state store,
// but it is kept in a comment thread every GitHub user can write to, so an
// unauthenticated marker is an unauthenticated state write.
export const TRUSTED_MARKER_AUTHORS = new Set(
  (process.env.MARKER_AUTHORS || 'github-actions[bot]')
    .split(',')
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean),
);

// Remit check (ADR 0008). An agent-authored PR must say, in a `Remit:` line
// of its description, which effect justifies it: a user-observable defect, a
// security or supply-chain exposure, a required check failing, a data or
// dependency refresh, or maintainer-filed work. The job does not judge the
// claim; it makes sure one is stated, so a maintainer can read it in one
// glance and close the PR under the ADR if it does not hold. A PR without
// the line is labelled for a human and told once what is missing. The label
// is left for the maintainer to clear, so a body edit cannot silently
// un-flag a PR nobody has looked at.
export const REMIT_LABEL = 'needs-human';
export const REMIT_MARKER = '<!-- pr-queue-hygiene:remit-missing -->';
export const AGENT_AUTHORS = new Set(
  (process.env.AGENT_AUTHORS || 'hivecommons-hive[bot]')
    .split(',')
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean),
);
// A line that starts with "Remit:" (optionally bold or italic) and says
// something after the colon. Case-insensitive so "REMIT:" counts too.
const REMIT_LINE_RE = /^[ \t]*[*_]{0,2}remit[*_]{0,2}[ \t]*:[ \t]*\S/im;
export const REMIT_NAG =
  'This pull request was opened by an agent and its description has no ' +
  '`Remit:` line. Under [ADR 0008](../../blob/main/adr/0008-scope-agent-findings-to-user-observable-change.md) ' +
  'an agent-filed PR must name the effect that justifies it: a defect an end ' +
  'user can observe on the production site, a security or supply-chain ' +
  'exposure, a required check failing, a generated-data or dependency ' +
  'refresh, or an issue a maintainer filed for agent work. Add a line of the ' +
  'form `Remit: <effect>` to the description. A change whose only effect is ' +
  'to move a metric (coverage, mutation score, clone count, test shape) is ' +
  'out of remit and will be closed. Flagged automatically by the PR queue ' +
  `hygiene workflow; the \`${REMIT_LABEL}\` label stays until a maintainer ` +
  'clears it.';

export function isAgentAuthored(pr, agentLogins = AGENT_AUTHORS) {
  const user = pr?.user;
  if (!user || user.type !== 'Bot') return false;
  return agentLogins.has(String(user.login || '').toLowerCase());
}

export function hasRemitLine(body) {
  return REMIT_LINE_RE.test(body || '');
}

// 'not-agent' for a human PR, 'present' when the line is there, 'missing'
// when an agent PR lacks it.
export function remitStatus(pr, agentLogins = AGENT_AUTHORS) {
  if (!isAgentAuthored(pr, agentLogins)) return 'not-agent';
  return hasRemitLine(pr.body) ? 'present' : 'missing';
}

// True when this job has already told the PR what is missing; the nag is
// posted once per PR, under the same trust rule as the conflict markers.
export function hasRemitNag(comments, isTrusted = isTrustedMarkerComment) {
  return comments.some(
    (comment) =>
      (comment.body || '').includes(REMIT_MARKER) && isTrusted(comment),
  );
}

// A marker is this job's own only if a bot account on the allowlist wrote
// it. GitHub reports App and Actions comments with user.type === 'Bot' and a
// "<slug>[bot]" login; a human impersonating that login is not possible.
export function isTrustedMarkerComment(
  comment,
  trustedLogins = TRUSTED_MARKER_AUTHORS,
) {
  const user = comment?.user;
  if (!user || user.type !== 'Bot') return false;
  return trustedLogins.has(String(user.login || '').toLowerCase());
}

// A resolved marker is trusted under the same rule as a first-conflict
// marker: only a bot login on the allowlist can clear the state, otherwise
// anyone could post a fake resolution to reset another PR's 48h clock.
export function isTrustedResolvedComment(
  comment,
  trustedLogins = TRUSTED_MARKER_AUTHORS,
) {
  return isTrustedMarkerComment(comment, trustedLogins);
}

// Extracts the first-conflict-observed timestamp (if any) from a PR's
// issue comments, by finding this script's own hidden marker comment.
//
// Comments are scanned in ascending (oldest-first) order. A trusted
// "resolved" marker clears any first-conflict marker seen so far, so a PR
// that stopped conflicting and later reconflicts gets a fresh candidate
// timestamp from the marker posted *after* the resolution, rather than
// reporting the stale pre-resolution marker and being immediately flagged
// as >48h stale. Markers from anyone else are ignored rather than
// returned, and so are markers whose payload is not a parseable past
// timestamp: a future value would make hoursSince() negative and exempt
// the PR from the stale gate permanently. Scanning continues past a
// rejected marker so a spoofed comment cannot hide the genuine one behind
// it. When nothing is trusted the caller records a fresh marker, so the
// state self-heals.
export function findFirstConflictObservedAt(comments, options = {}) {
  const {
    isTrusted = isTrustedMarkerComment,
    isResolvedTrusted = isTrustedResolvedComment,
    now = Date.now(),
  } = options;
  let candidate = null;
  for (const comment of comments) {
    const resolvedMatch = RESOLVED_MARKER_RE.exec(comment.body || '');
    if (resolvedMatch && isResolvedTrusted(comment)) {
      candidate = null;
      continue;
    }

    const match = MARKER_RE.exec(comment.body || '');
    if (!match) continue;
    if (!isTrusted(comment)) continue;
    const parsed = Date.parse(match[1]);
    if (Number.isNaN(parsed) || parsed > now) continue;
    candidate = match[1];
  }
  return candidate;
}

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8' });
  } catch (err) {
    // ENOENT means the runner image has no gh binary at all (the
    // self-hosted `gpus` fleet, run 39478332070). Every other failure is a
    // real gh/API error and must keep surfacing as-is.
    if (err.code !== 'ENOENT') throw err;
    return ghViaCurl(args);
  }
}

// curl's --config parser reads a double-quoted value with backslash escapes,
// so a credential containing a quote or a backslash would otherwise truncate
// the header or arrive altered. GitHub's tokens use neither character today;
// escaping here means this does not quietly depend on that staying true.
function escapeCurlConfigValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// The curl invocation for one REST call, as argv plus the stdin curl reads
// its remaining options from.
//
// The credential is deliberately NOT in argv. argv is readable by every other
// process on the machine through /proc/<pid>/cmdline for as long as the call
// runs, and execFileSync() builds its `Command failed: ...` error message out
// of that same argv -- and `-sf` makes curl exit non-zero on any 4xx/5xx, so a
// single 403 threw an error whose message carried the token verbatim. Actions
// masks the token in its own log, so what that left exposed is whatever else
// shares the runner, which is precisely the self-hosted fleet this fallback
// exists for. `--config -` takes the header from stdin instead: not argv, and
// not a file on disk either.
//
// Exported so the tests can assert the token's absence from argv directly,
// rather than inferring it from a call that would have to reach the network.
export function curlInvocation({ method, endpoint, body, token }) {
  const argv = [
    '-sf',
    '-X',
    method,
    '-H',
    'Accept: application/vnd.github+json',
    '-H',
    'X-GitHub-Api-Version: 2022-11-28',
  ];
  if (body !== undefined) {
    argv.push('-H', 'Content-Type: application/json', '--data', body);
  }
  argv.push(`https://api.github.com/${endpoint}`);
  if (!token) return { argv, input: '' };
  return {
    argv: ['--config', '-', ...argv],
    input: `header = "Authorization: Bearer ${escapeCurlConfigValue(token)}"\n`,
  };
}

// Reimplements exactly the gh command shapes this script uses, over the
// REST API via curl, so the job still runs on images without the gh CLI.
// Intentionally narrow: anything outside these shapes throws rather than
// guessing. Exported for the unit tests, like the helpers above.
export function ghViaCurl(args) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const curl = (method, endpoint, body) => {
    const { argv, input } = curlInvocation({ method, endpoint, body, token });
    try {
      return execFileSync('curl', argv, { encoding: 'utf8', input });
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new Error(
          'neither `gh` nor `curl` is available on this runner image; ' +
            'cannot reach the GitHub API',
        );
      }
      throw err;
    }
  };

  if (args[0] === 'api') {
    const endpoint = args[1];
    const out = curl('GET', endpoint);
    const jqIdx = args.indexOf('--jq');
    if (jqIdx === -1) return out;
    return applySimpleJqProjection(out, args[jqIdx + 1]);
  }

  if (args[0] === 'pr' && args[1] === 'comment') {
    const [number, body] = pickRepoArgs(args, '--body');
    curl(
      'POST',
      `repos/${pickRepo(args)}/issues/${number}/comments`,
      JSON.stringify({ body }),
    );
    return '';
  }

  if (args[0] === 'pr' && args[1] === 'edit') {
    const number = args[2];
    const repo = pickRepo(args);
    const addIdx = args.indexOf('--add-label');
    if (addIdx !== -1) {
      curl(
        'POST',
        `repos/${repo}/issues/${number}/labels`,
        JSON.stringify({ labels: [args[addIdx + 1]] }),
      );
      return '';
    }
    const removeIdx = args.indexOf('--remove-label');
    if (removeIdx !== -1) {
      curl(
        'DELETE',
        `repos/${repo}/issues/${number}/labels/${args[removeIdx + 1]}`,
      );
      return '';
    }
  }

  throw new Error(`gh fallback does not support: gh ${args.join(' ')}`);
}

function pickRepo(args) {
  const idx = args.indexOf('--repo');
  if (idx === -1) throw new Error('gh fallback: --repo is required');
  return args[idx + 1];
}

function pickRepoArgs(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) throw new Error(`gh fallback: ${flag} is required`);
  return [args[2], args[idx + 1]];
}

// Supports only the projection shape this script passes to `gh api --jq`:
// `{name: .path, ...}` with single-level paths. Applied client-side because
// curl cannot evaluate jq. Exported for the unit tests.
export function applySimpleJqProjection(raw, expr) {
  const inner = /^\{(.+)\}$/.exec(expr.trim())?.[1];
  if (!inner)
    throw new Error(`gh fallback: unsupported --jq expression: ${expr}`);
  const data = JSON.parse(raw);
  const out = {};
  for (const pair of inner.split(',')) {
    const [key, path] = pair.split(':').map((s) => s.trim());
    if (!key || !path || !path.startsWith('.')) {
      throw new Error(`gh fallback: unsupported --jq pair: ${pair}`);
    }
    out[key] = data[path.slice(1)];
  }
  return JSON.stringify(out);
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

// Fetches every issue comment on a PR, paginating past the 100-per-page
// cap. Issue comments sort ascending, so on a PR with more than 100
// comments a single unpaginated page can miss the marker entirely if it
// was posted early on -- this walks every page instead.
export function fetchAllIssueComments(repo, number) {
  const comments = [];
  let page = 1;
  const perPage = 100;
  for (;;) {
    const raw = gh([
      'api',
      `repos/${repo}/issues/${number}/comments?per_page=${perPage}&page=${page}`,
    ]);
    const batch = JSON.parse(raw);
    comments.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return comments;
}

export function hoursSince(isoString, now = Date.now()) {
  return (now - Date.parse(isoString)) / (1000 * 60 * 60);
}

export function labelNames(pr) {
  return (pr.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
}

export function isHeld(pr) {
  const names = labelNames(pr).map((n) => n.toLowerCase());
  return names.some((n) => HOLD_LABELS.has(n));
}

export async function isConflicting(
  repo,
  number,
  fetchDetail = defaultFetchDetail,
  maxRetries = 2,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const detail = await fetchDetail(repo, number);
    if (detail.mergeable === false || detail.mergeable_state === 'dirty') {
      return true;
    }
    if (detail.mergeable === true && detail.mergeable_state !== 'dirty') {
      return false;
    }
    if (attempt < maxRetries) {
      await sleepFn(1000);
    }
  }
  return false;
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

// Labels an agent PR that states no remit and tells it once what is missing.
// Idempotent: a PR already labelled and already nagged costs no API write.
function enforceRemit(pr, comments) {
  if (remitStatus(pr) !== 'missing') return;
  const number = pr.number;
  const needsLabel = !labelNames(pr).includes(REMIT_LABEL);
  const needsNag = !hasRemitNag(comments);
  if (!needsLabel && !needsNag) return;
  console.log(`PR #${number}: agent-authored with no Remit line, flagging`);
  if (DRY_RUN) return;
  if (needsLabel) {
    gh([
      'pr',
      'edit',
      String(number),
      '--repo',
      REPO,
      '--add-label',
      REMIT_LABEL,
    ]);
  }
  if (needsNag) {
    gh([
      'pr',
      'comment',
      String(number),
      '--repo',
      REPO,
      '--body',
      `${REMIT_MARKER}\n${REMIT_NAG}`,
    ]);
  }
}

async function main() {
  if (!REPO) throw new Error('REPO or GITHUB_REPOSITORY must be set');

  const prs = fetchAllOpenPRs(REPO);
  console.log(`Fetched ${prs.length} open PR(s) from ${REPO}`);

  for (const pr of prs) {
    const number = pr.number;

    // Never touch PRs marked on hold
    if (isHeld(pr)) {
      console.log(`PR #${number}: carries hold label, skipping`);
      continue;
    }

    const conflicting = await isConflicting(REPO, number);

    const comments = fetchAllIssueComments(REPO, number);
    enforceRemit(pr, comments);
    const firstObservedAt = findFirstConflictObservedAt(comments);

    if (!conflicting) {
      if (firstObservedAt) {
        console.log(
          `PR #${number}: no longer conflicting, clearing stale marker`,
        );
        if (!DRY_RUN) {
          if (labelNames(pr).includes(LABEL)) {
            gh([
              'pr',
              'edit',
              String(number),
              '--repo',
              REPO,
              '--remove-label',
              LABEL,
            ]);
          }
          gh([
            'pr',
            'comment',
            String(number),
            '--repo',
            REPO,
            '--body',
            `${RESOLVED_MARKER_PREFIX}${new Date().toISOString()} -->`,
          ]);
        }
      }
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
