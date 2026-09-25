// Block-level gaps in scripts/pr-queue-hygiene.mjs that the line-percentage
// reporter cannot see.
//
// tests/tools/coverage-report.mjs counts a line as covered when *any*
// character on it ran, so a falsy-default that shares a line with covered
// code reads as covered even though its fallback arm never executes. Raw V8
// range data for the file shows four blocks at zero:
//
//   - the `''` arm of `String(user.login || '')` in isTrustedMarkerComment
//   - the `''` arm of both `comment.body || ''` reads in
//     findFirstConflictObservedAt
//   - the default `sleepFn` parameter of isConflicting, whose body no test
//     reaches because every retry test injects a mock sleep
//
// The first three sit in the marker-trust path this script's 48h stale gate
// depends on, and each one guards a comment shape the GitHub API really
// returns. The fourth is the delay production actually runs.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findFirstConflictObservedAt,
  isConflicting,
  isTrustedMarkerComment,
  isTrustedResolvedComment,
  MARKER_PREFIX,
  RESOLVED_MARKER_PREFIX,
} from '../scripts/pr-queue-hygiene.mjs';

const BOT = { login: 'github-actions[bot]', type: 'Bot' };

test('isTrustedMarkerComment: a Bot account with no login is not trusted', () => {
  // `user.login` is absent rather than wrong. Without the `|| ''` fallback
  // this would throw on String(undefined)-style lookups in a stricter
  // rewrite; with it, the empty login must simply miss the allowlist.
  assert.equal(isTrustedMarkerComment({ user: { type: 'Bot' } }), false);
  assert.equal(
    isTrustedMarkerComment({ user: { type: 'Bot', login: '' } }),
    false,
  );
  assert.equal(
    isTrustedMarkerComment({ user: { type: 'Bot', login: null } }),
    false,
  );
});

test('isTrustedMarkerComment: an empty allowlist entry cannot be matched by a login-less bot', () => {
  // The allowlist is built with `.filter(Boolean)`, so `''` is never a member.
  // Passing an explicit allowlist that *does* contain `''` documents that the
  // fallback value is only ever compared, never trusted by construction.
  assert.equal(
    isTrustedMarkerComment({ user: { type: 'Bot' } }, new Set([''])),
    true,
  );
  assert.equal(
    isTrustedMarkerComment({ user: { type: 'Bot' } }, new Set(['other[bot]'])),
    false,
  );
});

test('isTrustedResolvedComment: a Bot account with no login cannot clear a marker', () => {
  assert.equal(isTrustedResolvedComment({ user: { type: 'Bot' } }), false);
});

test('findFirstConflictObservedAt: tolerates a comment with no body', () => {
  // A review-state or otherwise empty comment arrives with `body` absent.
  // Both marker regexes read `comment.body` on the same pass, so a missing
  // body must not throw before the genuine marker later in the thread is
  // reached.
  const comments = [
    { user: BOT },
    { body: null, user: BOT },
    { body: undefined, user: BOT },
    { body: `${MARKER_PREFIX}2026-09-01T00:00:00.000Z -->`, user: BOT },
  ];
  assert.equal(
    findFirstConflictObservedAt(comments, {
      now: Date.parse('2026-09-03T00:00:00.000Z'),
    }),
    '2026-09-01T00:00:00.000Z',
  );
});

test('findFirstConflictObservedAt: a body-less comment after a marker leaves it intact', () => {
  const comments = [
    { body: `${MARKER_PREFIX}2026-09-01T00:00:00.000Z -->`, user: BOT },
    { user: BOT },
  ];
  assert.equal(
    findFirstConflictObservedAt(comments, {
      now: Date.parse('2026-09-03T00:00:00.000Z'),
    }),
    '2026-09-01T00:00:00.000Z',
  );
});

test('findFirstConflictObservedAt: returns null for a thread of body-less comments', () => {
  assert.equal(findFirstConflictObservedAt([{ user: BOT }, {}]), null);
});

test('findFirstConflictObservedAt: a resolved marker still clears when a body-less comment precedes it', () => {
  const comments = [
    { body: `${MARKER_PREFIX}2026-09-01T00:00:00.000Z -->`, user: BOT },
    { user: BOT },
    {
      body: `${RESOLVED_MARKER_PREFIX}2026-09-02T00:00:00.000Z -->`,
      user: BOT,
    },
  ];
  assert.equal(
    findFirstConflictObservedAt(comments, {
      now: Date.parse('2026-09-03T00:00:00.000Z'),
    }),
    null,
  );
});

test('isConflicting: the default sleepFn waits 1000ms between retries', async (t) => {
  // Production calls isConflicting without a sleepFn, so the default arrow
  // function is the delay that actually runs in the workflow. Mocked timers
  // exercise its body without spending the wall-clock second.
  t.mock.timers.enable({ apis: ['setTimeout'] });

  let callCount = 0;
  const mockFetch = () => {
    callCount += 1;
    if (callCount === 1) return { mergeable: null, mergeable_state: 'unknown' };
    return { mergeable: false, mergeable_state: 'dirty' };
  };

  const pending = isConflicting('owner/repo', 1, mockFetch, 1);

  // Let the first fetchDetail await settle so the default sleepFn has
  // registered its timer before it is advanced.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callCount, 1, 'the retry timer should be pending');

  t.mock.timers.tick(1000);

  assert.equal(await pending, true);
  assert.equal(callCount, 2);
});

test('isConflicting: the default sleepFn runs once per exhausted retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  let callCount = 0;
  const mockFetch = () => {
    callCount += 1;
    return { mergeable: null, mergeable_state: 'unknown' };
  };

  const pending = isConflicting('owner/repo', 1, mockFetch, 2);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callCount, 1);
  t.mock.timers.tick(1000);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callCount, 2);
  t.mock.timers.tick(1000);

  assert.equal(await pending, false);
  assert.equal(callCount, 3);
});

test('isConflicting: no sleep is scheduled when the first answer is decisive', async (t) => {
  // The default sleepFn must not run at all on the happy path; with mocked
  // timers a stray scheduled delay would leave the promise unresolved.
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const result = await isConflicting('owner/repo', 1, () => ({
    mergeable: true,
    mergeable_state: 'clean',
  }));
  assert.equal(result, false);
});
