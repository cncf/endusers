import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isCoverageEnabled } from './tools/e2e-coverage.cjs';

// Twelve end-to-end specs hold cases that only the coverage build can satisfy
// -- they navigate a route that exists only under E2E_COVERAGE=1, or they
// assert against the fixture overlay that only that build layers in. Each one
// gates itself by hand:
//
//   const describeCoverage =
//     process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;
//
// That gate fails open, in the same way tests/e2e-data-dependent-skips.test.mjs
// describes for `test.skip()`: Playwright reports a skipped case as a
// non-failure, so a gate that stops matching leaves the case skipped in *both*
// CI jobs and both stay green. Typing `=== 1` instead of `=== '1'`, inverting
// the arms, or replacing the ternary with a bare `test.describe.skip` all have
// that effect, and none of them is a syntax error or a failing assertion.
//
// tests/e2e-data-dependent-skips.test.mjs:36-40 states that it deliberately
// does not scan these blocks -- its subject is skips that turn on the
// committed data, and these turn on the build. That is the right split, and it
// leaves the build-dependent half unguarded. This file is that half. It runs in
// the unit suite, which CI runs on every pull request, so it needs no browser.
//
// The three checks are not interchangeable. The inventory catches a gate that
// disappears or appears; the shape check catches a gate that is still there but
// no longer means what it says; the route check catches a new coverage-only
// spec that forgot to gate at all -- which would not fail open, it would fail
// the gating "End-to-end tests" job on a 404, but naming it here is what makes
// the inventory the whole story rather than a list someone has to remember.

const root = fileURLToPath(new URL('..', import.meta.url));
const specDir = join(root, 'tests', 'e2e');

// Matched as one literal string rather than parsed, because the point is that
// every spec says the same thing in the same words: a gate that is merely
// equivalent is a gate the next reader has to re-derive.
const GATE =
  "const describeCoverage =\n  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;";

// The specs whose cases cannot run outside the coverage build. Pinned as a list
// so that retiring one is an edit to this file, not a silent subtraction from
// what the coverage run exercises.
const COVERAGE_GATED = [
  'case-studies-variant.spec.js',
  'case-studies.spec.js',
  'cncf-project-card.spec.js',
  'community-people-unknown-section.spec.js',
  'data-fixtures.spec.js',
  'data-variants.spec.js',
  'group-link-status-variant.spec.js',
  'member-directory-freshness-variant.spec.js',
  'metrics-empty-collections-variant.spec.js',
  'metrics-sparkline.spec.js',
  'radar-reports-variant.spec.js',
  'reference-architectures-no-revision.spec.js',
];

const specNames = readdirSync(specDir)
  .filter((entry) => entry.endsWith('.spec.js'))
  .sort();

const sourceOf = new Map(
  specNames.map((name) => [name, readFileSync(join(specDir, name), 'utf8')]),
);

test('the coverage-gated spec inventory is exactly the specs that skip a describe block', () => {
  const gated = specNames.filter((name) =>
    sourceOf.get(name).includes('test.describe.skip'),
  );
  assert.deepEqual(gated, [...COVERAGE_GATED].sort());
});

test('every coverage-gated spec spells the gate the one canonical way', () => {
  for (const name of COVERAGE_GATED) {
    const source = sourceOf.get(name);
    assert.ok(
      source.includes(GATE),
      `${name} does not carry the canonical coverage gate. Expected, verbatim:\n${GATE}`,
    );
    // One gate per spec: a second, differently worded one would satisfy the
    // check above while governing a block of its own.
    assert.equal(
      source.split('test.describe.skip').length - 1,
      1,
      `${name} mentions test.describe.skip more than once`,
    );
    assert.equal(
      source.split('describeCoverage(').length - 1,
      1,
      `${name} should open exactly one describeCoverage block`,
    );
  }
});

test('no spec calls test.describe.skip directly', () => {
  // `test.describe.skip;` is the ternary's right operand and is what the gate
  // is made of. `test.describe.skip(...)` is an unconditional skip, which
  // retires the block in every job including the coverage run.
  for (const name of specNames) {
    assert.ok(
      !/describe\.skip\s*\(/.test(sourceOf.get(name)),
      `${name} skips a describe block unconditionally`,
    );
  }
});

test('every spec that visits a coverage-only route is gated', () => {
  // Routes the coverage build alone serves: the fixture docs instance
  // (/e2e-coverage-fixtures/) and the per-directory fixture builds
  // (/e2e-coverage-<name>/). Matched inside a string literal so that a
  // prose mention in a comment does not count as a visit.
  const visitsCoverageRoute = (source) =>
    /['"`]\/e2e-coverage-[a-z0-9-]+/.test(source);
  for (const name of specNames) {
    if (!visitsCoverageRoute(sourceOf.get(name))) continue;
    assert.ok(
      COVERAGE_GATED.includes(name),
      `${name} visits a coverage-only route but is not coverage-gated; it would 404 in the "End-to-end tests" job`,
    );
  }
});

test('the gate agrees with the harness that records the coverage', () => {
  // The spec-side gate decides whether a coverage-only case runs; the
  // harness-side isCoverageEnabled() decides whether anything it does is
  // recorded. They are written out separately, so they can drift: a harness
  // that started accepting 'true' would record for a run whose specs all
  // skipped, and the e2e region numbers would move for no reason a reader
  // could see.
  const gateSays = (value) => value === '1';
  for (const value of ['1', '0', '', 'true', 'yes', undefined]) {
    assert.equal(
      isCoverageEnabled({ E2E_COVERAGE: value }),
      gateSays(value),
      `the harness and the spec gate disagree about E2E_COVERAGE=${JSON.stringify(value)}`,
    );
  }
});
