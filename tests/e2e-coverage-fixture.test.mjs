import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import {
  CoverageManager,
  coverageArtifactStem,
  coverageManagerFixture,
  isCoverageEnabled,
  newCoverageContext,
  newCoverageContextForTest,
  pageFixture,
} from './tools/e2e-coverage.cjs';
import { initCoverageRun } from './tools/e2e-coverage-run.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const e2eDir = join(repoRoot, 'tests/e2e');
const require = createRequire(import.meta.url);

function info(testId = 'fixture-test') {
  return {
    project: { name: 'chromium' },
    testId,
    workerIndex: 0,
    parallelIndex: 0,
    retry: 0,
  };
}

function fakePage({ result = [], startError, stopError } = {}) {
  let started = false;
  return {
    coverage: {
      async startJSCoverage() {
        if (startError) throw startError;
        started = true;
      },
      async stopJSCoverage() {
        if (!started) throw new Error('coverage was not started');
        if (stopError) throw stopError;
        return result;
      },
    },
  };
}

test('coverage mode is enabled only for the exact opt-in value', () => {
  assert.equal(isCoverageEnabled({ E2E_COVERAGE: '1' }), true);
  assert.equal(isCoverageEnabled({ E2E_COVERAGE: '0' }), false);
  assert.equal(isCoverageEnabled({ E2E_COVERAGE: '' }), false);
  assert.equal(isCoverageEnabled({}), false);
});

test('coverage artifact stems include every worker/test/page identity', () => {
  const stem = coverageArtifactStem({
    workerIndex: 2,
    parallelIndex: 1,
    retry: 3,
    testId: 'chromium/tests/e2e/smoke.spec.js:smoke',
    pageIndex: 4,
  });
  assert.match(stem, /^worker-2-parallel-1-retry-3-page-4-[a-f0-9]{16}$/);
});

test('every e2e spec imports the shared fixture outside tests/e2e', async () => {
  const files = (await readdir(e2eDir))
    .filter((file) => file.endsWith('.spec.js'))
    .sort();
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(join(e2eDir, file), 'utf8');
    assert.match(
      source,
      /from ['"]\.\.\/tools\/e2e-coverage\.cjs['"]/,
      `${file} must import the shared coverage fixture`,
    );
  }
});

