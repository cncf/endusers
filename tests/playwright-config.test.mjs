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

// The file name the flaky reporter writes, asserted against the output
// directory the config declares rather than hard-coded as a whole path.
const FLAKY_REPORT_BASENAME = 'flaky-specs.json';

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

const cleanEnv = { CI: undefined, E2E_PORT: undefined, E2E_WEBKIT: undefined };

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
  assert.equal(config.webServer.reuseExistingServer, false);
});

// `retries: 1` above is what makes a flaky spec exit the job green, so the
// evidence of it has to come from somewhere. 'github' annotates the run and
// nothing else; the reporter beside it writes the named record (see the
// preamble of tests/tools/flaky-reporter.mjs). Asserted as a pair because
// dropping either one is a silent loss: without 'github' the failures stop
// being annotated, and without the second entry a flake goes unrecorded.
test('keeps the GitHub annotations and the flaky record in CI', async () => {
  const config = await loadConfig({ ...cleanEnv, CI: '1' });
  assert.ok(
    Array.isArray(config.reporter),
    'CI reporter must be a list so annotations and the flaky record coexist',
  );
  assert.deepEqual(
    config.reporter.map(([name]) => name),
    ['github', './tests/tools/flaky-reporter.mjs'],
  );
});

// The report is only collected because ci.yml's "Upload Playwright traces"
// step already uploads Playwright's output directory
// (tests/ci-playwright-trace-evidence.test.mjs). A path outside it would be
// written on every flaky run and never leave the runner, so the record would
// look present here and be unreachable in practice.
test('writes the flaky record inside the uploaded output directory', async () => {
  const config = await loadConfig({ ...cleanEnv, CI: '1' });
  const entry = config.reporter.find(
    ([name]) => name === './tests/tools/flaky-reporter.mjs',
  );
  const outputDir = config.outputDir ?? 'test-results';
  assert.equal(
    entry[1].outputFile,
    `${outputDir}/${FLAKY_REPORT_BASENAME}`,
    'the flaky report must land inside Playwright\u2019s output directory',
  );
});

// The reporter is referenced by path, so a rename or a move leaves a config
// that only fails when CI next runs the suite.
test('registers a flaky reporter module that exists on disk', async () => {
  const config = await loadConfig({ ...cleanEnv, CI: '1' });
  const [modulePath] = config.reporter[1];
  assert.ok(
    existsSync(join(repoRoot, modulePath)),
    `${modulePath} is registered as a reporter but does not exist`,
  );
  const module = await import(`../${modulePath}`);
  assert.equal(typeof module.default, 'function');
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

test('declares a single Desktop Chrome project by default', async () => {
  const config = await loadConfig(cleanEnv);
  assert.deepEqual(
    config.projects.map((project) => project.name),
    ['chromium'],
  );
  assert.equal(config.projects[0].use.defaultBrowserType, 'chromium');
  assert.equal(config.projects[0].use.isMobile, false);
  assert.match(config.projects[0].use.userAgent, /Chrome\//);
});

// The WebKit project is the suite's only evidence about a non-Blink engine,
// and it is opt-in: .github/workflows/ci.yml installs the chromium bundle
// alone, and the coverage lane drives `page.coverage`, which Playwright
// exposes on Chromium only. Both halves are asserted, because each failure is
// silent in its own way — a project that stopped being added leaves the
// second engine untested while E2E_WEBKIT still looks honoured, and a project
// that became unconditional fails the e2e job with a missing browser rather
// than with a test result.
test('adds a WebKit smoke project when E2E_WEBKIT is set', async () => {
  const config = await loadConfig({ ...cleanEnv, E2E_WEBKIT: '1' });
  assert.deepEqual(
    config.projects.map((project) => project.name),
    ['chromium', 'webkit-smoke'],
  );

  const webkit = config.projects[1];
  assert.equal(webkit.use.defaultBrowserType, 'webkit');
  assert.equal(webkit.use.isMobile, false);
  assert.match(webkit.use.userAgent, /Safari\//);
});

test('leaves the chromium project untouched when E2E_WEBKIT is set', async () => {
  const config = await loadConfig({ ...cleanEnv, E2E_WEBKIT: '1' });
  assert.equal(config.projects[0].name, 'chromium');
  assert.equal(config.projects[0].use.defaultBrowserType, 'chromium');
  assert.equal(config.projects[0].testMatch, undefined);
});

// A second engine running the whole suite would double the e2e lane's runtime
// and re-assert interactions that are engine-independent. Only the smoke
// spec — the cross-page "renders at all" set — is in scope, and the pattern
// is checked against the real file so a rename cannot leave the project
// matching nothing and reporting green.
test('runs only the smoke spec on WebKit', async () => {
  const config = await loadConfig({ ...cleanEnv, E2E_WEBKIT: '1' });
  const { testMatch } = config.projects[1];
  assert.ok(testMatch instanceof RegExp, 'testMatch must be a RegExp');

  const smokeSpec = join(repoRoot, config.testDir, 'smoke.spec.js');
  assert.ok(existsSync(smokeSpec), `${smokeSpec} does not exist`);
  assert.ok(testMatch.test(smokeSpec));

  const otherSpecs = readdirSync(join(repoRoot, config.testDir)).filter(
    (entry) => entry.endsWith('.spec.js') && entry !== 'smoke.spec.js',
  );
  assert.ok(otherSpecs.length > 0, 'expected more than one e2e spec');
  for (const entry of otherSpecs) {
    assert.equal(
      testMatch.test(join(repoRoot, config.testDir, entry)),
      false,
      `${entry} must not run on WebKit`,
    );
  }
});

// Only the exact opt-in value enables it. An inherited `E2E_WEBKIT=0` or a
// variable exported empty by a shell wrapper must not start downloading and
// launching a browser the caller never asked for.
test('treats any value other than 1 as no WebKit project', async () => {
  for (const value of ['', '0', 'false', 'true']) {
    const config = await loadConfig({ ...cleanEnv, E2E_WEBKIT: value });
    assert.deepEqual(
      config.projects.map((project) => project.name),
      ['chromium'],
      `E2E_WEBKIT=${JSON.stringify(value)} must not add a project`,
    );
  }
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
