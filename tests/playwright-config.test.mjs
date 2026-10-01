import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// playwright.config.js reads process.env at module scope, so every branch has
// to be observed through a fresh import under the env it depends on.
async function loadConfig(env = {}) {
  const previous = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    const suffix = `?load=${Math.random()}`;
    return (await import(`../playwright.config.js${suffix}`)).default;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const cleanEnv = { CI: undefined, E2E_PORT: undefined };

test('defaults to port 3000 when E2E_PORT is unset', async () => {
  const config = await loadConfig(cleanEnv);
  assert.equal(config.use.baseURL, 'http://localhost:3000');
  assert.equal(config.webServer.url, 'http://localhost:3000');
  assert.match(config.webServer.command, /--port 3000$/);
});

test('threads E2E_PORT through baseURL and the web server command', async () => {
  const config = await loadConfig({ ...cleanEnv, E2E_PORT: '4321' });
  assert.equal(config.use.baseURL, 'http://localhost:4321');
  assert.equal(config.webServer.url, 'http://localhost:4321');
  assert.match(config.webServer.command, /--port 4321$/);
});

test('relaxes CI-only guards when CI is unset', async () => {
  const config = await loadConfig(cleanEnv);
  assert.equal(config.forbidOnly, false);
  assert.equal(config.retries, 0);
  assert.equal(config.reporter, 'list');
  assert.equal(config.webServer.reuseExistingServer, true);
});

test('tightens CI-only guards when CI is set', async () => {
  const config = await loadConfig({ ...cleanEnv, CI: '1' });
  assert.equal(config.forbidOnly, true);
  assert.equal(config.retries, 1);
  assert.equal(config.reporter, 'github');
  assert.equal(config.webServer.reuseExistingServer, false);
});

test('treats an empty CI value as not running in CI', async () => {
  const config = await loadConfig({ ...cleanEnv, CI: '' });
  assert.equal(config.forbidOnly, false);
  assert.equal(config.retries, 0);
  assert.equal(config.reporter, 'list');
  assert.equal(config.webServer.reuseExistingServer, true);
});

test('runs the suite fully parallel and retains traces on failure', async () => {
  const config = await loadConfig(cleanEnv);
  assert.equal(config.fullyParallel, true);
  assert.equal(config.use.trace, 'retain-on-failure');
});

// A single `docusaurus serve` process backs the whole suite, so the local
// worker count is capped to keep page and image requests from starving; CI
// keeps Playwright's own default.
test('caps local workers so one static server can serve them', async () => {
  const config = await loadConfig(cleanEnv);
  assert.equal(config.workers, 4);
});

test('leaves the worker count to Playwright in CI', async () => {
  const config = await loadConfig({ ...cleanEnv, CI: '1' });
  assert.equal(config.workers, undefined);
});

test('declares a single Desktop Chrome project', async () => {
  const config = await loadConfig(cleanEnv);
  assert.deepEqual(
    config.projects.map((project) => project.name),
    ['chromium'],
  );
  assert.equal(config.projects[0].use.defaultBrowserType, 'chromium');
  assert.equal(config.projects[0].use.isMobile, false);
  assert.match(config.projects[0].use.userAgent, /Chrome\//);
});

test('points testDir at a directory that holds spec files', async () => {
  const config = await loadConfig(cleanEnv);
  assert.equal(config.testDir, 'tests/e2e');
  const testDir = join(repoRoot, config.testDir);
  assert.ok(existsSync(testDir), `${config.testDir} does not exist`);
  const specs = readdirSync(testDir).filter((entry) =>
    entry.endsWith('.spec.js'),
  );
  assert.ok(specs.length > 0, `${config.testDir} contains no .spec.js files`);
});

test('gives the web server a bounded startup timeout', async () => {
  const config = await loadConfig(cleanEnv);
  assert.equal(typeof config.webServer.timeout, 'number');
  assert.ok(config.webServer.timeout > 0);
});

// Which files in testDir actually run is decided by Playwright's default
// `testMatch` (`**/*.@(spec|test).?(c|m)[jt]s?(x)`), because the config sets
// neither `testMatch` nor `testIgnore`. The assertion above only proves the
// directory holds *at least one* `.spec.js`, so a spec committed as
// `navigation.e2e.js` — or an existing spec dropped by a future `testIgnore`
// — would sit in tests/e2e looking like coverage while never executing, and
// the end-to-end CI job would stay green. The whole e2e safety net for the
// site lives in that one directory, so a silently unregistered file removes
// coverage while appearing to add it.
//
// The registered set is resolved by asking Playwright itself rather than by
// re-implementing its glob, so the check cannot drift from the runner's real
// behaviour. `--list` neither downloads a browser nor starts the web server.
const playwrightBin = join(repoRoot, 'node_modules', '.bin', 'playwright');

function listRegisteredSpecs(testDir) {
  // NODE_V8_COVERAGE reaches Playwright's own worker processes, which load
  // every spec file to enumerate it. Left pointed at the reporter's directory,
  // those records make tests/tools/coverage-report.mjs attribute all 19 spec
  // files to this unit run — they surface as "Not reported" entries and move
  // the repo-wide percentages the coverage gate checks. The child's coverage
  // is of no interest, so it is redirected to a directory that is thrown away.
  const sink = mkdtempSync(join(tmpdir(), 'playwright-list-coverage-'));
  try {
    const run = spawnSync(
      playwrightBin,
      ['test', '--list', '--reporter=json'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, CI: '', NODE_V8_COVERAGE: sink },
      },
    );

    assert.equal(run.status, 0, `playwright test --list failed: ${run.stderr}`);

    // `status` 0 guarantees the reporter wrote a complete JSON listing, so
    // neither the output nor its `suites` array needs a fallback.
    const listing = JSON.parse(run.stdout);
    const absoluteTestDir = join(repoRoot, testDir);

    return new Set(
      listing.suites
        .map((suite) => resolve(absoluteTestDir, suite.file))
        .map((file) => relative(absoluteTestDir, file)),
    );
  } finally {
    rmSync(sink, { recursive: true, force: true });
  }
}

test('registers every file in testDir as a spec', async () => {
  const config = await loadConfig(cleanEnv);
  const testDir = join(repoRoot, config.testDir);

  const onDisk = readdirSync(testDir).filter((entry) =>
    statSync(join(testDir, entry)).isFile(),
  );
  const registered = listRegisteredSpecs(config.testDir);

  const unregistered = onDisk.filter((entry) => !registered.has(entry));
  assert.deepEqual(
    unregistered,
    [],
    `${config.testDir} holds files Playwright never runs (rename them to *.spec.js): ${unregistered.join(', ')}`,
  );

  // Guards the comparison itself: an empty registered set would make the
  // check above vacuous for an empty directory.
  assert.equal(registered.size, onDisk.length);
  assert.ok(onDisk.length > 0, `${config.testDir} is empty`);
});

test('declares no testIgnore that could shrink the suite', async () => {
  const config = await loadConfig(cleanEnv);
  assert.equal(config.testIgnore, undefined);

  // `defineConfig` passes unknown keys straight through, so a `testIgnore`
  // added to the source would surface above. Reading the source as well keeps
  // the contract legible at the place a reviewer would add one.
  const source = readFileSync(join(repoRoot, 'playwright.config.js'), 'utf8');
  assert.doesNotMatch(source, /\btestIgnore\b/);
});
