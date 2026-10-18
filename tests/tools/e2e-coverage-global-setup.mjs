// Fails an end-to-end coverage run once, up front, when `E2E_COVERAGE=1` is
// set without the run directory the capture writes into.
//
// tests/tools/e2e-coverage.cjs raises
// "E2E_COVERAGE_DIR and E2E_COVERAGE_RUN_ID are required when E2E_COVERAGE=1"
// from `createManager`, which runs inside the per-test coverage fixture. That
// is the right place for it -- the fixture is what needs the directory -- but
// it is reached once per test, so a run started without the two variables
// reports the same message several hundred times and the cause is buried in
// the middle of the output rather than stated at the top.
//
// The documented invocation (CONTRIBUTING.md, "Browser source coverage")
// seeds a run directory with `e2e-coverage-run.mjs init` and exports both
// variables, so this is the shape a hand-run or a partially copied command
// takes rather than a broken repository. `npm run test:e2e:coverage` sets
// `E2E_COVERAGE=1` and nothing else, which is exactly the half of the
// documented pair a reader is most likely to run on its own.
//
// This does not replace the fixture's guard and is not a place to relax it: a
// worker process can be handed a different environment than the one that
// loaded the config. This only moves the *diagnosis* of the common cases ahead
// of the work.
//
// The run manifest is checked here for the same reason the two variables are.
// `CoverageManager.verifyRun` rejects a directory whose manifest is missing,
// names a different run, or has already been sealed -- but it is called from
// the per-test coverage fixture, so each of those reports once per test (346
// in the current suite) instead of once. The documented invocation
// (CONTRIBUTING.md, "Browser source coverage") seeds a fresh directory per
// capture precisely because a sealed run cannot be reused, which makes
// re-running `npm run test:e2e:coverage` against the previous `$RUN_DIR` the
// most likely way to reach it.
//
// The built site is checked here for the same reason. The reporter refuses a
// run with no attributable src/** coverage, but only after the suite has run
// to completion against the wrong site — and `playwright.config.js` sets
// `reuseExistingServer: !process.env.CI`, so a `docusaurus serve` left over
// from an earlier `npm run build` is adopted by a local coverage run without
// a word. See `assertCoverageBuild`.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { isCoverageEnabled } = require('./e2e-coverage.cjs');

// How CONTRIBUTING.md "Browser source coverage" says to seed a capture.
// Shared by every message below so a reader who hits any of them is sent to
// the same documented commands rather than to a paraphrase of them.
const SEED_A_RUN =
  'Seed a fresh run directory, as CONTRIBUTING.md "Browser source ' +
  'coverage" shows:\n' +
  '  RUN_ID="local-$(date +%s)"\n' +
  '  RUN_DIR="coverage/e2e/$RUN_ID"\n' +
  '  node tests/tools/e2e-coverage-run.mjs init --dir "$RUN_DIR" --run-id "$RUN_ID"\n' +
  '  E2E_COVERAGE_DIR="$RUN_DIR" E2E_COVERAGE_RUN_ID="$RUN_ID" npm run test:e2e:coverage\n' +
  'To run the suite without capturing coverage, unset E2E_COVERAGE.';

// How CONTRIBUTING.md "Browser source coverage" says to produce the site the
// capture runs against. Separate from SEED_A_RUN because a reader who reaches
// the build guard below has usually seeded the run correctly and skipped (or
// invalidated) only the build step.
const BUILD_FOR_COVERAGE =
  'Produce the instrumented site first, as CONTRIBUTING.md "Browser source ' +
  'coverage" shows:\n' +
  '  npm run build:e2e:coverage\n' +
  'To run the suite without capturing coverage, unset E2E_COVERAGE.';

// The directory `playwright.config.js` serves. Its webServer runs
// `npx docusaurus serve` with no `--dir`, so the suite is always pointed at
// Docusaurus' default output directory, and ci.yml renders the report with
// `--build build` against the same one. Kept as a default argument rather
// than read from the config so the checks below stay pure functions of a
// path that tests can hand a temporary directory.
export const DEFAULT_BUILD_DIR = fileURLToPath(
  new URL('../../build', import.meta.url),
);

