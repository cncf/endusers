import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findFirstConflictObservedAt,
  hoursSince,
  isConflicting,
  isHeld,
  isTrustedMarkerComment,
  isTrustedResolvedComment,
  MARKER_PREFIX,
  RESOLVED_MARKER_PREFIX,
} from '../scripts/pr-queue-hygiene.mjs';
import { runWithGhStub } from './helpers-gh-sandbox.mjs';

const BOT = { login: 'github-actions[bot]', type: 'Bot' };
const HUMAN = { login: 'attacker', type: 'User' };

function marker(timestamp, user = BOT) {
  return { body: `${MARKER_PREFIX}${timestamp} -->`, user };
}

function resolvedMarker(timestamp, user = BOT) {
  return { body: `${RESOLVED_MARKER_PREFIX}${timestamp} -->`, user };
}

test('findFirstConflictObservedAt: finds the marker comment among others', () => {
  const comments = [
    { body: 'unrelated comment', user: HUMAN },
    marker('2026-09-01T00:00:00.000Z'),
    { body: 'another unrelated comment', user: HUMAN },
  ];
  assert.equal(
    findFirstConflictObservedAt(comments, {
      now: Date.parse('2026-09-03T00:00:00.000Z'),
    }),
    '2026-09-01T00:00:00.000Z',
  );
});

test('findFirstConflictObservedAt: returns null when no marker exists', () => {
  const comments = [{ body: 'just a regular comment', user: HUMAN }];
  assert.equal(findFirstConflictObservedAt(comments), null);
});

test('findFirstConflictObservedAt: ignores a marker posted by a human', () => {
  const comments = [marker('2020-01-01T00:00:00.000Z', HUMAN)];
  assert.equal(findFirstConflictObservedAt(comments), null);
});

test('findFirstConflictObservedAt: ignores a marker from an unlisted bot', () => {
  const comments = [
    marker('2020-01-01T00:00:00.000Z', { login: 'evil[bot]', type: 'Bot' }),
  ];
  assert.equal(findFirstConflictObservedAt(comments), null);
});

test('findFirstConflictObservedAt: ignores a future marker that would exempt the PR forever', () => {
  const comments = [marker('2099-01-01T00:00:00.000Z')];
  assert.equal(findFirstConflictObservedAt(comments), null);
});

test('findFirstConflictObservedAt: ignores an unparseable marker payload', () => {
  const comments = [marker('not-a-timestamp')];
  assert.equal(findFirstConflictObservedAt(comments), null);
});

test('findFirstConflictObservedAt: a spoofed marker does not mask the genuine one', () => {
  const comments = [
    marker('2020-01-01T00:00:00.000Z', HUMAN),
    marker('2026-09-01T00:00:00.000Z'),
  ];
  assert.equal(
    findFirstConflictObservedAt(comments, {
      now: Date.parse('2026-09-03T00:00:00.000Z'),
    }),
    '2026-09-01T00:00:00.000Z',
  );
});

test('findFirstConflictObservedAt: tolerates a comment with no author', () => {
  assert.equal(
    findFirstConflictObservedAt([{ body: `${MARKER_PREFIX}2020-01-01 -->` }]),
    null,
  );
});

test('findFirstConflictObservedAt: a trusted resolved marker clears an earlier stale marker', () => {
  const comments = [
    marker('2020-01-01T00:00:00.000Z'),
    resolvedMarker('2020-01-02T00:00:00.000Z'),
  ];
  assert.equal(
    findFirstConflictObservedAt(comments, {
      now: Date.parse('2026-09-03T00:00:00.000Z'),
    }),
    null,
  );
});

test('findFirstConflictObservedAt: a fresh marker after resolution is used, not the pre-resolution one', () => {
  const comments = [
    marker('2020-01-01T00:00:00.000Z'),
    resolvedMarker('2020-01-02T00:00:00.000Z'),
    marker('2026-09-01T00:00:00.000Z'),
  ];
  assert.equal(
    findFirstConflictObservedAt(comments, {
      now: Date.parse('2026-09-03T00:00:00.000Z'),
    }),
    '2026-09-01T00:00:00.000Z',
  );
});

