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
  VARIANT_FIXTURE_DIR,
  applyOverlay,
  loadSiteData,
  overlayDirs,
  overlayPathFor,
  overlayPathsFor,
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
  assert.deepEqual(
    overlaySource(join(DATA_DIR, 'no-such-file.json'), source, {}),
    { source, overlays: [] },
  );
});

test('overlaySource reports the overlay it applied', () => {
  const path = join(DATA_DIR, 'community-groups.json');
  const result = overlaySource(path, readFileSync(path, 'utf8'), {});
  assert.deepEqual(result.overlays, [
    join(FIXTURE_DIR, 'community-groups.json'),
  ]);
  assert.ok(
    JSON.parse(result.source).groups.length >
      JSON.parse(readFileSync(path, 'utf8')).groups.length,
  );
});

// The variant build is a second site compiled from the same sources and
// served beside the first, which is the only way to cover a branch that turns
// on a document-level field: clearing it in the one coverage build would swap
// which arm the one page renders rather than add a case. The directory is
// additive and second, so a variant overlay patches what the ordinary
// coverage build already produced.
test('the variant overlay directory is additive and applies last', () => {
  assert.deepEqual(overlayDirs({}), [FIXTURE_DIR]);
  assert.deepEqual(overlayDirs({ E2E_COVERAGE_VARIANT: '1' }), [
    FIXTURE_DIR,
    VARIANT_FIXTURE_DIR,
  ]);
});

test('a data file patched by both directories collects both overlays', () => {
  const path = join(DATA_DIR, 'awards.json');
  assert.deepEqual(overlayPathsFor(path, {}), []);
  assert.deepEqual(overlayPathsFor(path, { E2E_COVERAGE_VARIANT: '1' }), [
    join(VARIANT_FIXTURE_DIR, 'awards.json'),
  ]);
  const groups = join(DATA_DIR, 'community-groups.json');
  assert.deepEqual(overlayPathsFor(groups, { E2E_COVERAGE_VARIANT: '1' }), [
    join(FIXTURE_DIR, 'community-groups.json'),
  ]);
});

// Both arms have to be reachable in one Playwright run, which is the whole
// point of building twice rather than overlaying once. If the variant overlay
// ever stopped applying, tests/e2e/data-variants.spec.js would fail against a
// page that looks perfectly ordinary, with nothing to say why.
test('the variant build clears the fields the ordinary build keeps', () => {
  // community-people.json clears to '' rather than null: PeopleFreshness
  // formats the field with `new Date(fetchedAt)`, and new Date(null) is 0
  // rather than an invalid date, so null would render a 1969 timestamp
  // instead of reaching the guards the overlay exists for.
  const cases = [
    ['awards.json', (data) => data.verifiedAt, null],
    ['metrics.json', (data) => data.generatedAt, null],
    ['community-people.json', (data) => data.fetchedAt, ''],
  ];
  for (const [name, field, cleared] of cases) {
    assert.ok(
      field(loadSiteData(name, { E2E_COVERAGE: '1' })),
      `${name}: the coverage build must keep the field the real page renders`,
    );
    assert.equal(
      field(
        loadSiteData(name, { E2E_COVERAGE: '1', E2E_COVERAGE_VARIANT: '1' }),
      ),
      cleared,
      `${name}: the variant build must clear it`,
    );
    // Whatever the cleared value is, it has to be falsy: every one of these
    // paragraphs is gated on the field being truthy somewhere before it is
    // formatted, so a cleared value that is merely different would leave the
    // paragraph rendering instead of switching the arm.
    assert.ok(
      !field(
        loadSiteData(name, {
          E2E_COVERAGE: '1',
          E2E_COVERAGE_VARIANT: '1',
        }),
      ),
      `${name}: the cleared value must be falsy`,
    );
  }
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
  // Both passes compile different data from the same sources, so the second
  // would replay the first's cache just as readily as it would the production
  // build's.
  for (const name of [
    'build:e2e:coverage:site',
    'build:e2e:coverage:variant',
  ]) {
    assert.match(
      scripts[name],
      /DOCUSAURUS_NO_PERSISTENT_CACHE=1/,
      `${name} must opt out of the shared bundler cache`,
    );
  }
  assert.match(
    scripts['build:e2e:coverage'],
    /build:e2e:coverage:site(?:.|\n)*build:e2e:coverage:variant/,
    'build:e2e:coverage must run the site build before the variant build',
  );
  // The variant is written inside the ordinary build output so one
  // `docusaurus serve` offers both sites, and under its own base URL so the
  // real routes keep their paths.
  assert.match(
    scripts['build:e2e:coverage:variant'],
    /BASE_URL=\/e2e-coverage-variant\//,
  );
  assert.match(
    scripts['build:e2e:coverage:variant'],
    /--out-dir build\/e2e-coverage-variant/,
  );
});
