// Build-time data overlays for the end-to-end coverage run.
//
// Several src/components/** branches render only for data shapes the
// checked-in data/*.json files do not contain -- an archived user group, a
// person with neither role nor company, a member that is both member and
// contributor. The components read those files at build time through
// `@site/data/*.json`, so no Playwright spec can reach those branches against
// the shipped data, and they sit permanently uncovered in the "End-to-end
// coverage" job.
//
// The overlay is per-build, so it only helps where the missing shape is an
// *additional* record. A branch that turns on a single document-level field
// -- AwardsTimeline's verifiedAt, say -- cannot be reached from one build:
// clearing the field swaps which arm the one page renders rather than adding
// a case, trading one covered line for the arm it displaces.
//
// Those branches get a build of their own instead. Every directory named
// `tests/e2e/fixtures/data-<name>/` declares one additional build: with
// E2E_COVERAGE_BUILD=<name> its overlays are applied on top of the ones above,
// and `npm run build:e2e:coverage` compiles that build into
// `build/e2e-coverage-<name>` under base URL `/e2e-coverage-<name>/`. One
// `docusaurus serve` then offers every site at once: the real page keeps
// rendering the field-present arm, each named build renders the arm beside it,
// and because the builds compile the same `src/**` sources the coverage report
// folds their scripts onto the same lines and unions what each reached.
//
// The build list is the directory listing, not a registry: adding
// `tests/e2e/fixtures/data-<name>/` adds a build, and nothing else has to be
// told about it. That matters because one additional build is not enough.
// `data-variant` clears `metrics.generatedAt`, which is what reaches
// ReferenceArchitectures' `: null` syncDate arm; the same component's
// absent-revision guard needs `sources.architectures.revision` cleared while
// `generatedAt` stays present, so the two shapes cannot share a build. With
// a fixed number of builds every such pair is a standoff where covering one
// arm un-covers another; with a directory per build it is one more directory.
//
// Each build is a full Docusaurus compile, so CI time for the end-to-end
// coverage job grows linearly in the number of `data-<name>/` directories.
// A new build is worth adding when the shape it needs provably conflicts with
// every existing one -- not as the first reach for a branch an additive
// overlay in `tests/e2e/fixtures/data/` could cover instead.
//
// This module applies a small, committed overlay to a data file so the missing
// shapes exist in the coverage build only. It is used from two places:
//
//   * tests/tools/e2e-data-fixture-loader.cjs, a webpack loader that the
//     E2E_COVERAGE=1 build installs on data/*.json (docusaurus.config.js), so
//     the served bundle sees the overlaid data;
//   * loadSiteData() below, so a spec asserting against a data file sees the
//     same document the page was built from.
//
// `npm run build:production`, the gating "End-to-end tests" job and the
// deployed site never load this module: nothing outside E2E_COVERAGE=1
// registers the loader, and loadSiteData() returns the file unchanged.
//
// Overlays are deliberately additive patches rather than whole-file copies.
// A copy of data/members.json would be 101 duplicated records that silently
// rot the moment the real file is regenerated; an overlay states only the
// delta, and every path it names must still exist in the real file, so a
// shape change fails the build instead of quietly dropping the coverage it
// was written for.
//
// Overlay format (tests/e2e/fixtures/data[-<name>]/<same relative path>.json):
//
//   {
//     "description": "why this overlay exists",
//     "set":      { "verifiedAt": null },
//     "add":      { "lifecycle.trends.coverageFixture": { ... } },
//     "append":   { "people.staff": [ { ... } ] },
//     "setWhere": { "id=allianz": { "industries": [] } }
//   }
//
// `set` replaces the value at a dotted path that must already be present.
// `add` introduces a key that must be absent, under a parent object that must
// be present. `append` pushes onto an array that must already be present.
// `setWhere` patches fields of the one record of a top-level JSON array whose
// selector field holds the named value. All four are optional; `description`
// is required so the next reader knows which branch the overlay is holding
// open.
//
// `add` exists because `set`, `append` and `setWhere` all require the key they
// name to be present, so an overlay could only ever reshape a record the real
// data already carries -- never introduce one under a keyed collection. That
// turned any branch keyed on a collection's *presence* into a build of its
// own: MetricsDashboard's lifecycle trends are addressed by key, and the one
// trend carrying no values is also the only one that could be given a single
// value, so covering the single-value sparkline arm meant trading the
// no-values arm for it unless the trend grid could grow a record. `add` keeps
// the fail-loud guarantee pointing the other way: the parent must exist, and
// the leaf must *not*, so a regenerated data file that grows the same key
// breaks the build instead of silently having its record overwritten by the
// fixture.
//
// Operations are applied in the order `set`, `add`, `append`, `setWhere`, so
// one overlay can add an array and then push onto it.
//
// `setWhere` exists because `set` and `append` both walk dotted paths from a
// root object, so a data file whose root is an array -- data/architectures/
// catalog.json and data/projects-born.json -- had no addressable path at all.
// It is keyed on a field value rather than a positional index because both
// files are regenerated (`npm run import:architectures`,
// `npm run collect:projects-born`) and entry order is not stable, while the
// fail-loud guarantee is the point: an overlay naming a record that the
// regenerated file no longer carries breaks the build instead of quietly
// dropping the coverage it was written for.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const FIXTURES_ROOT = path.join(REPO_ROOT, 'tests', 'e2e', 'fixtures');
const FIXTURE_DIR = path.join(FIXTURES_ROOT, 'data');
const BUILD_DIR_PREFIX = 'data-';

