import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

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
