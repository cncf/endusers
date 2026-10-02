// The overlay machinery behind the E2E_COVERAGE=1 data fixtures.
//
// tests/tools/e2e-data-fixtures.cjs is what makes three otherwise unreachable
// component branches testable in a browser, and it runs inside a webpack
// build where a silent miss has no symptom: if an overlay stopped applying,
// the coverage build would compile the real data, the specs in
// tests/e2e/data-fixtures.spec.js would fail with no indication of why, and
// the branches would quietly go back to being uncoverable.
//
// Its guards are therefore pinned here: every path an overlay names must
// still exist in the real data, so a regenerated data file breaks the build
// instead of taking the coverage with it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  DATA_DIR,
  FIXTURE_DIR,
  applyOverlay,
  loadSiteData,
  overlayPathFor,
  overlaySource,
} from './tools/e2e-data-fixtures.cjs';

const DESCRIPTION = 'why this overlay exists';

function overlay(extra) {
  return { description: DESCRIPTION, ...extra };
}

test('an overlay sets a value at a dotted path', () => {
  const patched = applyOverlay(
    { meta: { verifiedAt: '2026-01-01' } },
    overlay({ set: { 'meta.verifiedAt': null } }),
    'fixture',
  );
  assert.deepEqual(patched, { meta: { verifiedAt: null } });
});

test('an overlay appends to an existing array', () => {
  const patched = applyOverlay(
    { people: { staff: [{ name: 'real' }] } },
    overlay({ append: { 'people.staff': [{ name: 'fixture' }] } }),
    'fixture',
  );
  assert.deepEqual(patched.people.staff, [
    { name: 'real' },
    { name: 'fixture' },
  ]);
});

test('the real document is not mutated', () => {
  const data = { groups: [{ slug: 'real' }] };
  applyOverlay(data, overlay({ append: { groups: [{ slug: 'added' }] } }), 'f');
  assert.deepEqual(data, { groups: [{ slug: 'real' }] });
});

test('setting a path absent from the real data is rejected', () => {
  assert.throws(
    () => applyOverlay({ kept: 1 }, overlay({ set: { gone: null } }), 'f'),
    /cannot set "gone"; it is absent from the real data/,
  );
});

test('setting through a missing parent is rejected', () => {
  assert.throws(
    () => applyOverlay({}, overlay({ set: { 'a.b': 1 } }), 'f'),
    /"a" is missing from the real data/,
  );
});

test('setting through a non-object parent is rejected', () => {
  assert.throws(
    () => applyOverlay({ a: [1] }, overlay({ set: { 'a.b.c': 1 } }), 'f'),
    /"a" is not an object in the real data/,
  );
});

test('setting a leaf whose parent is an array is rejected', () => {
  assert.throws(
    () =>
      applyOverlay({ a: { b: [1] } }, overlay({ set: { 'a.b.0': 2 } }), 'f'),
    /"a\.b\.0" has no object to patch in the real data/,
  );
});

test('appending to something that is not an array is rejected', () => {
  assert.throws(
    () => applyOverlay({ a: 'text' }, overlay({ append: { a: [1] } }), 'f'),
    /cannot append to "a"; it is not an array in the real data/,
  );
});

test('an append value that is not an array is rejected', () => {
  assert.throws(
    () => applyOverlay({ a: [] }, overlay({ append: { a: 1 } }), 'f'),
    /"append\.a" must be an array/,
  );
});

test('an unknown overlay key is rejected rather than ignored', () => {
  assert.throws(
    () => applyOverlay({}, overlay({ replace: {} }), 'f'),
    /unknown overlay key "replace"/,
  );
});

test('an overlay without a description is rejected', () => {
  assert.throws(
    () => applyOverlay({}, { set: {} }, 'f'),
    /needs a non-empty "description"/,
  );
});

test('a non-object overlay is rejected', () => {
  assert.throws(() => applyOverlay({}, [], 'f'), /must be a JSON object/);
});

test('a data file outside data/ has no overlay path', () => {
  assert.equal(overlayPathFor('src/components/MemberDirectory/utils.js'), null);
  assert.equal(overlayPathFor('data'), null);
});

test('a data file with no committed overlay is returned byte-for-byte', () => {
  const source = '{"untouched": true}';
  assert.deepEqual(overlaySource(join(DATA_DIR, 'no-such-file.json'), source), {
    source,
    overlay: null,
  });
});

test('overlaySource reports the overlay it applied', () => {
  const path = join(DATA_DIR, 'community-groups.json');
  const result = overlaySource(path, readFileSync(path, 'utf8'));
  assert.equal(result.overlay, join(FIXTURE_DIR, 'community-groups.json'));
  assert.ok(
    JSON.parse(result.source).groups.length >
      JSON.parse(readFileSync(path, 'utf8')).groups.length,
  );
});

test('loadSiteData returns the checked-in file outside the coverage build', () => {
  const data = loadSiteData('community-groups.json', {});
  assert.deepEqual(
    data,
    JSON.parse(readFileSync(join(DATA_DIR, 'community-groups.json'), 'utf8')),
  );
});

test('loadSiteData returns the overlaid document inside the coverage build', () => {
  const data = loadSiteData('community-groups.json', { E2E_COVERAGE: '1' });
  assert.ok(data.groups.some((group) => group.archived));
});

// The point of the whole mechanism: each committed overlay must still apply to
// the data file it patches, and must still produce the shape the branch under
// test needs. A regenerated data file that no longer matches fails here, where
// the message says so, rather than in a browser run that just stops covering
// the branch.
test('every committed overlay still applies to its data file', () => {
  const cases = [
    [
      'community-groups.json',
      (data) =>
        data.groups.some(
          (group) => group.archived || group.reachable === false,
        ),
      'no group is archived or unreachable',
    ],
    [
      'community-people.json',
      (data) =>
        (data.people.staff || []).some(
          (person) => !person.role && !person.company,
        ),
      'no person lacks both role and company',
    ],
    [
      'members.json',
      (data) =>
        data.members.some(
          (member) => member.membershipStatus === 'member-and-contributor',
        ),
      'no member holds both roles',
    ],
  ];
  for (const [name, holds, why] of cases) {
    const data = loadSiteData(name, { E2E_COVERAGE: '1' });
    assert.ok(holds(data), `${name}: ${why}`);
  }
});

// The overlays are applied by a loader, but Rspack's persistent cache is keyed
// on neither the loader chain nor E2E_COVERAGE: a cache written by one build
// is replayed into the other. Running `npm run build:e2e:coverage` and then
// `npm run build:production` in the same working tree produced a production
// build containing the fixture records until build:e2e:coverage stopped
// sharing the cache. Nothing else would catch that — the second build is
// silent and its output looks ordinary.
test('the coverage build does not share a bundler cache with the real build', () => {
  const scripts = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ).scripts;
  assert.match(
    scripts['build:e2e:coverage'],
    /DOCUSAURUS_NO_PERSISTENT_CACHE=1/,
    'build:e2e:coverage must opt out of the shared bundler cache',
  );
});
