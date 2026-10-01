const { createHash } = require('node:crypto');

const { test: baseTest, expect } = require('@playwright/test');

const managers = new Map();
const runModulePromise = import('./e2e-coverage-run.mjs');
const COVERAGE_ARTIFACT_KIND = 'endusers.playwright.v8-coverage';

function isCoverageEnabled(env = process.env) {
  return env.E2E_COVERAGE === '1';
}

function coverageArtifactStem({
  workerIndex,
  parallelIndex,
  retry,
  testId,
  pageIndex,
}) {
  const digest = createHash('sha256').update(testId).digest('hex').slice(0, 16);
  return `worker-${workerIndex}-parallel-${parallelIndex}-retry-${retry}-page-${pageIndex}-${digest}`;
}

function errorDetails(error) {
  return {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
  };
}

class CoverageManager {
  constructor(testInfo, runDir, runId) {
    this.testInfo = testInfo;
    this.runDir = runDir;
    this.runId = runId;
    this.pageIndex = 0;
    this.pages = new Map();
    this.contexts = new Map();
  }

  async runModule() {
    return runModulePromise;
  }

  async verifyRun() {
    const { readCoverageRun } = await this.runModule();
    const manifest = await readCoverageRun(this.runDir);
    if (manifest.runId !== this.runId) {
      throw new Error(
        `coverage runId ${this.runId} does not match manifest ${manifest.runId}`,
      );
    }
    if (manifest.status !== 'started') {
      throw new Error(
        `coverage run ${manifest.runId} is already sealed as ${manifest.status}`,
      );
    }
  }

  async writeError(pageInfo, error) {
    const { writeCoverageArtifact } = await this.runModule();
    const stem = `${coverageArtifactStem(pageInfo)}-error`;
    await writeCoverageArtifact(this.runDir, stem, {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage-error',
      runId: this.runId,
      project: this.testInfo.project.name,
      testId: this.testInfo.testId,
      workerIndex: this.testInfo.workerIndex,
      parallelIndex: this.testInfo.parallelIndex,
      retry: this.testInfo.retry,
      pageIndex: pageInfo.pageIndex,
      error: errorDetails(error),
    });
  }

  async startPage(page, { empty = false } = {}) {
    if (this.pages.has(page)) return this.pages.get(page);
    const info = {
      workerIndex: this.testInfo.workerIndex,
      parallelIndex: this.testInfo.parallelIndex,
      retry: this.testInfo.retry,
      testId: this.testInfo.testId,
      pageIndex: this.pageIndex,
    };
    this.pageIndex += 1;
    if (empty) {
      const record = { info, page, empty: true };
      this.pages.set(page, record);
      return record;
    }
    try {
      if (typeof page.coverage?.startJSCoverage !== 'function') {
        throw new Error('Playwright JavaScript coverage is unavailable');
      }
      await page.coverage.startJSCoverage({
        reportAnonymousScripts: false,
        resetOnNavigation: false,
      });
    } catch (error) {
      await this.writeError(info, error);
      throw error;
    }
    const record = { info, page };
    this.pages.set(page, record);
    return record;
  }

  async stopPage(page) {
    const record = this.pages.get(page);
    if (!record) return;
    try {
      const result = record.empty ? [] : await page.coverage.stopJSCoverage();
      const normalized = result.map(({ source, ...script }) => ({
        ...script,
        ...(source === undefined
          ? {}
          : {
              sourceLength: source.length,
              sourceSha256: createHash('sha256').update(source).digest('hex'),
            }),
      }));
      const { writeCoverageArtifact } = await this.runModule();
      await writeCoverageArtifact(
        this.runDir,
        coverageArtifactStem(record.info),
        {
          schemaVersion: 1,
          kind: COVERAGE_ARTIFACT_KIND,
          runId: this.runId,
          project: this.testInfo.project.name,
          testId: this.testInfo.testId,
          workerIndex: this.testInfo.workerIndex,
          parallelIndex: this.testInfo.parallelIndex,
          retry: this.testInfo.retry,
          pageIndex: record.info.pageIndex,
          result: normalized,
        },
      );
      this.pages.delete(page);
    } catch (error) {
      record.lastError = error;
      if (!record.errorArtifactWritten) {
        await this.writeError(record.info, error);
        record.errorArtifactWritten = true;
      }
      throw error;
    }
  }

