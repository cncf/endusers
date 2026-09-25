// Minimal end-to-end smoke tests (#641). These run against the real
// production build output (see playwright.config.js's webServer, which
// serves `build/` via `docusaurus serve`), not the fake DOM used by the unit
// suite. The goal is only to catch "build succeeds but renders an empty or
// broken page" — deeper interaction testing stays in the unit suite.
import { test, expect } from '@playwright/test';

test.describe('member directory', () => {
  test('lists member organizations', async ({ page }) => {
    await page.goto('/community/members');
    const section = page.getByRole('region', {
      name: 'End User Community member directory',
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
