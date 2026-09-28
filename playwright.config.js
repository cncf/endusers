// See: https://playwright.dev/docs/test-configuration
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
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
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
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
