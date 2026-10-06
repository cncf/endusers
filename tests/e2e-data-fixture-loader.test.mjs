// tests/tools/e2e-data-fixture-loader.cjs is the webpack loader
// docusaurus.config.js installs on data/ when E2E_COVERAGE=1, and it is the
// single point every data overlay in tests/e2e/fixtures/** passes through on
// its way into the end-to-end coverage build.
//
// Nothing imported it. `grep -rl e2e-data-fixture-loader` over the repository
// returns docusaurus.config.js (which names the path),
// tests/tools/e2e-data-fixtures.cjs (a prose reference) and
// tests/site-config.test.mjs:327, which asserts the config string and never
// loads the module. The coverage reporter therefore has no row for it at all:
// a file no test imports is recorded nowhere, so its lines are absent from the
// numerator and the denominator alike and no threshold can fall when it
// breaks. `--require-source-files` would have caught this under src/ or
// scripts/, but the loader lives under tests/tools/.
//
// Three behaviours are worth pinning, and each is invisible in a different way:
//
//   * The loader must overlay against `this.resourcePath`. Against any other
//     path no overlay matches and the data file passes through unchanged --
//     the build then succeeds, serves the checked-in corpus, and the specs
//     that exist to drive the overlaid branches quietly assert against the
//     wrong document.
//   * It must call `addDependency` for every overlay it applied. Dropping that
//     breaks nothing in a clean CI build and breaks incremental rebuilds
//     locally: editing a fixture leaves the previous overlay compiled in,
//     which is the failure mode most likely to be read as a flaky spec.
//   * A data file with no committed overlay must come back byte-for-byte. The
//     overlay engine round-trips JSON through JSON.stringify, so a loader that
//     forwarded unoverlaid files through it would silently reformat every
//     other data file in the build.
//
// The cases below drive the real committed overlays rather than fixtures of
// their own: the loader's contract is with those files, and a test that
// supplied its own would not notice the wiring changing underneath it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const loader = require('./tools/e2e-data-fixture-loader.cjs');
const {
  DATA_DIR,
  FIXTURE_DIR,
  VARIANT_FIXTURE_DIR,
  overlayPathsFor,
} = require('./tools/e2e-data-fixtures.cjs');

// A minimal stand-in for the webpack loader context: the loader reads
// `this.resourcePath` and calls `this.addDependency`, and nothing else.
function loaderContext(resourcePath) {
  const dependencies = [];
  return {
    resourcePath,
    addDependency(path) {
      dependencies.push(path);
    },
    dependencies,
  };
}

function run(relativeDataPath, { variant = false } = {}) {
  const resourcePath = join(DATA_DIR, relativeDataPath);
  const source = readFileSync(resourcePath, 'utf8');
  const context = loaderContext(resourcePath);
  // The loader reads the variant flag through process.env, so setting it here
  // is the only way to drive the second pass. A unit run never arrives with it
  // set -- the variant build is a separate pass of `npm run
  // build:e2e:coverage` -- so the helper asserts that and restores by
  // deleting, rather than carrying a restore branch no test can reach.
  assert.equal(
    process.env.E2E_COVERAGE_VARIANT,
    undefined,
    'E2E_COVERAGE_VARIANT leaked into the unit run',
  );
  if (variant) process.env.E2E_COVERAGE_VARIANT = '1';
  try {
    return { source, context, patched: loader.call(context, source) };
  } finally {
    delete process.env.E2E_COVERAGE_VARIANT;
  }
}

test('the loader overlays the file named by this.resourcePath', () => {
  const { source, patched } = run('members.json');

  // tests/e2e/fixtures/data/members.json appends one organization holding both
  // membership roles -- a status no real member carries. Its presence is proof
  // the overlay for *this* path was found and applied; an overlay keyed off
  // any other path would leave the corpus as committed.
  const before = JSON.parse(source).members;
  const after = JSON.parse(patched).members;
  assert.equal(after.length, before.length + 1);
  assert.equal(
    before.some((member) => member.id === 'coverage-fixture-org'),
    false,
  );
  assert.equal(
    after.some((member) => member.id === 'coverage-fixture-org'),
    true,
  );
});

test('the loader registers every overlay it applied as a dependency', () => {
  const { context } = run('members.json');

  assert.deepEqual(context.dependencies, [join(FIXTURE_DIR, 'members.json')]);
});

test('the variant build layers both overlays and registers both', () => {
  const resourcePath = join(DATA_DIR, 'community-people.json');
  // community-people.json is the one data file carrying an overlay in each
  // directory, so it is the only path on which the ordering is observable.
  assert.deepEqual(
    overlayPathsFor(resourcePath, { E2E_COVERAGE_VARIANT: '1' }),
    [
      join(FIXTURE_DIR, 'community-people.json'),
      join(VARIANT_FIXTURE_DIR, 'community-people.json'),
    ],
  );

  const { patched, context } = run('community-people.json', { variant: true });

  assert.deepEqual(context.dependencies, [
    join(FIXTURE_DIR, 'community-people.json'),
    join(VARIANT_FIXTURE_DIR, 'community-people.json'),
  ]);
  // The variant overlay empties fetchedAt and is applied second, so seeing it
  // win proves the base overlay did not overwrite it on the way past.
  assert.equal(JSON.parse(patched).fetchedAt, '');
});

test('a data file with no committed overlay is returned byte-for-byte', () => {
  // Chosen from the data directory at run time rather than named here: which
  // files carry an overlay changes as fixtures are added, and this case is
  // about the absence of one, not about a particular document.
  const unoverlaid = [
    'projects-born.json',
    'milestones.json',
    'metrics.json',
    'awards.json',
  ].find((name) => overlayPathsFor(join(DATA_DIR, name), {}).length === 0);
  assert.ok(unoverlaid, 'every candidate data file now carries a base overlay');

  const { source, patched, context } = run(unoverlaid);

  assert.equal(patched, source);
  assert.deepEqual(context.dependencies, []);
});
