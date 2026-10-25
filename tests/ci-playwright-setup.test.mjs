// The browser the end-to-end suite needs, pinned against the workflows that
// run that suite in CI.
//
// Playwright ships the browser bundle and the OS packages it needs to launch
// as two separate installs, and `actions/cache` restores only the first of
// them: the packages live in the runner image, which the cache never touches.
// A job that caches the bundle and installs the packages only on a cache miss
// therefore launches nothing on every later run, and the failure names neither
// the missing library nor the skipped step -- Playwright reports
// "Target page, context or browser has been closed", which is why
// tests/contributing-e2e-setup.test.mjs:44-51 already records that symptom.
// `.github/workflows/ci.yml` gets this right today in both Playwright jobs,
// and its own comment ("The cache restores the browser bundle but not the OS
// packages it needs, which do not persist across runner images") states the
// rule; nothing holds a third job, or an edit to either of these two, to it.
//
// The second contract is the cache key. The key decides when the bundle is
// re-downloaded, so a key that does not move when `@playwright/test` moves
// restores the previous release's browser and skips the install that would
// have replaced it -- the new Playwright then drives an old binary, which is
// the failure the version-resolution step in both jobs exists to prevent.
//
// Both scanners are driven twice: over the real `.github/workflows/**` tree,
// which must be clean, and over synthetic documents that do offend, so a
// scanner that stopped detecting cannot leave the contract green.

import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'yaml';

import {
  jobEntries,
  loadWorkflows as readWorkflows,
  walkSteps,
} from './helpers-workflows.mjs';

// A job's steps with local composite actions expanded in place, so a cache or
// install step moved into .github/actions/<name>/action.yml stays in scope.
function expandedSteps(job) {
  return [...walkSteps(job)].map(({ step }) => step);
}

function runOf(step) {
  return typeof step?.run === 'string' ? step.run : '';
}

// A job "runs Playwright" when it invokes the suite, not when it merely
// installs the browser: an install-only job has nothing to launch and so
// needs no system packages.
function runsPlaywrightSuite(job) {
  return expandedSteps(job).some((step) =>
    /\bnpm run test:e2e\b|\bnpx playwright test\b|\bplaywright test\b/.test(
      runOf(step),
    ),
  );
}

function browserCacheStep(job) {
  return expandedSteps(job).find((step) => {
    if (!/actions\/cache@/.test(step?.uses ?? '')) return false;
    return /ms-playwright/.test(String(step?.with?.path ?? ''));
  });
}

// `playwright install --with-deps` and `playwright install-deps` are the only
// two subcommands that install the OS packages; a bare `playwright install`
// is the browser bundle alone.
function installsSystemPackages(step) {
  const run = runOf(step);
  if (/\bplaywright install-deps\b/.test(run)) return true;
  return /\bplaywright install\b(?!-deps)[^\n]*--with-deps/.test(run);
}

// Which side of the cache a step runs on, read from its `if`. A step with no
// condition runs on both. An unrecognised condition is reported as covering
// neither: a contract that guessed would go quiet exactly when the guard was
// rewritten into a form it no longer understands.
function cacheBranchesCovered(step, cacheStepId) {
  const condition = step?.if;
  if (condition === undefined) return ['hit', 'miss'];
  const text = String(condition);
  if (!text.includes(`steps.${cacheStepId}.outputs.cache-hit`)) return [];
  if (/cache-hit\s*!=/.test(text)) return ['miss'];
  if (/cache-hit\s*==/.test(text)) return ['hit'];
  return [];
}

