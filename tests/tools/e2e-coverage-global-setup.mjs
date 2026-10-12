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
// This does not replace the fixture's guard and is not a place to relax it:
// the fixture also verifies the run manifest, and a worker process can be
// handed a different environment than the one that loaded the config. This
// only moves the *diagnosis* of the common case ahead of the work.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isCoverageEnabled } = require('./e2e-coverage.cjs');

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
    } not set, so the run has nowhere to write coverage artifacts. Seed a run ` +
      'directory and export both, as CONTRIBUTING.md "Browser source ' +
      'coverage" shows:\n' +
      '  RUN_ID="local-$(date +%s)"\n' +
      '  RUN_DIR="coverage/e2e/$RUN_ID"\n' +
      '  node tests/tools/e2e-coverage-run.mjs init --dir "$RUN_DIR" --run-id "$RUN_ID"\n' +
      '  E2E_COVERAGE_DIR="$RUN_DIR" E2E_COVERAGE_RUN_ID="$RUN_ID" npm run test:e2e:coverage\n' +
      'To run the suite without capturing coverage, unset E2E_COVERAGE.',
  );
}

export default function globalSetup() {
  assertCoverageEnv();
}
