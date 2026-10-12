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
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  DATA_DIR,
  FIXTURE_DIR,
  applyOverlay,
  coverageBuildNames,
  loadSiteData,
  overlayDirFor,
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

// `add` is the one operation whose leaf must be absent rather than present:
// it exists so an overlay can introduce a record under a keyed collection,
// which `set`, `append` and `setWhere` all refuse to do.
test('an overlay adds a key the real data does not carry', () => {
  const patched = applyOverlay(
    { lifecycle: { trends: { real: { values: [] } } } },
    overlay({ add: { 'lifecycle.trends.fixture': { values: [1] } } }),
    'fixture',
  );
  assert.deepEqual(patched.lifecycle.trends, {
    real: { values: [] },
    fixture: { values: [1] },
  });
});

// The fail-loud guarantee, pointing the other way from `set`'s: a regenerated
// data file that grows the same key must break the build rather than have the
// record it grew silently replaced by the fixture.
test('adding a key the real data already carries is rejected', () => {
  assert.throws(
    () =>
      applyOverlay(
        { lifecycle: { trends: { fixture: { values: [] } } } },
        overlay({ add: { 'lifecycle.trends.fixture': { values: [1] } } }),
        'fixture',
      ),
    /cannot add "lifecycle\.trends\.fixture"; the real data already carries it/,
  );
});

test('adding through a missing parent is rejected', () => {
  assert.throws(
    () =>
      applyOverlay(
        { lifecycle: {} },
        overlay({ add: { 'lifecycle.trends.fixture': {} } }),
        'fixture',
      ),
    /"lifecycle\.trends" is missing from the real data/,
  );
});

test('an added value is cloned rather than shared with the overlay', () => {
  const value = { values: [] };
  const patched = applyOverlay(
    { trends: {} },
    overlay({ add: { 'trends.fixture': value } }),
    'fixture',
  );
  value.values.push('mutated after the fact');
  assert.deepEqual(patched.trends.fixture, { values: [] });
});