const OVERLAY_KEYS = new Set([
  'description',
  'set',
  'add',
  'append',
  'setWhere',
]);

/**
 * Maps a file under data/ to the overlay that patches it, or null when the
 * path is outside data/.
 *
 * @param {string} dataPath absolute or repo-relative path to a data file
 * @param {string} [fixtureDir] directory the overlay is looked up in
 * @returns {string|null} absolute path to the overlay file
 */
function overlayPathFor(dataPath, fixtureDir = FIXTURE_DIR) {
  const relative = path.relative(DATA_DIR, path.resolve(REPO_ROOT, dataPath));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative))
    return null;
  return path.join(fixtureDir, relative);
}

/**
 * The overlay directory of one named build.
 *
 * @param {string} name build name, e.g. 'variant'
 * @returns {string} absolute path to tests/e2e/fixtures/data-<name>
 */
function overlayDirFor(name) {
  return path.join(FIXTURES_ROOT, `${BUILD_DIR_PREFIX}${name}`);
}

/**
 * Every named build the repository declares, in a stable order.
 *
 * The list is the directory listing rather than a committed registry: a build
 * exists because `tests/e2e/fixtures/data-<name>/` exists, so adding one is
 * adding a directory and nothing has to be kept in step with it. Sorted so the
 * build order, the base URLs and the test expectations do not depend on the
 * order a filesystem happens to return.
 *
 * @param {string} [fixturesRoot]
 * @returns {string[]} build names, without the `data-` prefix
 */
function coverageBuildNames(fixturesRoot = FIXTURES_ROOT) {
  return fs
    .readdirSync(fixturesRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith(BUILD_DIR_PREFIX),
    )
    .map((entry) => entry.name.slice(BUILD_DIR_PREFIX.length))
    .sort();
}

/**
 * The overlay directories a build reads, in the order they are applied.
 *
 * The named build's directory is additive and comes second, so its overlay
 * patches the document the ordinary coverage build was already compiled from
 * rather than replacing it. Only the per-build passes of
 * `npm run build:e2e:coverage` set E2E_COVERAGE_BUILD; the ordinary coverage
 * build leaves it unset and reads tests/e2e/fixtures/data/ alone.
 *
 * An unknown name is an error rather than a silent fall-back to the ordinary
 * build: a typo would otherwise compile a site that looks right, serves, and
 * covers nothing the real build did not already cover.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]} absolute fixture directories
 */