// What `npm run build:e2e:coverage` leaves behind and `npm run build` does
// not. Both markers are registered in docusaurus.config.js behind the same
// `E2E_COVERAGE === '1'` test, so either one missing means the site on disk
// was built without it:
//
//   * `assets/js/*.js.map` comes from the endusers-e2e-source-maps plugin
//     (`devtool: 'source-map'`). Without those maps the capture records
//     bundle offsets that no src/** file can be credited with, and the run
//     ends in the reporter's "No src/** coverage was attributable".
//   * `e2e-coverage-fixtures/` is the second docs instance serving
//     tests/e2e/fixtures/docs/**. Without it the specs that exercise
//     fixture-only prop shapes fail on a 404 rather than on their assertion.
//
// Checking both names the cause precisely instead of leaving a reader to
// infer it from whichever symptom surfaced first.
const FIXTURE_DOCS_ROUTE = 'e2e-coverage-fixtures';
const CLIENT_BUNDLE_DIR = join('assets', 'js');

/**
 * Describes why `buildDir` is not an e2e coverage build, or `null` if it is.
 *
 * Pure and synchronous so tests/e2e-coverage-build-marker.test.mjs can drive
 * every arm against temporary directories. `assertCoverageBuild` is the only
 * caller that consults `process.env`.
 *
 * @param {string} buildDir directory `docusaurus serve` will serve
 * @returns {string|null} a sentence naming the problem, or null when none
 */
export function coverageBuildProblem(buildDir) {
  if (!isDirectory(buildDir)) {
    return `no site has been built at ${buildDir}`;
  }
  if (!isDirectory(join(buildDir, FIXTURE_DOCS_ROUTE))) {
    return (
      `the site at ${buildDir} has no ${FIXTURE_DOCS_ROUTE}/ route, so it ` +
      'was built without E2E_COVERAGE=1'
    );
  }
  if (!hasSourceMap(join(buildDir, CLIENT_BUNDLE_DIR))) {
    return (
      `the site at ${buildDir} ships no ${CLIENT_BUNDLE_DIR}/*.js.map, so ` +
      'the capture could not be mapped back to src/**'
    );
  }
  return null;
}

/**
 * Whether `path` exists and is a directory.
 *
 * `existsSync` alone would accept a file of the same name, which is the shape
 * a stray `build` artifact takes.
 *
 * @param {string} path filesystem path to test
 * @returns {boolean}
 */
function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

/**
 * Whether `bundleDir` holds at least one emitted source map.
 *
 * A missing directory counts as no maps: a build that never produced client
 * bundles cannot have mapped them either.
 *
 * @param {string} bundleDir directory holding the client bundles
 * @returns {boolean}
 */
function hasSourceMap(bundleDir) {
  if (!isDirectory(bundleDir)) return false;
  return readdirSync(bundleDir).some((entry) => entry.endsWith('.js.map'));
}

/**
 * Throws when coverage is on but the built site is not a coverage build.
 *
 * The reporter already refuses a run with no attributable src/** coverage,
 * but only after the whole suite has run against the wrong site. This is the
 * same diagnosis made before that time is spent, which is this module's
 * purpose (see the header).
 *
 * The hazard is not hypothetical: `playwright.config.js` sets
 * `reuseExistingServer: !process.env.CI`, so a `docusaurus serve` left
 * running from an earlier `npm run build` is adopted silently by a local
 * coverage run.
 *
 * @param {NodeJS.ProcessEnv} [env] environment to inspect
 * @param {string} [buildDir] directory `docusaurus serve` will serve
 * @returns {void}
 */
export function assertCoverageBuild(
  env = process.env,
  buildDir = DEFAULT_BUILD_DIR,
) {
  if (!isCoverageEnabled(env)) return;
  const problem = coverageBuildProblem(buildDir);
  if (problem === null) return;
  throw new Error(`E2E_COVERAGE=1 but ${problem}. ${BUILD_FOR_COVERAGE}`);
}

/**
 * The variables `tests/tools/e2e-coverage.cjs` requires once coverage is on.
 *
 * Kept as a named export so tests/e2e-coverage-global-setup.test.mjs can
 * assert this guard and the fixture's turn on the same pair, rather than
 * leaving two predicates to drift apart.
 */