  async registerContext(context, options = {}) {
    const record = {
      context,
      pages: new Set(),
      closed: false,
      empty: options.javaScriptEnabled === false,
    };
    this.contexts.set(context, record);
    const manager = this;
    return new Proxy(context, {
      get(target, property) {
        if (property === 'newPage') {
          return async (...args) => {
            const page = await target.newPage(...args);
            record.pages.add(page);
            await manager.startPage(page, { empty: record.empty });
            return page;
          };
        }
        if (property === 'close') {
          return async (...args) => {
            return manager.stopContext(record, args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  async stopContext(record, closeArgs = []) {
    if (record.closed) return;
    const errors = [];
    for (const page of record.pages) {
      try {
        await this.stopPage(page);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await record.context.close(...closeArgs);
    } catch (error) {
      errors.push(error);
    }
    record.closed = true;
    this.contexts.delete(record.context);
    if (errors.length > 0) {
      throw new AggregateError(errors, 'failed to flush e2e coverage context');
    }
  }

  async cleanup() {
    const errors = [];
    for (const page of [...this.pages.keys()]) {
      try {
        await this.stopPage(page);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const record of [...this.contexts.values()]) {
      try {
        await this.stopContext(record);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'failed to flush e2e coverage');
    }
  }
}

async function createManager(testInfo) {
  const runDir = process.env.E2E_COVERAGE_DIR;
  const runId = process.env.E2E_COVERAGE_RUN_ID;
  if (!runDir || !runId) {
    throw new Error(
      'E2E_COVERAGE_DIR and E2E_COVERAGE_RUN_ID are required when E2E_COVERAGE=1',
    );
  }
  const manager = new CoverageManager(testInfo, runDir, runId);
  await manager.verifyRun();
  return manager;
}

async function coverageManagerFixture({}, use, testInfo) {
  if (!isCoverageEnabled()) {
    await use(null);
    return;
  }
  const manager = await createManager(testInfo);
  managers.set(testInfo.testId, manager);
  try {
    await use(manager);
  } finally {
    managers.delete(testInfo.testId);
    await manager.cleanup();
  }
}

async function pageFixture({ page, coverageManager }, use) {
  if (!coverageManager) {
    await use(page);
    return;
  }
  await coverageManager.startPage(page);
  try {
    await use(page);
  } finally {
    await coverageManager.stopPage(page);
  }
}

async function newCoverageContextForTest(browser, options, testInfo) {
  if (!isCoverageEnabled()) return browser.newContext(options);
  const manager = managers.get(testInfo.testId);
  if (!manager) {
    throw new Error('coverage manager is unavailable outside an active test');
  }
  const context = await browser.newContext(options);
  return manager.registerContext(context, options);
}

async function newCoverageContext(browser, options = {}, testInfoOverride) {
  if (!isCoverageEnabled()) return browser.newContext(options);
  return newCoverageContextForTest(
    browser,
    options,
    testInfoOverride ?? baseTest.info(),
  );
}

exports.coverageArtifactStem = coverageArtifactStem;
exports.CoverageManager = CoverageManager;
exports.coverageManagerFixture = coverageManagerFixture;
exports.expect = expect;
exports.isCoverageEnabled = isCoverageEnabled;
exports.newCoverageContext = newCoverageContext;
exports.newCoverageContextForTest = newCoverageContextForTest;
exports.pageFixture = pageFixture;
exports.test = baseTest.extend({
  coverageManager: [coverageManagerFixture, { auto: true }],
  page: pageFixture,
});
