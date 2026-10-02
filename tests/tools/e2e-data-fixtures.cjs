// Build-time data overlays for the end-to-end coverage run.
//
// Several src/components/** branches render only for data shapes the
// checked-in data/*.json files do not contain -- an archived user group, a
// person with neither role nor company, a member that is both member and
// contributor. The components read those files at build time through
// `@site/data/*.json`, so no Playwright spec can reach those branches against
// the shipped data, and they sit permanently uncovered in the "End-to-end
// coverage (non-gating)" job.
//
// The overlay is per-build, so it only helps where the missing shape is an
// *additional* record. A branch that turns on a single document-level field
// -- AwardsTimeline's verifiedAt, say -- cannot be reached from one build:
// clearing the field swaps which arm the one page renders rather than adding
// a case, trading one covered line for the arm it displaces.
//
// Those branches get a *second* build instead. With E2E_COVERAGE_VARIANT=1 the
// overlays in tests/e2e/fixtures/data-variants/** are applied on top of the
// ones above, and `npm run build:e2e:coverage` compiles that variant into a
// sub-directory of the ordinary coverage build under its own base URL. One
// `docusaurus serve` then offers both sites at once: the real page keeps
// rendering the field-present arm, the variant page renders the arm beside it,
// and because the two builds compile the same `src/**` sources the coverage
// report folds their scripts onto the same lines and unions what each reached.
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
// Overlay format (tests/e2e/fixtures/data[-variants]/<same relative path>.json):
//
//   {
//     "description": "why this overlay exists",
//     "set":    { "verifiedAt": null },
//     "append": { "people.staff": [ { ... } ] }
//   }
//
// `set` replaces the value at a dotted path that must already be present.
// `append` pushes onto an array that must already be present. Both are
// optional; `description` is required so the next reader knows which branch
// the overlay is holding open.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'e2e', 'fixtures', 'data');
const VARIANT_FIXTURE_DIR = path.join(
  REPO_ROOT,
  'tests',
  'e2e',
  'fixtures',
  'data-variants',
);

const OVERLAY_KEYS = new Set(['description', 'set', 'append']);

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
 * The overlay directories a build reads, in the order they are applied.
 *
 * The variant directory is additive and comes second, so a variant overlay
 * patches the document the ordinary coverage build was already compiled from
 * rather than replacing it. Only `npm run build:e2e:coverage`'s second pass
 * sets E2E_COVERAGE_VARIANT.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]} absolute fixture directories
 */
function overlayDirs(env = process.env) {
  return env.E2E_COVERAGE_VARIANT === '1'
    ? [FIXTURE_DIR, VARIANT_FIXTURE_DIR]
    : [FIXTURE_DIR];
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
 * Applies one overlay document to parsed data, returning a new document.
 *
 * Every path the overlay names must already exist: an overlay that no longer
 * matches the data it patches is a broken fixture, and failing here is what
 * keeps a regenerated data file from silently taking the coverage with it.
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
  FIXTURE_DIR,
  VARIANT_FIXTURE_DIR,
  applyOverlay,
  loadSiteData,
  overlayDirs,
  overlayPathFor,
  overlayPathsFor,
  overlaySource,
};
