import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findFirstConflictObservedAt,
  hoursSince,
  isConflicting,
  MARKER_PREFIX,
} from '../scripts/pr-queue-hygiene.mjs';

test('findFirstConflictObservedAt: finds the marker comment among others', () => {
  const comments = [
    { body: 'unrelated comment' },
    { body: `${MARKER_PREFIX}2026-09-01T00:00:00.000Z -->` },
    { body: 'another unrelated comment' },
  ];
  assert.equal(
    findFirstConflictObservedAt(comments),
    '2026-09-01T00:00:00.000Z',
  );
});

test('findFirstConflictObservedAt: returns null when no marker exists', () => {
  const comments = [{ body: 'just a regular comment' }];
  assert.equal(findFirstConflictObservedAt(comments), null);
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

test('isConflicting: true when mergeable is false, even if mergeable_state is stale', () => {
  const result = isConflicting('owner/repo', 1, () => ({
    mergeable: false,
    mergeable_state: 'unknown',
  }));
  assert.equal(result, true);
});

test('isConflicting: true when mergeable_state is dirty', () => {
  const result = isConflicting('owner/repo', 1, () => ({
    mergeable: null,
    mergeable_state: 'dirty',
  }));
  assert.equal(result, true);
});

test('isConflicting: false when mergeable is true and state is clean', () => {
  const result = isConflicting('owner/repo', 1, () => ({
    mergeable: true,
    mergeable_state: 'clean',
  }));
  assert.equal(result, false);
});

test('isConflicting: false when mergeable is null/unknown (not yet computed)', () => {
  const result = isConflicting('owner/repo', 1, () => ({
    mergeable: null,
    mergeable_state: 'unknown',
  }));
  assert.equal(result, false);
});
