import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findFirstConflictObservedAt,
  hoursSince,
  isConflicting,
  isHeld,
  isTrustedMarkerComment,
  MARKER_PREFIX,
} from '../scripts/pr-queue-hygiene.mjs';

const BOT = { login: 'github-actions[bot]', type: 'Bot' };
const HUMAN = { login: 'attacker', type: 'User' };

function marker(timestamp, user = BOT) {
  return { body: `${MARKER_PREFIX}${timestamp} -->`, user };
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
