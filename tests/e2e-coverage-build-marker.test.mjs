// Pins the guard that refuses an e2e coverage run against a site which was
// not built with E2E_COVERAGE=1.
//
// The reporter already fails such a run — `collectE2ECoverage` raises "No
// src/** coverage was attributable" — but only once the whole suite has run.
// The ordering matters: the specs take minutes, and the message names the
// symptom (nothing could be attributed) rather than the cause (the site being
// served is a plain production build).
//
// Reaching that state is easy rather than exotic. `playwright.config.js` sets
// `reuseExistingServer: !process.env.CI`, so a `docusaurus serve` left running
// from an earlier `npm run build` is adopted silently; and CONTRIBUTING.md's
// "Browser source coverage" recipe has a separate `npm run build:e2e:coverage`
// step that a reader can skip while the rest of the commands still succeed.
//
// The markers asserted below are the two artifacts docusaurus.config.js
// registers behind `E2E_COVERAGE === '1'`: the source maps the attribution
// needs (endusers-e2e-source-maps sets `devtool: 'source-map'`) and the
// `e2e-coverage-fixtures/` docs instance the fixture-only specs request.
//
// `coverageBuildProblem` is a pure function of a path, so every arm below is
// driven against a temporary directory. A guard whose failing arms nobody has
// seen fail is indistinguishable from one that cannot fail.

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_BUILD_DIR,
  assertCoverageBuild,
  coverageBuildProblem,
} from './tools/e2e-coverage-global-setup.mjs';

const COVERAGE_ON = { E2E_COVERAGE: '1' };

/**
 * Runs `body` against a fresh temporary directory, removed afterwards.
 *
 * @param {(dir: string) => Promise<void>} body receives the directory path
 * @returns {Promise<void>}
 */
async function withTempDir(body) {
  const dir = await mkdtemp(join(tmpdir(), 'endusers-e2e-build-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Builds a directory carrying both coverage-build markers.
 *
 * @param {string} dir directory to populate
 * @param {{ fixtures?: boolean, sourceMap?: boolean }} [parts] markers to write
 * @returns {Promise<string>} the populated directory
 */
async function makeBuild(dir, parts = {}) {
  const { fixtures = true, sourceMap = true } = parts;
  const bundleDir = join(dir, 'assets', 'js');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'main.abc123.js'), '//\n');
  if (sourceMap) {
    await writeFile(join(bundleDir, 'main.abc123.js.map'), '{}\n');
  }
  if (fixtures) {
    await mkdir(join(dir, 'e2e-coverage-fixtures'), { recursive: true });
  }
  return dir;
}

test('a coverage build reports no problem', async () => {
  await withTempDir(async (dir) => {
    await makeBuild(dir);
    assert.equal(coverageBuildProblem(dir), null);
  });
});

test('a missing build directory is reported as unbuilt', async () => {
  await withTempDir(async (dir) => {
    const absent = join(dir, 'build');
    assert.match(coverageBuildProblem(absent), /no site has been built at/);
  });
});

// `existsSync` alone would accept this, which is why the guard stats the path.
test('a build path that is a file is reported as unbuilt', async () => {
  await withTempDir(async (dir) => {
    const asFile = join(dir, 'build');
    await writeFile(asFile, 'not a directory\n');
    assert.match(coverageBuildProblem(asFile), /no site has been built at/);
  });
});

test('a build without the fixture docs route is reported as a plain build', async () => {
  await withTempDir(async (dir) => {
    await makeBuild(dir, { fixtures: false });
    assert.match(
      coverageBuildProblem(dir),
      /no e2e-coverage-fixtures\/ route, so it was built without E2E_COVERAGE=1/,
    );
  });
});

// Ordered after the route check, so this arm needs the route present.
test('a build without source maps is reported as unmappable', async () => {
  await withTempDir(async (dir) => {
    await makeBuild(dir, { sourceMap: false });
    assert.match(coverageBuildProblem(dir), /ships no assets\/js\/\*\.js\.map/);
  });
});

test('a build with no client bundle directory at all is unmappable', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'e2e-coverage-fixtures'), { recursive: true });
    assert.match(coverageBuildProblem(dir), /ships no assets\/js\/\*\.js\.map/);
  });
});

test('assertCoverageBuild is inert while coverage is off', async () => {
  await withTempDir(async (dir) => {
    // The directory is empty, so the guard would object if it ran at all.
    assert.doesNotThrow(() => assertCoverageBuild({}, dir));
    assert.doesNotThrow(() => assertCoverageBuild({ E2E_COVERAGE: '0' }, dir));
  });
});

test('assertCoverageBuild accepts a coverage build', async () => {
  await withTempDir(async (dir) => {
    await makeBuild(dir);
    assert.doesNotThrow(() => assertCoverageBuild(COVERAGE_ON, dir));
  });
});

test('assertCoverageBuild sends a failing run to the documented build command', async () => {
  await withTempDir(async (dir) => {
    await makeBuild(dir, { fixtures: false });
    assert.throws(
      () => assertCoverageBuild(COVERAGE_ON, dir),
      (error) => {
        assert.match(error.message, /^E2E_COVERAGE=1 but /);
        assert.match(error.message, /npm run build:e2e:coverage/);
        assert.match(
          error.message,
          /To run the suite without capturing coverage, unset E2E_COVERAGE\./,
        );
        return true;
      },
    );
  });
});

// The default exists so `globalSetup()` — which Playwright calls with no
// arguments — checks the directory the suite is actually served from. A
// default that pointed elsewhere would make the guard silently inert.
test('the default build directory is the repository build/ directory', () => {
  assert.equal(
    DEFAULT_BUILD_DIR,
    new URL('../build', import.meta.url).pathname,
  );
});