export function playwrightSystemPackageGaps(workflows) {
  const gaps = [];
  for (const { name, doc } of workflows) {
    for (const [jobName, job] of jobEntries(doc)) {
      if (!runsPlaywrightSuite(job)) continue;
      const installers = expandedSteps(job).filter(installsSystemPackages);
      const cacheStep = browserCacheStep(job);

      // Without a cache every run takes the same path, so one unconditional
      // installer is the whole requirement.
      if (!cacheStep) {
        if (!installers.some((step) => step.if === undefined)) {
          gaps.push(
            `${name} (${jobName}): runs the Playwright suite without installing its system packages`,
          );
        }
        continue;
      }

      if (!cacheStep.id) {
        gaps.push(
          `${name} (${jobName}): the Playwright browser cache step has no id, so no install step can be guarded on its outcome`,
        );
        continue;
      }

      const covered = new Set(
        installers.flatMap((step) => cacheBranchesCovered(step, cacheStep.id)),
      );
      for (const branch of ['hit', 'miss']) {
        if (covered.has(branch)) continue;
        gaps.push(
          `${name} (${jobName}): nothing installs Playwright's system packages on a cache ${branch}`,
        );
      }
    }
  }
  return gaps;
}

export function versionlessBrowserCacheKeys(workflows) {
  const offences = [];
  for (const { name, doc } of workflows) {
    for (const [jobName, job] of jobEntries(doc)) {
      const cacheStep = browserCacheStep(job);
      if (!cacheStep) continue;
      const key = String(cacheStep.with?.key ?? '');
      // `runner.os` changes with the image, not with the dependency, so it
      // cannot stand in for the version.
      const expressions = (key.match(/\$\{\{([\s\S]*?)\}\}/g) ?? []).filter(
        (expression) => !/\brunner\.os\b/.test(expression),
      );
      if (expressions.length === 0) {
        offences.push(
          `${name} (${jobName}): the Playwright browser cache key never changes when @playwright/test does: ${key.replace(/\s+/g, ' ').trim()}`,
        );
      }
    }
  }
  return offences;
}

test("every job that runs the Playwright suite installs the browser's system packages on both cache branches", () => {
  const workflows = readWorkflows();
  const playwrightJobs = workflows.flatMap(({ name, doc }) =>
    jobEntries(doc)
      .filter(([, job]) => runsPlaywrightSuite(job))
      .map(([jobName]) => `${name} (${jobName})`),
  );
  assert.ok(
    playwrightJobs.length > 0,
    'no workflow runs the Playwright suite any more; this contract has nothing left to check',
  );

  assert.deepEqual(playwrightSystemPackageGaps(workflows), []);
});

test('every cached Playwright browser bundle is keyed on something that moves with the dependency', () => {
  const workflows = readWorkflows();
  const cachingJobs = workflows.flatMap(({ name, doc }) =>
    jobEntries(doc)
      .filter(([, job]) => browserCacheStep(job))
      .map(([jobName]) => `${name} (${jobName})`),
  );
  assert.ok(
    cachingJobs.length > 0,
    'no workflow caches the Playwright browser bundle any more; this contract has nothing left to check',
  );

  assert.deepEqual(versionlessBrowserCacheKeys(workflows), []);
});

// The synthetic half. Each document below is a workflow this contract must
// reject, so the two scanners above cannot pass by failing to look.

function synthetic(yaml) {
  return [{ name: 'synthetic.yml', doc: parse(yaml) }];
}

test('a cached bundle with no install on the hit branch is reported', () => {
  const workflows = synthetic(`
jobs:
  e2e:
    steps:
      - id: cache
        uses: actions/cache@0000000000000000000000000000000000000000
        with:
          path: ~/.cache/ms-playwright
          key: playwright-\${{ runner.os }}-\${{ steps.v.outputs.version }}
      - if: steps.cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
`);
  assert.deepEqual(playwrightSystemPackageGaps(workflows), [
    "synthetic.yml (e2e): nothing installs Playwright's system packages on a cache hit",
  ]);
});

test('a bare browser install satisfies neither branch', () => {
  const workflows = synthetic(`
jobs:
  e2e:
    steps:
      - id: cache
        uses: actions/cache@0000000000000000000000000000000000000000
        with:
          path: ~/.cache/ms-playwright
          key: playwright-\${{ steps.v.outputs.version }}
      - run: npx playwright install chromium
      - run: npm run test:e2e
`);
  assert.deepEqual(playwrightSystemPackageGaps(workflows), [
    "synthetic.yml (e2e): nothing installs Playwright's system packages on a cache hit",
    "synthetic.yml (e2e): nothing installs Playwright's system packages on a cache miss",
  ]);
});

