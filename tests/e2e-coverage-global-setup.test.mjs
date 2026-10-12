// tests/tools/e2e-coverage-global-setup.mjs is the fail-fast half of the
// coverage-run env check. The per-test fixture in tests/tools/e2e-coverage.cjs
// is the authoritative one -- it also verifies the run manifest -- but it runs
// inside the coverage fixture, so a run started without E2E_COVERAGE_DIR and
// E2E_COVERAGE_RUN_ID reports the same error once per test after paying for
// the browser launch and the static server.
//
// Two things have to hold for the fail-fast guard to be worth having, and both
// are asserted here rather than left to the e2e job to discover:
//
//   1. it turns on for exactly the environments the fixture turns on for --
//      a guard that fired more eagerly would break `npm run test:e2e`, and one
//      that fired less eagerly would be dead code; and
//   2. playwright.config.js actually wires it up, at a path that resolves.
//
// The fixture's own message is asserted in tests/e2e-coverage-fixture.test.mjs;
// this file does not restate it, only that the two guards agree on *when*.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import globalSetup, {
  assertCoverageEnv,
  REQUIRED_COVERAGE_ENV,
} from './tools/e2e-coverage-global-setup.mjs';

const require = createRequire(import.meta.url);
const { isCoverageEnabled } = require('./tools/e2e-coverage.cjs');

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const VALID = {
  E2E_COVERAGE: '1',
  E2E_COVERAGE_DIR: 'coverage/e2e/local-1',
  E2E_COVERAGE_RUN_ID: 'local-1',
};

test('names the two variables the coverage fixture requires', () => {
  assert.deepEqual(REQUIRED_COVERAGE_ENV, [
    'E2E_COVERAGE_DIR',
    'E2E_COVERAGE_RUN_ID',
  ]);
});

test('passes when coverage is on and both variables are set', () => {
  assert.doesNotThrow(() => assertCoverageEnv({ ...VALID }));
});

test('is inert whenever coverage is off, however empty the environment', () => {
  // The ordinary `npm run test:e2e` path. Asserted against the fixture's own
  // predicate so this guard cannot start firing for a run that captures no
  // coverage and therefore needs no run directory.
  for (const env of [{}, { E2E_COVERAGE: '0' }, { E2E_COVERAGE: 'true' }]) {
    assert.equal(isCoverageEnabled(env), false);
    assert.doesNotThrow(() => assertCoverageEnv(env));
  }
});

test('reports each missing variable by name, and only the missing ones', () => {
  const cases = [
    { omit: ['E2E_COVERAGE_DIR'], present: 'E2E_COVERAGE_RUN_ID' },
    { omit: ['E2E_COVERAGE_RUN_ID'], present: 'E2E_COVERAGE_DIR' },
  ];
  for (const { omit, present } of cases) {
    const env = { ...VALID };
    for (const name of omit) delete env[name];
    assert.throws(
      () => assertCoverageEnv(env),
      (error) => {
        assert.match(error.message, new RegExp(`${omit[0]} is not set`));
        // The variable that *is* set must not be named, or the message sends
        // the reader to fix something that is already correct.
        assert.ok(!error.message.includes(`${present} `));
        return true;
      },
    );
  }
});

test('names both variables when both are absent', () => {
  assert.throws(
    () => assertCoverageEnv({ E2E_COVERAGE: '1' }),
    /E2E_COVERAGE_DIR and E2E_COVERAGE_RUN_ID are not set/,
  );
});

test('treats an empty value as missing', () => {
  // The fixture's check is falsy-based (`if (!runDir || !runId)`), so an empty
  // string fails there. Accepting it here would report success and then fail
  // once per test, which is the outcome this guard exists to prevent.
  assert.throws(
    () => assertCoverageEnv({ ...VALID, E2E_COVERAGE_DIR: '' }),
    /E2E_COVERAGE_DIR is not set/,
  );
});

test('points the reader at the documented invocation and the opt-out', () => {
  assert.throws(
    () => assertCoverageEnv({ E2E_COVERAGE: '1' }),
    (error) => {
      assert.match(error.message, /e2e-coverage-run\.mjs init/);
      assert.match(error.message, /npm run test:e2e:coverage/);
      assert.match(error.message, /unset E2E_COVERAGE/);
      return true;
    },
  );
});

test('the default export is the guard, reading the live environment', () => {
  // `globalSetup` takes no arguments and lets `assertCoverageEnv` default to
  // `process.env`. The unit suite runs without E2E_COVERAGE, so this is the
  // inert path; every throwing case is driven through `assertCoverageEnv`
  // above with an explicit environment, rather than by mutating this
  // process's. The wiring under a real coverage environment is the e2e job's
  // to exercise.
  assert.equal(isCoverageEnabled(process.env), false);
  assert.doesNotThrow(() => globalSetup());
});

test('playwright.config.js wires the guard up at a path that exists', async () => {
  const suffix = `?load=${Math.random()}`;
  const config = (await import(`../playwright.config.js${suffix}`)).default;
  assert.equal(
    config.globalSetup,
    './tests/tools/e2e-coverage-global-setup.mjs',
  );
  // Playwright resolves globalSetup against the config's directory, which is
  // the repository root. A typo here would only surface in the e2e job.
  assert.ok(existsSync(resolve(repoRoot, config.globalSetup)));
});