test('findFirstConflictObservedAt: an untrusted resolved marker does not clear the genuine one', () => {
  const comments = [
    marker('2020-01-01T00:00:00.000Z'),
    resolvedMarker('2020-01-02T00:00:00.000Z', HUMAN),
  ];
  assert.equal(
    findFirstConflictObservedAt(comments, {
      now: Date.parse('2026-09-03T00:00:00.000Z'),
    }),
    '2020-01-01T00:00:00.000Z',
  );
});

test('isTrustedResolvedComment: only an allowlisted bot login is trusted', () => {
  assert.equal(isTrustedResolvedComment({ user: BOT }), true);
  assert.equal(isTrustedResolvedComment({ user: HUMAN }), false);
});

test('isTrustedMarkerComment: only an allowlisted bot login is trusted', () => {
  assert.equal(isTrustedMarkerComment({ user: BOT }), true);
  assert.equal(isTrustedMarkerComment({ user: HUMAN }), false);
  assert.equal(
    isTrustedMarkerComment({
      user: { login: 'github-actions[bot]', type: 'User' },
    }),
    false,
  );
  assert.equal(
    isTrustedMarkerComment(
      { user: { login: 'app[bot]', type: 'Bot' } },
      new Set(['app[bot]']),
    ),
    true,
  );
  assert.equal(isTrustedMarkerComment({}), false);
});

test('hoursSince: computes elapsed hours against a fixed "now"', () => {
  const now = Date.parse('2026-09-03T00:00:00.000Z');
  const hours = hoursSince('2026-09-01T00:00:00.000Z', now);
  assert.equal(hours, 48);
});

test('hoursSince: returns a value under 48 for a recent timestamp', () => {
  const now = Date.now();
  const recent = new Date(now - 10 * 60 * 60 * 1000).toISOString();
  assert.ok(hoursSince(recent, now) < 48);
});

test('isConflicting: true when mergeable is false, even if mergeable_state is stale', async () => {
  const result = await isConflicting('owner/repo', 1, () => ({
    mergeable: false,
    mergeable_state: 'unknown',
  }));
  assert.equal(result, true);
});

test('isConflicting: true when mergeable_state is dirty', async () => {
  const result = await isConflicting('owner/repo', 1, () => ({
    mergeable: null,
    mergeable_state: 'dirty',
  }));
  assert.equal(result, true);
});

test('isConflicting: false when mergeable is true and state is clean', async () => {
  const result = await isConflicting('owner/repo', 1, () => ({
    mergeable: true,
    mergeable_state: 'clean',
  }));
  assert.equal(result, false);
});

test('isConflicting: retries when mergeable is null and detects conflict on retry', async () => {
  let callCount = 0;
  let slept = 0;
  const mockFetch = () => {
    callCount += 1;
    if (callCount === 1) {
      return { mergeable: null, mergeable_state: 'unknown' };
    }
    return { mergeable: false, mergeable_state: 'dirty' };
  };
  const mockSleep = async (ms) => {
    slept += ms;
  };
  const result = await isConflicting('owner/repo', 1, mockFetch, 2, mockSleep);
  assert.equal(result, true);
  assert.equal(callCount, 2);
  assert.equal(slept, 1000);
});

test('isConflicting: returns false if retries exhaust without resolving conflict', async () => {
  let callCount = 0;
  let slept = 0;
  const mockFetch = () => {
    callCount += 1;
    return { mergeable: null, mergeable_state: 'unknown' };
  };
  const mockSleep = async (ms) => {
    slept += ms;
  };
  const result = await isConflicting('owner/repo', 1, mockFetch, 2, mockSleep);
  assert.equal(result, false);
  assert.equal(callCount, 3);
  assert.equal(slept, 2000);
});

test('isHeld: identifies hold, on-hold, and do-not-merge labels case-insensitively', () => {
  assert.equal(isHeld({ labels: [{ name: 'HOLD' }] }), true);
  assert.equal(isHeld({ labels: [{ name: 'on-hold' }] }), true);
  assert.equal(isHeld({ labels: [{ name: 'do-not-merge' }] }), true);
  assert.equal(isHeld({ labels: ['hold'] }), true);
  assert.equal(isHeld({ labels: [{ name: 'bug' }] }), false);
  assert.equal(isHeld({ labels: [] }), false);
  assert.equal(isHeld({}), false);
});