function overlayDirs(env = process.env) {
  const name = env.E2E_COVERAGE_BUILD;
  if (!name) return [FIXTURE_DIR];
  const known = coverageBuildNames();
  if (!known.includes(name))
    throw new Error(
      `E2E_COVERAGE_BUILD="${name}" names no overlay directory; expected one of ${known.join(', ')} (tests/e2e/fixtures/${BUILD_DIR_PREFIX}<name>/)`,
    );
  return [FIXTURE_DIR, overlayDirFor(name)];
}

/**
 * Every committed overlay that applies to one data file, in order.
 *
 * @param {string} dataPath path to the real data file
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]} absolute paths to the overlay files that exist
 */
function overlayPathsFor(dataPath, env = process.env) {
  return overlayDirs(env)
    .map((dir) => overlayPathFor(dataPath, dir))
    .filter((overlayPath) => overlayPath && fs.existsSync(overlayPath));
}

function parentOf(document, dottedPath, label) {
  const segments = dottedPath.split('.');
  const leaf = segments.pop();
  let cursor = document;
  const walked = [];
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor))
      throw new Error(
        `${label}: "${walked.join('.') || dottedPath}" is not an object in the real data`,
      );
    if (!Object.prototype.hasOwnProperty.call(cursor, segment))
      throw new Error(
        `${label}: "${[...walked, segment].join('.')}" is missing from the real data`,
      );
    walked.push(segment);
    cursor = cursor[segment];
  }
  if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor))
    throw new Error(
      `${label}: "${dottedPath}" has no object to patch in the real data`,
    );
  return [cursor, leaf];
}

/**
 * Resolves a `setWhere` selector to the one record it names.
 *
 * The selector is `<field>=<value>`, matched against a top-level JSON array.
 * Values are compared as strings so a selector stays writable in JSON for a
 * numeric or boolean field; a selector that matches no record, or more than
 * one, is an error rather than a silent no-op.
 *
 * @param {unknown} document the patched document
 * @param {string} selector `<field>=<value>`
 * @param {string} label path reported in error messages
 * @returns {Record<string, unknown>} the matched record, in place
 */
function recordOf(document, selector, label) {
  const separator = selector.indexOf('=');
  if (separator <= 0)
    throw new Error(
      `${label}: setWhere selector "${selector}" must be "<field>=<value>"`,
    );
  const field = selector.slice(0, separator);
  const value = selector.slice(separator + 1);
  if (!Array.isArray(document))
    throw new Error(
      `${label}: cannot select "${selector}"; the real data is not a top-level array`,
    );
  const matches = document.filter(
    (record) =>
      record !== null &&
      typeof record === 'object' &&
      !Array.isArray(record) &&
      Object.prototype.hasOwnProperty.call(record, field) &&
      String(record[field]) === value,
  );
  if (matches.length === 0)
    throw new Error(
      `${label}: cannot select "${selector}"; no record matches in the real data`,
    );
  if (matches.length > 1)
    throw new Error(
      `${label}: "${selector}" matches ${matches.length} records in the real data; the selector must name one`,
    );
  return matches[0];
}

/**
 * Applies one overlay document to parsed data, returning a new document.
 *
 * Every path the overlay names must already exist, except an `add` leaf, which
 * must not: an overlay that no longer matches the data it patches is a broken
 * fixture, and failing here is what keeps a regenerated data file from
 * silently taking the coverage with it -- or, for `add`, from silently having
 * the record it grew overwritten by the fixture.
 *
 * @param {unknown} data parsed contents of the real data file
 * @param {unknown} overlay parsed contents of the overlay file
 * @param {string} label path reported in error messages
 * @returns {unknown} the patched document
 */