export const REQUIRED_COVERAGE_ENV = [
  'E2E_COVERAGE_DIR',
  'E2E_COVERAGE_RUN_ID',
];

/**
 * Throws when coverage is enabled and a required variable is missing or empty.
 *
 * Empty counts as missing because the fixture's own check is falsy-based, so
 * accepting `''` here would report success and then fail once per test, which
 * is the outcome this guard exists to prevent.
 *
 * @param {NodeJS.ProcessEnv} [env] environment to inspect
 * @returns {void}
 */
export function assertCoverageEnv(env = process.env) {
  if (!isCoverageEnabled(env)) return;
  const missing = REQUIRED_COVERAGE_ENV.filter((name) => !env[name]);
  if (missing.length === 0) return;
  throw new Error(
    `E2E_COVERAGE=1 but ${missing.join(' and ')} ${
      missing.length === 1 ? 'is' : 'are'
    } not set, so the run has nowhere to write coverage artifacts. ${SEED_A_RUN}`,
  );
}

/**
 * Throws when coverage is on and `E2E_COVERAGE_DIR` holds no usable run.
 *
 * Mirrors `CoverageManager.verifyRun` in tests/tools/e2e-coverage.cjs: the run
 * must be readable, must name the run id this process was given, and must not
 * already be sealed. The fixture keeps its own copy of these checks -- it is
 * the authoritative one -- and this only reports them once rather than once
 * per test.
 *
 * Assumes `assertCoverageEnv` has already passed, so both variables are set.
 *
 * @param {NodeJS.ProcessEnv} [env] environment to inspect
 * @returns {Promise<void>}
 */
export async function assertCoverageRun(env = process.env) {
  if (!isCoverageEnabled(env)) return;
  const runDir = env.E2E_COVERAGE_DIR;
  const runId = env.E2E_COVERAGE_RUN_ID;
  const { readCoverageRun } = await import('./e2e-coverage-run.mjs');
  let manifest;
  try {
    manifest = await readCoverageRun(runDir);
  } catch (cause) {
    // Covers both a directory that was never seeded and a manifest that no
    // longer parses. The underlying message is kept as the cause so the
    // distinction is still available, but the remedy is the same either way.
    throw new Error(
      `E2E_COVERAGE=1 but no readable coverage run manifest was found in ` +
        `E2E_COVERAGE_DIR ${runDir} (${causeMessage(cause)}). ${SEED_A_RUN}`,
      { cause },
    );
  }
  if (manifest.runId !== runId) {
    throw new Error(
      `E2E_COVERAGE_RUN_ID ${runId} does not match the run in ` +
        `E2E_COVERAGE_DIR ${runDir}, whose manifest names ${manifest.runId}. ` +
        `Export the run id the directory was seeded with, or ${lowerFirst(SEED_A_RUN)}`,
    );
  }
  if (manifest.status !== 'started') {
    throw new Error(
      `the coverage run in E2E_COVERAGE_DIR ${runDir} is already sealed as ` +
        `${manifest.status}, so it can accept no further artifacts. A sealed ` +
        `run is immutable by design -- captures are not appended to it. ` +
        `${SEED_A_RUN}`,
    );
  }
}

/**
 * Lowercases the first character, for splicing SEED_A_RUN after a clause.
 *
 * @param {string} text sentence to splice
 * @returns {string}
 */
function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The readable text of a thrown value, for quoting inside a wrapping message.
 *
 * `readCoverageRun` throws `Error`s, so the second arm is defensive rather
 * than reachable through it. It is exported and asserted directly in
 * tests/e2e-coverage-global-setup.test.mjs rather than left as an untested
 * branch: a `throw` of a non-Error would otherwise interpolate as `undefined`
 * and hide the very diagnosis this guard exists to produce.
 *
 * @param {unknown} cause thrown value to describe
 * @returns {string}
 */
export function causeMessage(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

export default async function globalSetup() {
  assertCoverageEnv();
  await assertCoverageRun();
  assertCoverageBuild();
}
