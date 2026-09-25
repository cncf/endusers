// See: https://playwright.dev/docs/test-configuration
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
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