function applyOverlay(data, overlay, label) {
  if (overlay === null || typeof overlay !== 'object' || Array.isArray(overlay))
    throw new Error(`${label}: overlay must be a JSON object`);
  for (const key of Object.keys(overlay)) {
    if (!OVERLAY_KEYS.has(key))
      throw new Error(
        `${label}: unknown overlay key "${key}" (expected ${[...OVERLAY_KEYS].join(', ')})`,
      );
  }
  if (typeof overlay.description !== 'string' || overlay.description === '')
    throw new Error(`${label}: overlay needs a non-empty "description"`);

  const patched = structuredClone(data);
  for (const [dottedPath, value] of Object.entries(overlay.set || {})) {
    const [parent, leaf] = parentOf(patched, dottedPath, label);
    if (!Object.prototype.hasOwnProperty.call(parent, leaf))
      throw new Error(
        `${label}: cannot set "${dottedPath}"; it is absent from the real data`,
      );
    parent[leaf] = value;
  }
  for (const [dottedPath, value] of Object.entries(overlay.add || {})) {
    const [parent, leaf] = parentOf(patched, dottedPath, label);
    if (Object.prototype.hasOwnProperty.call(parent, leaf))
      throw new Error(
        `${label}: cannot add "${dottedPath}"; the real data already carries it, so the fixture would overwrite real data instead of adding a shape beside it`,
      );
    parent[leaf] = structuredClone(value);
  }
  for (const [dottedPath, entries] of Object.entries(overlay.append || {})) {
    if (!Array.isArray(entries))
      throw new Error(`${label}: "append.${dottedPath}" must be an array`);
    const [parent, leaf] = parentOf(patched, dottedPath, label);
    if (!Array.isArray(parent[leaf]))
      throw new Error(
        `${label}: cannot append to "${dottedPath}"; it is not an array in the real data`,
      );
    parent[leaf] = [...parent[leaf], ...structuredClone(entries)];
  }
  for (const [selector, fields] of Object.entries(overlay.setWhere || {})) {
    if (fields === null || typeof fields !== 'object' || Array.isArray(fields))
      throw new Error(
        `${label}: "setWhere.${selector}" must be a JSON object of fields to set`,
      );
    const record = recordOf(patched, selector, label);
    for (const [field, value] of Object.entries(fields)) {
      if (!Object.prototype.hasOwnProperty.call(record, field))
        throw new Error(
          `${label}: cannot set "${field}" on "${selector}"; it is absent from the real data`,
        );
      record[field] = structuredClone(value);
    }
  }
  return patched;
}

/**
 * Overlays the source of one data file, falling back to it unchanged when no
 * overlay is committed for it.
 *
 * @param {string} dataPath path to the real data file
 * @param {string} source its contents
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{source: string, overlays: string[]}} patched source, and the
 *   overlays that produced it (empty when the file was returned unchanged)
 */
function overlaySource(dataPath, source, env = process.env) {
  const overlays = overlayPathsFor(dataPath, env);
  if (overlays.length === 0) return { source, overlays };
  let document = JSON.parse(source);
  for (const overlayPath of overlays) {
    const label = path.relative(REPO_ROOT, overlayPath);
    const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
    document = applyOverlay(document, overlay, label);
  }
  return { source: JSON.stringify(document), overlays };
}

/**
 * Reads a data file the way the running site sees it.
 *
 * Under E2E_COVERAGE=1 that is the overlaid document the coverage build was
 * compiled from; otherwise it is the checked-in file. Specs that assert
 * against data/*.json use this so one spec file serves both builds.
 *
 * @param {string} relativePath path relative to data/, e.g. 'awards.json'
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {unknown} the parsed document
 */
function loadSiteData(relativePath, env = process.env) {
  const dataPath = path.join(DATA_DIR, relativePath);
  const source = fs.readFileSync(dataPath, 'utf8');
  if (env.E2E_COVERAGE !== '1') return JSON.parse(source);
  return JSON.parse(overlaySource(dataPath, source, env).source);
}

module.exports = {
  DATA_DIR,
  FIXTURES_ROOT,
  FIXTURE_DIR,
  applyOverlay,
  coverageBuildNames,
  loadSiteData,
  overlayDirFor,
  overlayDirs,
  overlayPathFor,
  overlayPathsFor,
  overlaySource,
};