test('manual contexts use the coverage-aware context adapter', async () => {
  for (const file of ['color-mode.spec.js', 'metrics-dashboard.spec.js']) {
    const source = await readFile(join(e2eDir, file), 'utf8');
    assert.doesNotMatch(source, /browser\.newContext\(/);
    assert.match(source, /newCoverageContext\(browser/);
  }
});

test('CoverageManager writes a raw artifact with source identity metadata', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'endusers-fixture-manager-'));
  try {
    await initCoverageRun(runDir, 'manager-1');
    const manager = new CoverageManager(info(), runDir, 'manager-1');
    await manager.verifyRun();
    const page = fakePage({
      result: [
        { url: 'http://localhost/app.js', functions: [], source: 'abc' },
        { url: 'http://localhost/other.js', functions: [] },
      ],
    });
    const record = await manager.startPage(page);
    assert.equal(await manager.startPage(page), record);
    await manager.stopPage(page);
    await manager.stopPage(page);
    const artifact = (await readdir(runDir)).find((name) =>
      name.startsWith('worker-'),
    );
    const payload = JSON.parse(await readFile(join(runDir, artifact), 'utf8'));
    assert.equal(payload.result[0].sourceLength, 3);
    assert.match(payload.result[0].sourceSha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('CoverageManager accepts JavaScript-disabled contexts as empty captures', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'endusers-fixture-empty-'));
  try {
    await initCoverageRun(runDir, 'empty-1');
    const manager = new CoverageManager(info(), runDir, 'empty-1');
    const page = fakePage();
    await manager.startPage(page, { empty: true });
    await manager.stopPage(page);
    const artifacts = (await readdir(runDir)).filter((name) =>
      name.startsWith('worker-'),
    );
    assert.equal(artifacts.length, 1);
    assert.deepEqual(
      JSON.parse(await readFile(join(runDir, artifacts[0]), 'utf8')).result,
      [],
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('CoverageManager flushes manual contexts and binds passthrough methods', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'endusers-fixture-context-'));
  try {
    await initCoverageRun(runDir, 'context-1');
    let closed = false;
    const context = {
      async newPage() {
        return fakePage();
      },
      ping() {
        return this === context;
      },
      async close() {
        closed = true;
      },
    };
    const manager = new CoverageManager(info(), runDir, 'context-1');
    const proxy = await manager.registerContext(context);
    assert.equal(proxy.ping(), true);
    await proxy.newPage();
    await proxy.close();
    await proxy.close();
    assert.equal(closed, true);

    let leakedClosed = false;
    const leakedContext = {
      async newPage() {
        return fakePage();
      },
      async close() {
        leakedClosed = true;
      },
    };
    const leakedProxy = await manager.registerContext(leakedContext);
    await leakedProxy.newPage();
    await manager.cleanup();
    assert.equal(leakedClosed, true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('CoverageManager writes honest error artifacts for start and stop failures', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'endusers-fixture-errors-'));
  try {
    await initCoverageRun(runDir, 'errors-1');
    const manager = new CoverageManager(info(), runDir, 'errors-1');
    await assert.rejects(() =>
      manager.startPage({
        coverage: {
          async startJSCoverage() {
            throw {};
          },
        },
      }),
    );
    await assert.rejects(
      () => manager.startPage({ coverage: {} }),
      (error) => {
        assert.equal(
          error.message,
          'Playwright JavaScript coverage is unavailable',
        );
        return true;
      },
    );
    const stopPage = fakePage({ stopError: new Error('stop failed') });
    await manager.startPage(stopPage);
    await assert.rejects(() => manager.stopPage(stopPage), /stop failed/);
    const errors = (await readdir(runDir)).filter((name) =>
      name.endsWith('-error.json'),
    );
    assert.equal(errors.length, 3);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('CoverageManager aggregates manual-context cleanup errors', async () => {
  const runDir = await mkdtemp(
    join(tmpdir(), 'endusers-fixture-context-errors-'),
  );
  try {
    await initCoverageRun(runDir, 'context-errors');
    const manager = new CoverageManager(info(), runDir, 'context-errors');
    const context = {
      async newPage() {
        return fakePage({ stopError: new Error('context stop failed') });
      },
      async close() {},
    };
    const proxy = await manager.registerContext(context);
    await proxy.newPage();
    await assert.rejects(
      () => proxy.close(),
      /failed to flush e2e coverage context/,
    );

    const cleanupManager = new CoverageManager(
      info(),
      runDir,
      'context-errors',
    );
    await cleanupManager.startPage(
      fakePage({ stopError: new Error('cleanup page failed') }),
    );
    await assert.rejects(
      () => cleanupManager.cleanup(),
      /failed to flush e2e coverage/,
    );

    const cleanupContextManager = new CoverageManager(
      info(),
      runDir,
      'context-errors',
    );
    const cleanupContext = await cleanupContextManager.registerContext({
      async newPage() {
        return fakePage({ stopError: new Error('cleanup context failed') });
      },
      async close() {},
    });
    await cleanupContext.newPage();
    await assert.rejects(
      () => cleanupContextManager.cleanup(),
      /failed to flush e2e coverage/,
    );

    const closeErrorManager = new CoverageManager(
      info(),
      runDir,
      'context-errors',
    );
    await closeErrorManager.registerContext({
      async close() {
        throw new Error('context close failed');
      },
    });
    await assert.rejects(
      () => closeErrorManager.cleanup(),
      /failed to flush e2e coverage/,
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('CoverageManager rejects mismatched and already-sealed manifests', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'endusers-fixture-manifest-'));
  try {
    await initCoverageRun(runDir, 'manifest-1');
    await assert.rejects(
      () => new CoverageManager(info(), runDir, 'other').verifyRun(),
      /does not match manifest manifest-1/,
    );
    const { sealCoverageRun } = await import('./tools/e2e-coverage-run.mjs');
    await sealCoverageRun(runDir, 'passed');
    await assert.rejects(
      () => new CoverageManager(info(), runDir, 'manifest-1').verifyRun(),
      /already sealed as passed/,
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('fixture adapters cover disabled and enabled cleanup paths', async () => {
  const previous = {
    coverage: process.env.E2E_COVERAGE,
    dir: process.env.E2E_COVERAGE_DIR,
    runId: process.env.E2E_COVERAGE_RUN_ID,
  };
  const restore = () => {
    for (const [key, value] of Object.entries({
      E2E_COVERAGE: previous.coverage,
      E2E_COVERAGE_DIR: previous.dir,
      E2E_COVERAGE_RUN_ID: previous.runId,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    delete process.env.E2E_COVERAGE;
    let disabledValue;
    await coverageManagerFixture(
      {},
      async (value) => {
        disabledValue = value;
      },
      info('disabled'),
    );
    assert.equal(disabledValue, null);

    const page = {};
    await pageFixture({ page, coverageManager: null }, async (value) => {
      assert.equal(value, page);
    });
    const calls = [];
    const fakeManager = {
      async startPage(value) {
        calls.push(['start', value]);
      },
      async stopPage(value) {
        calls.push(['stop', value]);
      },
    };
    await pageFixture({ page, coverageManager: fakeManager }, async (value) => {
      assert.equal(value, page);
    });
    assert.deepEqual(calls, [
      ['start', page],
      ['stop', page],
    ]);

    const runDir = await mkdtemp(join(tmpdir(), 'endusers-fixture-auto-'));
    await initCoverageRun(runDir, 'auto-1');
    process.env.E2E_COVERAGE = '1';
    process.env.E2E_COVERAGE_DIR = runDir;
    process.env.E2E_COVERAGE_RUN_ID = 'auto-1';
    let enabledValue;
    await coverageManagerFixture(
      {},
      async (value) => {
        enabledValue = value;
        assert.ok(value instanceof CoverageManager);
        const fakeContext = {
          async newPage() {
            return fakePage();
          },
          async close() {},
        };
        const proxy = await newCoverageContextForTest(
          {
            async newContext() {
              return fakeContext;
            },
          },
          {},
          info('enabled'),
        );
        await proxy.close();
        const wrapperProxy = await newCoverageContext(
          {
            async newContext() {
              return fakeContext;
            },
          },
          {},
          info('enabled'),
        );
        await wrapperProxy.close();
        const playwrightTest = require('@playwright/test').test;
        const originalInfo = playwrightTest.info;
        playwrightTest.info = () => info('enabled');
        try {
          const implicitInfoProxy = await newCoverageContext(
            {
              async newContext() {
                return fakeContext;
              },
            },
            {},
          );
          await implicitInfoProxy.close();
        } finally {
          playwrightTest.info = originalInfo;
        }
      },
      info('enabled'),
    );
    assert.ok(enabledValue);
    await rm(runDir, { recursive: true, force: true });

    process.env.E2E_COVERAGE = '1';
    delete process.env.E2E_COVERAGE_DIR;
    delete process.env.E2E_COVERAGE_RUN_ID;
    await assert.rejects(
      () => coverageManagerFixture({}, async () => {}, info('missing-run')),
      /E2E_COVERAGE_DIR and E2E_COVERAGE_RUN_ID are required/,
    );
    restore();
  } finally {
    restore();
  }
});

test('newCoverageContext preserves the default browser path when disabled', async () => {
  delete process.env.E2E_COVERAGE;
  const context = { marker: true };
  const browser = {
    async newContext(options) {
      return { context, options };
    },
  };
  assert.deepEqual(
    await newCoverageContextForTest(
      browser,
      { colorScheme: 'dark' },
      info('disabled-helper'),
    ),
    { context, options: { colorScheme: 'dark' } },
  );
  assert.deepEqual(await newCoverageContext(browser, { colorScheme: 'dark' }), {
    context,
    options: { colorScheme: 'dark' },
  });
});

test('newCoverageContextForTest covers enabled manager lookup and missing-manager errors', async () => {
  const runDir = await mkdtemp(
    join(tmpdir(), 'endusers-fixture-context-helper-'),
  );
  const previous = {
    coverage: process.env.E2E_COVERAGE,
    dir: process.env.E2E_COVERAGE_DIR,
    runId: process.env.E2E_COVERAGE_RUN_ID,
  };
  const restore = () => {
    for (const [key, value] of Object.entries({
      E2E_COVERAGE: previous.coverage,
      E2E_COVERAGE_DIR: previous.dir,
      E2E_COVERAGE_RUN_ID: previous.runId,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    await initCoverageRun(runDir, 'helper-1');
    process.env.E2E_COVERAGE = '1';
    process.env.E2E_COVERAGE_DIR = runDir;
    process.env.E2E_COVERAGE_RUN_ID = 'helper-1';
    await assert.rejects(
      () =>
        newCoverageContextForTest(
          { async newContext() {} },
          {},
          info('missing-manager'),
        ),
      /coverage manager is unavailable/,
    );
    await coverageManagerFixture(
      {},
      async () => {
        const context = {
          async close() {},
        };
        const proxy = await newCoverageContextForTest(
          {
            async newContext() {
              return context;
            },
          },
          {},
          info('helper-enabled'),
        );
        await proxy.close();
      },
      info('helper-enabled'),
    );
    restore();
  } finally {
    restore();
    await rm(runDir, { recursive: true, force: true });
  }
});