test('an uncached job needs one unconditional install', () => {
  const missing = synthetic(`
jobs:
  e2e:
    steps:
      - if: github.event_name == 'push'
        run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
`);
  assert.deepEqual(playwrightSystemPackageGaps(missing), [
    'synthetic.yml (e2e): runs the Playwright suite without installing its system packages',
  ]);

  const present = synthetic(`
jobs:
  e2e:
    steps:
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
`);
  assert.deepEqual(playwrightSystemPackageGaps(present), []);
});

test('a cache step without an id cannot be guarded on, and is reported once', () => {
  const workflows = synthetic(`
jobs:
  e2e:
    steps:
      - uses: actions/cache@0000000000000000000000000000000000000000
        with:
          path: ~/.cache/ms-playwright
          key: playwright-\${{ steps.v.outputs.version }}
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
`);
  assert.deepEqual(playwrightSystemPackageGaps(workflows), [
    'synthetic.yml (e2e): the Playwright browser cache step has no id, so no install step can be guarded on its outcome',
  ]);
});

test('an install guarded on an unrecognised condition covers neither branch', () => {
  const workflows = synthetic(`
jobs:
  e2e:
    steps:
      - id: cache
        uses: actions/cache@0000000000000000000000000000000000000000
        with:
          path: ~/.cache/ms-playwright
          key: playwright-\${{ steps.v.outputs.version }}
      - if: steps.other.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
`);
  assert.deepEqual(playwrightSystemPackageGaps(workflows), [
    "synthetic.yml (e2e): nothing installs Playwright's system packages on a cache hit",
    "synthetic.yml (e2e): nothing installs Playwright's system packages on a cache miss",
  ]);
});

test('a job that only installs the browser is not held to the suite contract', () => {
  const workflows = synthetic(`
jobs:
  warm-cache:
    steps:
      - run: npx playwright install chromium
`);
  assert.deepEqual(playwrightSystemPackageGaps(workflows), []);
});

test('a constant browser cache key is reported, and runner.os alone does not rescue it', () => {
  const constant = synthetic(`
jobs:
  e2e:
    steps:
      - id: cache
        uses: actions/cache@0000000000000000000000000000000000000000
        with:
          path: ~/.cache/ms-playwright
          key: playwright-browsers
`);
  assert.deepEqual(versionlessBrowserCacheKeys(constant), [
    'synthetic.yml (e2e): the Playwright browser cache key never changes when @playwright/test does: playwright-browsers',
  ]);

  const osOnly = synthetic(`
jobs:
  e2e:
    steps:
      - id: cache
        uses: actions/cache@0000000000000000000000000000000000000000
        with:
          path: ~/.cache/ms-playwright
          key: playwright-\${{ runner.os }}
`);
  assert.deepEqual(versionlessBrowserCacheKeys(osOnly), [
    'synthetic.yml (e2e): the Playwright browser cache key never changes when @playwright/test does: playwright-${{ runner.os }}',
  ]);
});

test('a key hashing package-lock.json satisfies the version contract', () => {
  const workflows = synthetic(`
jobs:
  e2e:
    steps:
      - id: cache
        uses: actions/cache@0000000000000000000000000000000000000000
        with:
          path: ~/.cache/ms-playwright
          key: playwright-\${{ hashFiles('package-lock.json') }}
`);
  assert.deepEqual(versionlessBrowserCacheKeys(workflows), []);
});

test('a cache of something other than the browser bundle is out of scope', () => {
  const workflows = synthetic(`
jobs:
  e2e:
    steps:
      - id: cache
        uses: actions/cache@0000000000000000000000000000000000000000
        with:
          path: ~/.npm
          key: npm-cache
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
`);
  assert.deepEqual(versionlessBrowserCacheKeys(workflows), []);
  assert.deepEqual(playwrightSystemPackageGaps(workflows), []);
});
