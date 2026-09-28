// End-to-end coverage for the case-studies toolbar on /resources/case-studies.
//
// tests/e2e/smoke.spec.js only checks that the table renders rows, and
// tests/case-studies.test.mjs drives the search box, the three selects and the
// Clear filters button through the fake DOM. Neither catches a hydration
// regression: if the client bundle for <CaseStudies> throws or its server
// render mismatches, the static table still paints and every existing test
// stays green while the shipped toolbar does nothing. These tests exercise the
// controls in a real browser against `build/`.
import { test, expect } from '@playwright/test';

// React attaches its fiber to the DOM node it hydrates, so the presence of a
// `__react*` property is the signal that the element's handlers are live.
// Interacting before that point silently discards the input.
async function waitForHydration(locator) {
  await locator.waitFor({ state: 'visible' });
  await locator.evaluate(async (element) => {
    const hydrated = (node) =>
      Object.keys(node).some((key) => key.startsWith('__react'));
    while (!hydrated(element)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
}

function shownCount(text) {
  const [, shown] = text?.match(/Showing\s+(\d+)\s+of\s+(\d+)/) || [];
  return Number(shown);
}

function totalCount(text) {
  const [, , total] = text?.match(/Showing\s+(\d+)\s+of\s+(\d+)/) || [];
  return Number(total);
}

async function openCaseStudies(page) {
  await page.goto('/resources/case-studies');
  const section = page.getByRole('region', { name: 'CNCF case studies' });
  const search = section.getByLabel('Search case studies by organization');
  await waitForHydration(search);
  return {
    section,
    search,
    results: section.getByText(/Showing \d+ of \d+ case studies/),
  };
}

test.describe('case study search', () => {
  test('narrows the table and Clear filters restores it', async ({ page }) => {
    const { section, search, results } = await openCaseStudies(page);

    const total = totalCount(await results.textContent());
    expect(total).toBeGreaterThan(1);
    expect(shownCount(await results.textContent())).toBe(total);

    // The Organization cell of the first row is guaranteed to match on any
    // data revision, unlike a hard-coded organization name.
    const organization = (
      await section.locator('tbody tr td').first().textContent()
    ).trim();
    expect(organization).not.toBe('');
    await search.fill(organization);

    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBeLessThan(total);
    expect(shownCount(await results.textContent())).toBeGreaterThan(0);
    await expect(section.locator('tbody tr')).toHaveCount(
      shownCount(await results.textContent()),
    );

    // Clear filters is rendered only while a filter is active.
    const clear = section.getByRole('button', { name: 'Clear filters' });
    await expect(clear).toBeVisible();
    await clear.click();

    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBe(total);
    await expect(search).toHaveValue('');
    await expect(clear).toHaveCount(0);
  });

  test('matches organizations case-insensitively', async ({ page }) => {
    const { section, search, results } = await openCaseStudies(page);

    const organization = (
      await section.locator('tbody tr td').first().textContent()
    ).trim();
    await search.fill(organization.toUpperCase());

    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBeGreaterThan(0);
    await expect(
      section.getByText('No case studies match those filters.'),
    ).toHaveCount(0);
  });

  test('a query that matches nothing shows the empty state', async ({
    page,
  }) => {
    const { section, search, results } = await openCaseStudies(page);

    await search.fill('zzz-no-such-organization-zzz');

    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBe(0);
    await expect(section.locator('tbody tr')).toHaveCount(0);
    await expect(
      section.getByText('No case studies match those filters.'),
    ).toBeVisible();

    await section.getByRole('button', { name: 'Clear filters' }).click();
    await expect(section.locator('tbody tr').first()).toBeVisible();
  });
});

test.describe('case study facet filters', () => {
  for (const { label, facet } of [
    { label: 'Filter by CNCF project', facet: 'project' },
    { label: 'Filter by industry', facet: 'industry' },
    { label: 'Filter by country', facet: 'country' },
  ]) {
    test(`selecting a ${facet} narrows the table and clears back`, async ({
      page,
    }) => {
      const { section, results } = await openCaseStudies(page);

      const total = totalCount(await results.textContent());
      const select = section.getByLabel(label);

      // Option 0 is the "All ..." placeholder; option 1 is the first real
      // value, which every build is guaranteed to have at least one row for.
      const value = await select.locator('option').nth(1).getAttribute('value');
      expect(value).toBeTruthy();
      await select.selectOption(value);

      await expect
        .poll(async () => shownCount(await results.textContent()))
        .toBeGreaterThan(0);
      const shown = shownCount(await results.textContent());
      expect(shown).toBeLessThanOrEqual(total);
      await expect(section.locator('tbody tr')).toHaveCount(shown);

      await section.getByRole('button', { name: 'Clear filters' }).click();
      await expect
        .poll(async () => shownCount(await results.textContent()))
        .toBe(total);
      await expect(select).toHaveValue('');
    });
  }

  test('search and facet filters compose, and one Clear resets both', async ({
    page,
  }) => {
    const { section, search, results } = await openCaseStudies(page);

    const total = totalCount(await results.textContent());
    const project = section.getByLabel('Filter by CNCF project');
    const value = await project.locator('option').nth(1).getAttribute('value');
    await project.selectOption(value);

    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBeGreaterThan(0);
    const afterFacet = shownCount(await results.textContent());

    // Narrowing further with the organization of a row that survived the
    // facet filter must keep at least that row and drop no fewer.
    const organization = (
      await section.locator('tbody tr td').first().textContent()
    ).trim();
    await search.fill(organization);

    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBeGreaterThan(0);
    expect(shownCount(await results.textContent())).toBeLessThanOrEqual(
      afterFacet,
    );

    await section.getByRole('button', { name: 'Clear filters' }).click();
    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBe(total);
    await expect(search).toHaveValue('');
    await expect(project).toHaveValue('');
  });
});