// --- pagination and end-to-end run ------------------------------------------
// fetchAllOpenPRs, fetchAllIssueComments and main() all shell out to `gh`, so
// they are exercised in a subprocess with `gh` replaced by a logging stub. The
// stub's recorded argv is the assertion surface: it shows which pages were
// requested and which labels and comments the run would have written.
//
// The detail route returns the already-projected object, because the script
// asks gh to apply `--jq '{mergeable, mergeable_state}'` server-side.

const SCRIPT = 'pr-queue-hygiene.mjs';
const NAG_SNIPPET = 'conflicting with the base branch for more than 48 hours';

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function openPRsRoute(prs) {
  return { match: 'pulls?state=open', stdout: JSON.stringify(prs) };
}

function detailRoute(number, detail) {
  return { match: `pulls/${number}`, stdout: JSON.stringify(detail) };
}

function commentsRoute(number, comments) {
  return {
    match: `issues/${number}/comments`,
    stdout: JSON.stringify(comments),
  };
}

function callsMatching(result, ...needles) {
  return result.calls.filter((argv) =>
    needles.every((needle) => argv.join(' ').includes(needle)),
  );
}

function runMain({ routes, env = {} }) {
  return runWithGhStub({
    script: SCRIPT,
    routes,
    env: { REPO: 'cncf/endusers', ...env },
  });
}

const PAGE_DRIVER = (call) => `
import { ${call.fn} } from './scripts/${SCRIPT}';
console.log(JSON.stringify(${call.expr}));
`;