// `set` runs before `add`, and `add` before `append`, so one overlay can add
// an array and then push onto it.
test('an overlay can append to the array it added', () => {
  const patched = applyOverlay(
    { trends: {} },
    overlay({
      add: { 'trends.fixture': { values: [] } },
      append: { 'trends.fixture.values': [{ date: '2026-01' }] },
    }),
    'fixture',
  );
  assert.deepEqual(patched.trends.fixture.values, [{ date: '2026-01' }]);
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

// The test above walks one segment before it throws, so the error names the
// prefix it reached. Nothing reached the other arm of that message. When the
// very first segment fails there is no prefix: `walked.join('.')` is '', and
// without the `|| dottedPath` fallback the overlay would be rejected with
// `"" is not an object in the real data`, naming nothing a reader could act
// on.
//
// It is reachable because applyOverlay validates the *overlay* document but
// never the real data it patches: `overlaySource` hands it whatever
// `JSON.parse` returned for the data file, which is an object today only
// because every file under data/ happens to be one. A data file regenerated
// as a top-level array — the shape a list of records most naturally takes —
// would land here, which is exactly the case the message has to explain.
test('a document that is not an object names the whole path, not an empty prefix', () => {
  for (const document of [[], null, 'text', 7]) {
    assert.throws(
      () => applyOverlay(document, overlay({ set: { 'a.b': 1 } }), 'f'),
      /"a\.b" is not an object in the real data/,
      `${JSON.stringify(document) ?? 'undefined'}: the message must name the path`,
    );
  }
});

test('setting a leaf whose parent is an array is rejected', () => {
  assert.throws(
    () =>
      applyOverlay({ a: { b: [1] } }, overlay({ set: { 'a.b.0': 2 } }), 'f'),
    /"a\.b\.0" has no object to patch in the real data/,
  );
});

// `set` and `append` both walk a dotted path down from a root object, which
// leaves a data file whose root is an array with no addressable path at all:
// the two guards pinned above are what a root-array file hits on every form.
// `setWhere` is the way in, and it keeps the fail-loud property the dotted
// paths have -- it names a record that must exist, by a field rather than a
// positional index, because the files it reaches are regenerated and their
// entry order is not stable.
test('setWhere patches one record of a top-level array', () => {
  const data = [
    { id: 'kept', industries: ['Financial'] },
    { id: 'target', industries: ['Insurance'] },
  ];
  const patched = applyOverlay(
    data,
    overlay({ setWhere: { 'id=target': { industries: [] } } }),
    'f',
  );
  assert.deepEqual(patched, [
    { id: 'kept', industries: ['Financial'] },
    { id: 'target', industries: [] },
  ]);
  // The overlay is a patch, not an edit of the document it was handed.
  assert.deepEqual(data[1].industries, ['Insurance']);
});

test('setWhere compares the selector value as a string', () => {
  assert.deepEqual(
    applyOverlay(
      [{ id: 7, seats: 1 }],
      overlay({ setWhere: { 'id=7': { seats: 0 } } }),
      'f',
    ),
    [{ id: 7, seats: 0 }],
  );
});

test('setWhere against a document that is not an array is rejected', () => {
  assert.throws(
    () =>
      applyOverlay({ groups: [] }, overlay({ setWhere: { 'id=a': {} } }), 'f'),
    /cannot select "id=a"; the real data is not a top-level array/,
  );
});

test('setWhere naming no record is rejected', () => {
  assert.throws(
    () =>
      applyOverlay(
        [{ id: 'other' }],
        overlay({ setWhere: { 'id=a': {} } }),
        'f',
      ),
    /cannot select "id=a"; no record matches in the real data/,
  );
});

test('setWhere matching more than one record is rejected', () => {
  assert.throws(
    () =>
      applyOverlay(
        [{ id: 'a' }, { id: 'a' }],
        overlay({ setWhere: { 'id=a': {} } }),
        'f',
      ),
    /"id=a" matches 2 records in the real data; the selector must name one/,
  );
});

test('setWhere setting a field absent from the record is rejected', () => {
  assert.throws(
    () =>
      applyOverlay(
        [{ id: 'a' }],
        overlay({ setWhere: { 'id=a': { gone: 1 } } }),
        'f',
      ),
    /cannot set "gone" on "id=a"; it is absent from the real data/,
  );
});

test('a malformed setWhere selector is rejected', () => {
  for (const selector of ['id', '=a', '']) {
    assert.throws(
      () => applyOverlay([], overlay({ setWhere: { [selector]: {} } }), 'f'),
      /must be "<field>=<value>"/,
      `${JSON.stringify(selector)}: the message must name the expected form`,
    );
  }
});

test('a setWhere value that is not an object is rejected', () => {
  for (const fields of [1, null, []]) {
    assert.throws(
      () =>
        applyOverlay(
          [{ id: 'a' }],
          overlay({ setWhere: { 'id=a': fields } }),
          'f',
        ),
      /"setWhere\.id=a" must be a JSON object of fields to set/,
      `${JSON.stringify(fields)}: the message must name the expected shape`,
    );
  }
});

// The two data files whose root is a JSON array. Both were outside the
// overlay mechanism entirely before `setWhere`; this pins that each is
// addressable today, against the real file rather than a sample.
test('both root-array data files are reachable by the mechanism', () => {
  const cases = [
    ['architectures/catalog.json', 'id', 'industries'],
    ['projects-born.json', 'name', 'origin'],
  ];
  for (const [name, selector, field] of cases) {
    const data = loadSiteData(name, {});
    assert.ok(Array.isArray(data), `${name}: expected a top-level array`);
    const [first] = data;
    assert.ok(
      first?.[selector],
      `${name}: expected records keyed by ${selector}`,
    );
    const patched = applyOverlay(
      data,
      overlay({
        setWhere: { [`${selector}=${first[selector]}`]: { [field]: null } },
      }),
      name,
    );
    assert.equal(patched[0][field], null);
    assert.equal(patched.length, data.length);
  }
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

// A named fixture build is a second site compiled from the same sources and
// served beside the first, which is the only way to cover a branch that turns
// on a document-level field: clearing it in the one coverage build would swap
// which arm the one page renders rather than add a case. The directory is
// additive and second, so its overlay patches what the ordinary coverage
// build already produced.
test('a named build directory is additive and applies last', () => {
  assert.deepEqual(overlayDirs({}), [FIXTURE_DIR]);
  assert.deepEqual(overlayDirs({ E2E_COVERAGE_BUILD: 'variant' }), [
    FIXTURE_DIR,
    overlayDirFor('variant'),
  ]);
});

// Every build name is a directory and every directory is a build: the list is
// what package.json's build pass loops over, so a directory missing from it
// would be a site nothing compiles and a spec asserting against a route that
// 404s.
test('the build names are the data-* fixture directories', () => {
  const names = coverageBuildNames();
  assert.ok(
    names.includes('variant'),
    'the variant build must still be declared',
  );
  assert.ok(
    names.includes('no-revision'),
    'the no-revision build must still be declared',
  );
  assert.deepEqual(names, [...names].sort(), 'build order must be stable');
  for (const name of names)
    assert.ok(
      statSync(overlayDirFor(name)).isDirectory(),
      `${name}: no overlay directory`,
    );
});

// A misspelled name must not quietly compile the ordinary coverage build
// under a second base URL: that site serves, passes a smoke test, and covers
// nothing the real build did not already cover.
test('an unknown build name is an error, not a silent ordinary build', () => {
  assert.throws(
    () => overlayDirs({ E2E_COVERAGE_BUILD: 'no-such-build' }),
    /names no overlay directory/,
  );
});

test('a data file patched by both directories collects both overlays', () => {
  const path = join(DATA_DIR, 'awards.json');
  assert.deepEqual(overlayPathsFor(path, {}), []);
  assert.deepEqual(overlayPathsFor(path, { E2E_COVERAGE_BUILD: 'variant' }), [
    join(overlayDirFor('variant'), 'awards.json'),
  ]);
  const groups = join(DATA_DIR, 'community-groups.json');
  assert.deepEqual(overlayPathsFor(groups, { E2E_COVERAGE_BUILD: 'variant' }), [
    join(FIXTURE_DIR, 'community-groups.json'),
    join(overlayDirFor('variant'), 'community-groups.json'),
  ]);
  // The contrast case: a file the ordinary coverage build overlays and the
  // variant build has nothing to add to still collects one path, which is
  // what proves the named directory is consulted only when it has
  // something to say rather than always appended.
  const catalog = join(DATA_DIR, 'architectures', 'catalog.json');
  assert.deepEqual(
    overlayPathsFor(catalog, { E2E_COVERAGE_BUILD: 'variant' }),
    [join(FIXTURE_DIR, 'architectures', 'catalog.json')],
  );
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
        loadSiteData(name, {
          E2E_COVERAGE: '1',
          E2E_COVERAGE_BUILD: 'variant',
        }),
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
          E2E_COVERAGE_BUILD: 'variant',
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
    [
      'architectures/catalog.json',
      (data) => data.some((entry) => entry.industries.length === 0),
      'every catalog entry still carries an industry, so ArchitectureCard\u2019s eyebrow fallback stays unreachable',
    ],
    [
      'architectures/catalog.json',
      (data) => data.some((entry) => entry.industries.length > 0),
      'no catalog entry carries an industry, so the populated arm stopped rendering',
    ],
    [
      'metrics.json',
      (data) =>
        Object.values(data.referenceArchitectureLifecycle.trends).filter(
          (trend) => trend.values.length === 1,
        ).length === 1,
      'the ordinary coverage build must carry exactly one single-point trend, or Sparkline\u2019s centring arm has nothing to render',
    ],
    [
      'metrics.json',
      (data) =>
        Object.values(data.referenceArchitectureLifecycle.trends).some(
          (trend) => trend.values.length === 0,
        ) &&
        Object.values(data.referenceArchitectureLifecycle.trends).some(
          (trend) => trend.values.length > 1,
        ),
      'the added trend displaced a real one instead of rendering beside it, so the arms it was added next to stopped rendering',
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
  const driver = readFileSync(
    new URL('./tools/e2e-coverage-builds.mjs', import.meta.url),
    'utf8',
  );
  // The site pass compiles different data from the same sources, so the
  // fixture passes would replay its cache just as readily as the production
  // build's -- and so would it replay theirs.
  assert.match(
    scripts['build:e2e:coverage:site'],
    /DOCUSAURUS_NO_PERSISTENT_CACHE=1/,
    'build:e2e:coverage:site must opt out of the shared bundler cache',
  );
  assert.match(
    driver,
    /DOCUSAURUS_NO_PERSISTENT_CACHE: '1'/,
    'every fixture build must opt out of the shared bundler cache',
  );
  assert.match(
    scripts['build:e2e:coverage'],
    /build:e2e:coverage:site(?:.|\n)*build:e2e:coverage:fixtures/,
    'build:e2e:coverage must run the site build before the fixture builds',
  );
  assert.match(
    scripts['build:e2e:coverage:fixtures'],
    /tests\/tools\/e2e-coverage-builds\.mjs/,
  );
  // Each fixture build is written inside the ordinary build output so one
  // `docusaurus serve` offers every site, and under its own base URL so the
  // real routes keep their paths. Both are derived from the build name, which
  // is what lets a new build be a new directory and nothing else.
  assert.match(driver, /BASE_URL: `\/e2e-coverage-\$\{name\}\/`/);
  assert.match(driver, /`build\/e2e-coverage-\$\{name\}`/);
  assert.match(driver, /E2E_COVERAGE_BUILD: name/);
});
