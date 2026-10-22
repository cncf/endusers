import assert from 'node:assert/strict';
import test from 'node:test';

import { checkDuplicateValue } from '../scripts/lib/duplicate-check.mjs';

test('checkDuplicateValue accepts a new value and records it as seen', () => {
  const errors = [];
  const seen = new Set();
  const ok = checkDuplicateValue(errors, 'swisscom', 'swisscom', seen);
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
  assert.equal(seen.has('swisscom'), true);
});

test('checkDuplicateValue reports a repeat of a value already seen', () => {
  const seen = new Set(['swisscom']);
  const errors = [];
  const ok = checkDuplicateValue(errors, 'swisscom', 'swisscom', seen);
  assert.equal(ok, false);
  assert.deepEqual(errors, [
    { path: 'swisscom', severity: 'error', message: 'duplicate value' },
  ]);
});

test('checkDuplicateValue never inspects the value for presence', () => {
  // Unlike checkDuplicateOrMissingId() in scripts/lib/validate-utils.mjs,
  // this helper does not special-case a falsy value: a first occurrence of
  // undefined is accepted exactly like any other first occurrence, so a
  // caller that already runs a separate presence check does not get a
  // second "missing" error for the same entry.
  const errors = [];
  const seen = new Set();
  const ok = checkDuplicateValue(errors, 'unknown', undefined, seen);
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
  assert.equal(seen.has(undefined), true);
});

test('checkDuplicateValue reports a repeat of an already-seen falsy value', () => {
  const errors = [];
  const seen = new Set();
  checkDuplicateValue(errors, 'first', undefined, seen);
  const ok = checkDuplicateValue(errors, 'second', undefined, seen);
  assert.equal(ok, false);
  assert.deepEqual(errors, [
    { path: 'second', severity: 'error', message: 'duplicate value' },
  ]);
});

test('checkDuplicateValue uses a caller-supplied message when given one', () => {
  const errors = [];
  const seen = new Set(['envoy']);
  checkDuplicateValue(errors, 'envoy', 'envoy', seen, 'duplicate slug');
  assert.deepEqual(errors, [
    { path: 'envoy', severity: 'error', message: 'duplicate slug' },
  ]);
});