test('fetchAllOpenPRs: returns a single short page without asking for a second', () => {
  const result = runWithGhStub({
    script: SCRIPT,
    driver: PAGE_DRIVER({
      fn: 'fetchAllOpenPRs',
      expr: "fetchAllOpenPRs('cncf/endusers')",
    }),
    routes: [{ match: '&page=1', stdout: JSON.stringify([{ number: 1 }]) }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [{ number: 1 }]);
  assert.equal(result.calls.length, 1);
});

test('fetchAllOpenPRs: pages past gh default limits and concatenates in order', () => {
  const firstPage = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
  const result = runWithGhStub({
    script: SCRIPT,
    driver: PAGE_DRIVER({
      fn: 'fetchAllOpenPRs',
      expr: "fetchAllOpenPRs('cncf/endusers')",
    }),
    routes: [
      { match: '&page=2', stdout: JSON.stringify([{ number: 101 }]) },
      { match: '&page=1', stdout: JSON.stringify(firstPage) },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  const prs = JSON.parse(result.stdout);
  assert.equal(prs.length, 101);
  assert.equal(prs[0].number, 1);
  assert.equal(prs[100].number, 101);
  assert.equal(result.calls.length, 2);
  assert.match(result.calls[0].join(' '), /state=open&per_page=100&page=1/);
  assert.match(result.calls[1].join(' '), /state=open&per_page=100&page=2/);
});

test('fetchAllOpenPRs: stops on an empty page after an exactly-full one', () => {
  const firstPage = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
  const result = runWithGhStub({
    script: SCRIPT,
    driver: PAGE_DRIVER({
      fn: 'fetchAllOpenPRs',
      expr: "fetchAllOpenPRs('cncf/endusers')",
    }),
    routes: [
      { match: '&page=2', stdout: '[]' },
      { match: '&page=1', stdout: JSON.stringify(firstPage) },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).length, 100);
  assert.equal(result.calls.length, 2);
});

test('fetchAllIssueComments: returns a single short page', () => {
  const result = runWithGhStub({
    script: SCRIPT,
    driver: PAGE_DRIVER({
      fn: 'fetchAllIssueComments',
      expr: "fetchAllIssueComments('cncf/endusers', 42)",
    }),
    routes: [{ match: '&page=1', stdout: JSON.stringify([{ body: 'hi' }]) }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [{ body: 'hi' }]);
  assert.equal(result.calls.length, 1);
  assert.match(result.calls[0].join(' '), /issues\/42\/comments/);
});

test('fetchAllIssueComments: finds a marker posted before a 100-comment thread', () => {
  const firstPage = Array.from({ length: 100 }, (_, i) =>
    i === 0 ? marker('2026-09-01T00:00:00.000Z') : { body: `chatter ${i}` },
  );
  const result = runWithGhStub({
    script: SCRIPT,
    driver: `
import { fetchAllIssueComments, findFirstConflictObservedAt } from './scripts/${SCRIPT}';
const comments = fetchAllIssueComments('cncf/endusers', 42);
console.log(JSON.stringify({
  count: comments.length,
  marker: findFirstConflictObservedAt(comments, { now: Date.parse('2026-09-30T00:00:00.000Z') }),
}));
`,
    routes: [
      { match: '&page=2', stdout: JSON.stringify([{ body: 'tail' }]) },
      { match: '&page=1', stdout: JSON.stringify(firstPage) },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    count: 101,
    marker: '2026-09-01T00:00:00.000Z',
  });
});

test('main: skips a held PR without fetching its mergeability', () => {
  const result = runMain({
    routes: [openPRsRoute([{ number: 7, labels: [{ name: 'hold' }] }])],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PR #7: carries hold label, skipping/);
  assert.equal(result.calls.length, 1);
});

test('main: records a first-conflict marker the first time a PR conflicts', () => {
  const result = runMain({
    routes: [
      openPRsRoute([{ number: 7, labels: [] }]),
      detailRoute(7, { mergeable: false, mergeable_state: 'dirty' }),
      commentsRoute(7, []),
      { match: 'pr comment', stdout: '' },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PR #7: newly observed as conflicting/);
  const posted = callsMatching(result, 'pr comment', MARKER_PREFIX);
  assert.equal(posted.length, 1);
  assert.equal(callsMatching(result, 'pr edit').length, 0);
});

test('main: DRY_RUN reports the new marker without writing it', () => {
  const result = runMain({
    env: { DRY_RUN: '1' },
    routes: [
      openPRsRoute([{ number: 7, labels: [] }]),
      detailRoute(7, { mergeable: false, mergeable_state: 'dirty' }),
      commentsRoute(7, []),
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PR #7: newly observed as conflicting/);
  assert.equal(callsMatching(result, 'pr comment').length, 0);
});

test('main: leaves a PR conflicting for less than 48 hours unlabeled', () => {
  const result = runMain({
    routes: [
      openPRsRoute([{ number: 7, labels: [] }]),
      detailRoute(7, { mergeable: false, mergeable_state: 'dirty' }),
      commentsRoute(7, [marker(hoursAgo(5))]),
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(callsMatching(result, 'pr edit').length, 0);
  assert.equal(callsMatching(result, 'pr comment').length, 0);
});

test('main: flags a PR that has been conflicting for more than 48 hours', () => {
  const result = runMain({
    routes: [
      openPRsRoute([{ number: 7, labels: [{ name: 'bug' }] }]),
      detailRoute(7, { mergeable: false, mergeable_state: 'dirty' }),
      commentsRoute(7, [marker(hoursAgo(50))]),
      { match: 'pr edit', stdout: '' },
      { match: 'pr comment', stdout: '' },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Flagging stale conflicting PR #7/);
  assert.equal(
    callsMatching(result, 'pr edit', '--add-label', 'needs-rebase-or-close')
      .length,
    1,
  );
  assert.equal(callsMatching(result, 'pr comment', NAG_SNIPPET).length, 1);
});

test('main: does not re-flag a stale PR that already carries the label', () => {
  const result = runMain({
    routes: [
      openPRsRoute([
        { number: 7, labels: [{ name: 'needs-rebase-or-close' }] },
      ]),
      detailRoute(7, { mergeable: false, mergeable_state: 'dirty' }),
      commentsRoute(7, [marker(hoursAgo(500))]),
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Flagging stale conflicting PR/);
  assert.equal(callsMatching(result, 'pr edit').length, 0);
  assert.equal(callsMatching(result, 'pr comment').length, 0);
});

test('main: ignores a spoofed marker and starts the window over', () => {
  const result = runMain({
    routes: [
      openPRsRoute([{ number: 7, labels: [] }]),
      detailRoute(7, { mergeable: false, mergeable_state: 'dirty' }),
      commentsRoute(7, [marker(hoursAgo(500), HUMAN)]),
      { match: 'pr comment', stdout: '' },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PR #7: newly observed as conflicting/);
  assert.equal(callsMatching(result, 'pr edit').length, 0);
  assert.equal(callsMatching(result, 'pr comment', MARKER_PREFIX).length, 1);
});

test('main: clears the marker and the label when a PR stops conflicting', () => {
  const result = runMain({
    routes: [
      openPRsRoute([
        { number: 7, labels: [{ name: 'needs-rebase-or-close' }] },
      ]),
      detailRoute(7, { mergeable: true, mergeable_state: 'clean' }),
      commentsRoute(7, [marker(hoursAgo(50))]),
      { match: 'pr edit', stdout: '' },
      { match: 'pr comment', stdout: '' },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PR #7: no longer conflicting/);
  assert.equal(
    callsMatching(result, 'pr edit', '--remove-label', 'needs-rebase-or-close')
      .length,
    1,
  );
  assert.equal(
    callsMatching(result, 'pr comment', RESOLVED_MARKER_PREFIX).length,
    1,
  );
});

test('main: clearing a marker does not remove a label the PR never carried', () => {
  const result = runMain({
    routes: [
      openPRsRoute([{ number: 7, labels: [] }]),
      detailRoute(7, { mergeable: true, mergeable_state: 'clean' }),
      commentsRoute(7, [marker(hoursAgo(50))]),
      { match: 'pr comment', stdout: '' },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(callsMatching(result, 'pr edit').length, 0);
  assert.equal(
    callsMatching(result, 'pr comment', RESOLVED_MARKER_PREFIX).length,
    1,
  );
});

test('main: DRY_RUN reports a resolution without clearing anything', () => {
  const result = runMain({
    env: { DRY_RUN: '1' },
    routes: [
      openPRsRoute([
        { number: 7, labels: [{ name: 'needs-rebase-or-close' }] },
      ]),
      detailRoute(7, { mergeable: true, mergeable_state: 'clean' }),
      commentsRoute(7, [marker(hoursAgo(50))]),
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PR #7: no longer conflicting/);
  assert.equal(callsMatching(result, 'pr edit').length, 0);
  assert.equal(callsMatching(result, 'pr comment').length, 0);
});

test('main: leaves a clean PR with no marker completely alone', () => {
  const result = runMain({
    routes: [
      openPRsRoute([{ number: 7, labels: [] }]),
      detailRoute(7, { mergeable: true, mergeable_state: 'clean' }),
      commentsRoute(7, [{ body: 'looks good', user: HUMAN }]),
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /no longer conflicting/);
  assert.equal(callsMatching(result, 'pr edit').length, 0);
  assert.equal(callsMatching(result, 'pr comment').length, 0);
});

test('main: honours MARKER_AUTHORS when the job comments as a GitHub App', () => {
  const appBot = { login: 'cncf-hive[bot]', type: 'Bot' };
  const result = runMain({
    env: { MARKER_AUTHORS: 'cncf-hive[bot]' },
    routes: [
      openPRsRoute([{ number: 7, labels: [] }]),
      detailRoute(7, { mergeable: false, mergeable_state: 'dirty' }),
      commentsRoute(7, [marker(hoursAgo(50), appBot)]),
      { match: 'pr edit', stdout: '' },
      { match: 'pr comment', stdout: '' },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    callsMatching(result, 'pr edit', '--add-label', 'needs-rebase-or-close')
      .length,
    1,
  );
});

test('main: treats every PR in the queue independently', () => {
  const result = runMain({
    routes: [
      openPRsRoute([
        { number: 7, labels: [{ name: 'hold' }] },
        { number: 8, labels: [] },
        { number: 9, labels: [] },
      ]),
      detailRoute(8, { mergeable: false, mergeable_state: 'dirty' }),
      detailRoute(9, { mergeable: true, mergeable_state: 'clean' }),
      commentsRoute(8, [marker(hoursAgo(50))]),
      commentsRoute(9, []),
      { match: 'pr edit', stdout: '' },
      { match: 'pr comment', stdout: '' },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Fetched 3 open PR\(s\)/);
  assert.match(result.stdout, /PR #7: carries hold label, skipping/);
  assert.equal(callsMatching(result, 'pr edit', '8').length, 1);
  assert.equal(callsMatching(result, 'pr comment', '8').length, 1);
  assert.equal(callsMatching(result, 'pr edit', '9').length, 0);
  assert.equal(callsMatching(result, 'pr comment', '9').length, 0);
});

test('main: fails loudly when no repository is configured', () => {
  const result = runWithGhStub({ script: SCRIPT, routes: [] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /REPO or GITHUB_REPOSITORY must be set/);
  assert.equal(result.calls.length, 0);
});
