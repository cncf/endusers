import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findFirstConflictObservedAt,
  hoursSince,
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

test('findFirstConflictObservedAt: uses the earliest marker if somehow duplicated', () => {
  const comments = [
    { body: `${MARKER_PREFIX}2026-09-05T00:00:00.000Z -->` },
    { body: `${MARKER_PREFIX}2026-09-01T00:00:00.000Z -->` },
  ];
  // First marker found in comment order (oldest comment first from the API)
  // is treated as authoritative -- this only matters if the marker was
  // somehow posted twice, which normal operation prevents.
  assert.equal(
    findFirstConflictObservedAt(comments),
    '2026-09-05T00:00:00.000Z',
  );
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
