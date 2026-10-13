// tests/tools/e2e-coverage-global-setup.mjs is the fail-fast half of the
// coverage-run precheck. The per-test fixture in tests/tools/e2e-coverage.cjs
// is the authoritative one, but it runs inside the coverage fixture, so a run
// started without E2E_COVERAGE_DIR and E2E_COVERAGE_RUN_ID -- or against a
// directory holding no usable run -- reports the same error once per test
// after paying for the browser launch and the static server.
//
// Three things have to hold for the fail-fast guard to be worth having, and
// all are asserted here rather than left to the e2e job to discover:
//
//   1. it turns on for exactly the environments the fixture turns on for --
//      a guard that fired more eagerly would break `npm run test:e2e`, and one
//      that fired less eagerly would be dead code;
//   2. it rejects the same run manifests `CoverageManager.verifyRun` rejects,
//      so hoisting the diagnosis cannot start failing a run the fixture would
//      have accepted; and
//   3. playwright.config.js actually wires it up, at a path that resolves.
//
// The fixture's own messages are asserted in tests/e2e-coverage-fixture.test.mjs;
// this file does not restate them, only that the two guards agree on *when*.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

import globalSetup, {
  assertCoverageEnv,
  assertCoverageRun,
  causeMessage,
  REQUIRED_COVERAGE_ENV,
} from './tools/e2e-coverage-global-setup.mjs';
import { initCoverageRun, sealCoverageRun } from './tools/e2e-coverage-run.mjs';

const require = createRequire(import.meta.url);
const {
  CoverageManager,
  isCoverageEnabled,
} = require('./tools/e2e-coverage.cjs');

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const VALID = {
  E2E_COVERAGE: '1',
  E2E_COVERAGE_DIR: 'coverage/e2e/local-1',
  E2E_COVERAGE_RUN_ID: 'local-1',
};

/**
 * Seeds a started coverage run in a scratch directory, removed on test end.
 *
 * @param {import('node:test').TestContext} t test context to register cleanup
 * @param {string} runId run id to seed
 * @returns {Promise<{ runDir: string, env: NodeJS.ProcessEnv }>}
 */
