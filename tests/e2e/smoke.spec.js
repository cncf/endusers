// Minimal end-to-end smoke tests (#641). These run against the real
// production build output (see playwright.config.js's webServer, which
// serves `build/` via `docusaurus serve`), not the fake DOM used by the unit
// suite. The goal is only to catch "build succeeds but renders an empty or
// broken page" — deeper interaction testing stays in the unit suite.
import { test, expect } from '../tools/e2e-coverage.cjs';

test.describe('member directory', () => {
  test('lists End User organizations', async ({ page }) => {
    await page.goto('/community/members');
    const section = page.getByRole('region', {
      name: 'End User Community organization directory',
    });
    await expect(section).toBeVisible();

    const resultsText = section.getByText(/Showing \d+ of \d+/);
    await expect(resultsText).toBeVisible();

    const shown = await resultsText.locator('strong').first().textContent();
    expect(Number(shown)).toBeGreaterThan(0);
  });
});

test.describe('metrics dashboard', () => {
  test('renders its metric cards', async ({ page }) => {
    await page.goto('/metrics');
    await expect(page.getByText(/Last updated .* UTC/)).toBeVisible();

    const lifecycle = page.getByRole('heading', {
      name: 'Reference architecture lifecycle',
    });
    await expect(lifecycle).toBeVisible();

    const cardLinks = page.locator('a[target="_blank"][href^="http"]');
    expect(await cardLinks.count()).toBeGreaterThan(0);
  });
});

test.describe('awards timeline', () => {
  test('renders at least one year group of winners', async ({ page }) => {
    await page.goto('/community/awards');

    const yearBadges = page.locator('[class*="yearBadge"]');
    expect(await yearBadges.count()).toBeGreaterThan(0);

    const firstYear = await yearBadges.first().textContent();
    expect(firstYear?.trim()).toMatch(/^\d{4}$/);
  });
});

test.describe('reference architectures', () => {
  test('lists catalog entries', async ({ page }) => {
    await page.goto('/architectures');

    const resultsText = page.getByText(/Showing \d+ of \d+ architectures/);
    await expect(resultsText).toBeVisible();

    const total = await resultsText.textContent();
    const [, totalCount] = total?.match(/of (\d+) architectures/) || [];
    expect(Number(totalCount)).toBeGreaterThan(0);
  });
});

test.describe('case studies', () => {
  test('lists case study rows', async ({ page }) => {
    await page.goto('/resources/case-studies');
    const section = page.getByRole('region', { name: 'CNCF case studies' });
    await expect(section).toBeVisible();

    const resultsText = section.getByText(/Showing \d+ of \d+ case studies/);
    await expect(resultsText).toBeVisible();

    const shown = await resultsText.locator('strong').first().textContent();
    expect(Number(shown)).toBeGreaterThan(0);

    expect(await section.locator('tbody tr').count()).toBeGreaterThan(0);
  });
});

test.describe('radar reports', () => {
  test('lists published reports with links', async ({ page }) => {
    await page.goto('/resources/radar-reports');
    const section = page.getByRole('region', {
      name: 'CNCF Technology Radar reports',
    });
    await expect(section).toBeVisible();

    const reports = section.locator('li');
    expect(await reports.count()).toBeGreaterThan(0);

    const firstLink = reports.first().getByRole('link').first();
    await expect(firstLink).toHaveAttribute('href', /^https?:\/\//);
  });
});

test.describe('projects born at end users', () => {
  test('renders project cards on the community page', async ({ page }) => {
    await page.goto('/community');
    // The footer renders a second, compact ProjectsBorn under the same
    // accessible name, so the in-page section is addressed by its heading id.
    const section = page.locator(
      'section[aria-labelledby="projects-born-title-section"]',
    );
    await expect(section).toBeVisible();

    const projects = section.getByRole('link', { name: /Born at / });
    expect(await projects.count()).toBeGreaterThan(0);
    await expect(projects.first()).toHaveAttribute('href', /\S/);
  });
});

test.describe('community group link status', () => {
  test('reports when upstream group links were last verified', async ({
    page,
  }) => {
    await page.goto('/community');
    await expect(
      page.getByText(/Upstream group links last verified on .+\./),
    ).toBeVisible();
  });
});
