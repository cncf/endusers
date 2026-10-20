// See: https://playwright.dev/docs/test-configuration
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

// Playwright's default when a config sets no outputDir, which this one does
// not. Named here so the flaky report below lands beside the traces that
// ci.yml's "Upload Playwright traces" step already uploads, rather than in a
// second directory no workflow collects.
const OUTPUT_DIR = 'test-results';

// Every assertion in tests/e2e/ runs on Blink today, so nothing in the repo is
// evidence about any other engine: a WebKit-only regression (a CSS feature
// Safari lacks, a Blink-only DOM API a component reaches for) ships green.
// The second project below runs tests/e2e/smoke.spec.js — the cross-page
// "renders at all" set, which is the cheapest useful second-engine signal —
// on Desktop Safari.
//
// It is opt-in rather than unconditional for two reasons, both of which hold
// until .github/workflows/ci.yml opts in (see #1697):
//   * the e2e job installs the chromium bundle only, so an unconditional
//     WebKit project would fail to launch a browser rather than report one;
//   * the e2e-coverage job drives V8 coverage through `page.coverage`, which
//     Playwright exposes on Chromium alone — tests/tools/e2e-coverage.cjs
//     throws "Playwright JavaScript coverage is unavailable" on any other
//     engine, so that lane must keep running Chromium only.
// An unset or empty E2E_WEBKIT therefore leaves the suite exactly as it was.
const WEBKIT_SMOKE_ENABLED = process.env.E2E_WEBKIT === '1';

// Named so the test and the workflow can refer to the same string, and kept
// to the smoke spec: this project exists to catch an engine difference, not
// to re-run the interaction suite on a second browser.
const WEBKIT_SMOKE_PROJECT = {
  name: 'webkit-smoke',
  testMatch: /smoke\.spec\.js$/,
  use: { ...devices['Desktop Safari'] },
};

export default defineConfig({
  testDir: 'tests/e2e',
  // Turns a coverage run started without E2E_COVERAGE_DIR/E2E_COVERAGE_RUN_ID
  // into one message instead of the same fixture error once per test. See
  // tests/tools/e2e-coverage-global-setup.mjs.
  globalSetup: './tests/tools/e2e-coverage-global-setup.mjs',
  fullyParallel: true,
  // The suite is served by a single `docusaurus serve` process (see webServer
  // below), so worker count is bounded by that one server rather than by CPU.
  // Playwright's local default is half the cores, which on a many-core
  // developer machine puts ~10 browsers against it at once and starves page
  // and image requests until tests time out — observed as reproducible
  // failures in both architecture-detail.spec.js and interactions.spec.js on a
  // 32-core host, where capping at 4 is both green and faster end to end.
  // CI is left on Playwright's own default, which already scales to the
  // smaller runners.
  workers: process.env.CI ? undefined : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 'github' annotates the run; the flaky reporter beside it is what leaves a
  // durable, named record of a spec that failed and passed on retry, which
  // annotations and the unnamed trace blobs do not (see the preamble of
  // tests/tools/flaky-reporter.mjs). It is additive and writes nothing when
  // no test flaked, so a clean run is unchanged. Local runs keep the plain
  // 'list' reporter: with retries: 0 there are no flaky outcomes to record.
  reporter: process.env.CI
    ? [
        ['github'],
        [
          './tests/tools/flaky-reporter.mjs',
          { outputFile: `${OUTPUT_DIR}/flaky-specs.json` },
        ],
      ]
    : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    ...(WEBKIT_SMOKE_ENABLED ? [WEBKIT_SMOKE_PROJECT] : []),
  ],
  // Assumes `npm run build:production` has already produced a build/
  // directory; the suite only serves and exercises that static output rather
  // than rebuilding it itself, so it stays fast and doesn't hide build
  // failures behind test failures.
  webServer: {
    command: `npx docusaurus serve --no-open --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