async function seedRun(t, runId = 'local-1') {
  const base = await mkdtemp(join(tmpdir(), 'e2e-coverage-setup-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const runDir = join(base, 'run');
  await initCoverageRun(runDir, runId);
  return {
    runDir,
    env: {
      E2E_COVERAGE: '1',
      E2E_COVERAGE_DIR: runDir,
      E2E_COVERAGE_RUN_ID: runId,
    },
  };
}

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

test('the default export is the guard, reading the live environment', async () => {
  // `globalSetup` takes no arguments and lets both checks default to
  // `process.env`. The unit suite runs without E2E_COVERAGE, so this is the
  // inert path; every throwing case is driven through `assertCoverageEnv` and
  // `assertCoverageRun` above with an explicit environment, rather than by
  // mutating this process's. The wiring under a real coverage environment is
  // the e2e job's to exercise.
  assert.equal(isCoverageEnabled(process.env), false);
  await assert.doesNotReject(() => globalSetup());
});

test('the manifest check is inert whenever coverage is off', async (t) => {
  // Guards the same boundary the env check has: a run of `npm run test:e2e`
  // names no run directory, and must not be made to read one.
  const { runDir } = await seedRun(t);
  for (const env of [{}, { E2E_COVERAGE: '0', E2E_COVERAGE_DIR: runDir }]) {
    assert.equal(isCoverageEnabled(env), false);
    await assert.doesNotReject(() => assertCoverageRun(env));
  }
});

test('accepts a freshly seeded run', async (t) => {
  const { env } = await seedRun(t);
  await assert.doesNotReject(() => assertCoverageRun(env));
});

test('rejects a directory that was never seeded', async (t) => {
  const { runDir, env } = await seedRun(t);
  const missing = join(runDir, 'nope');
  await assert.rejects(
    () => assertCoverageRun({ ...env, E2E_COVERAGE_DIR: missing }),
    (error) => {
      assert.match(error.message, /no readable coverage run manifest/);
      assert.ok(error.message.includes(missing));
      // The reader is sent to `init`, which is what the directory lacks.
      assert.match(error.message, /e2e-coverage-run\.mjs init/);
      return true;
    },
  );
});

test('rejects a manifest that no longer parses, keeping the cause', async (t) => {
  const { runDir, env } = await seedRun(t);
  await writeFile(join(runDir, 'manifest.json'), '{ not json', 'utf8');
  await assert.rejects(
    () => assertCoverageRun(env),
    (error) => {
      assert.match(error.message, /no readable coverage run manifest/);
      // The distinction between "absent" and "corrupt" stays available even
      // though the remedy is the same, so a reader is not left guessing.
      assert.ok(error.cause instanceof Error);
      return true;
    },
  );
});

test('rejects a run id that does not match the manifest', async (t) => {
  const { runDir, env } = await seedRun(t, 'local-1');
  await assert.rejects(
    () => assertCoverageRun({ ...env, E2E_COVERAGE_RUN_ID: 'local-2' }),
    (error) => {
      // Both ids are named: which one is wrong is the reader's to decide.
      assert.match(error.message, /E2E_COVERAGE_RUN_ID local-2/);
      assert.match(error.message, /names local-1/);
      assert.ok(error.message.includes(runDir));
      return true;
    },
  );
});

test('rejects a run that has already been sealed, naming the status', async (t) => {
  // The reachable case: the documented flow seals the run after the suite, so
  // re-running `npm run test:e2e:coverage` against the same $RUN_DIR lands
  // here. Before this guard that was one failure per test in the whole suite.
  for (const status of ['passed', 'failed', 'cancelled', 'tooling-error']) {
    const { runDir, env } = await seedRun(t, `local-${status}`);
    await sealCoverageRun(runDir, status);
    await assert.rejects(
      () => assertCoverageRun(env),
      (error) => {
        assert.match(error.message, new RegExp(`already sealed as ${status}`));
        assert.ok(error.message.includes(runDir));
        // A sealed run is immutable, so the remedy is a new directory rather
        // than deleting the manifest in place.
        assert.match(error.message, /fresh run directory/);
        return true;
      },
    );
  }
});

test('rejects every run state CoverageManager.verifyRun rejects', async (t) => {
  // Item 2 of the header: hoisting the diagnosis must not change the verdict.
  // The fixture's own check is driven directly -- `verifyRun` reads only the
  // run directory and run id it was constructed with -- so neither guard can
  // start accepting a run the other refuses.
  const cases = [
    { runId: 'local-1', seal: null, rejects: false },
    { runId: 'local-2', seal: null, rejects: true },
    { runId: 'local-1', seal: 'passed', rejects: true },
  ];
  for (const { runId, seal, rejects } of cases) {
    const { runDir, env } = await seedRun(t, 'local-1');
    if (seal) await sealCoverageRun(runDir, seal);
    const manager = new CoverageManager(null, runDir, runId);
    const setupEnv = { ...env, E2E_COVERAGE_RUN_ID: runId };
    if (rejects) {
      await assert.rejects(() => manager.verifyRun());
      await assert.rejects(() => assertCoverageRun(setupEnv));
    } else {
      await assert.doesNotReject(() => manager.verifyRun());
      await assert.doesNotReject(() => assertCoverageRun(setupEnv));
    }
  }
});

test('describes a thrown cause whether or not it is an Error', () => {
  // The non-Error arm is unreachable through `readCoverageRun`, which throws
  // `Error`s. It is asserted here rather than left untested because the arm
  // exists to stop a stray `throw` from interpolating as `undefined` and
  // swallowing the diagnosis.
  assert.equal(causeMessage(new Error('boom')), 'boom');
  assert.equal(causeMessage('boom'), 'boom');
  assert.equal(causeMessage(undefined), 'undefined');
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
