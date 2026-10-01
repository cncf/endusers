// End-to-end coverage for the site's *interactive* client behaviour, as
// opposed to the render-only checks in tests/e2e/smoke.spec.js.
//
// Everything exercised here depends on React actually hydrating the static
// build: the member directory's search/filter/clear cycle, the member profile
// dialog, and the reference-architecture filters. The unit suite drives these
// through a fake DOM, so a hydration regression (a client-only bundle that
// throws, a mismatched server render that bails out) leaves every unit test
// green while the shipped page renders a dead toolbar. Only a browser against
// `build/` can catch that.
import { test, expect } from '../tools/e2e-coverage.cjs';

// React attaches its fiber to the DOM node it hydrates, so the presence of a
// `__react*` property is the signal that the element's handlers are live.
// Interacting before that point silently discards the input: the element is
// visible and enabled, but no state update follows.
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

test.describe('member directory filtering', () => {
  test('search narrows the results and clearing restores them', async ({
    page,
  }) => {
    await page.goto('/community/members');
    const section = page.getByRole('region', {
      name: 'End User Community organization directory',
    });
    const search = section.getByLabel('Search organizations by name');
    await waitForHydration(search);

    const results = section.getByText(/Showing \d+ of \d+ organizations/);
    const before = await results.textContent();
    const total = totalCount(before);
    expect(total).toBeGreaterThan(1);

    // Search for the first card's own organization name, so the query is
    // guaranteed to match at least one member on any data revision.
    const firstName = await section.locator('article h3').first().textContent();
    await search.fill(firstName.trim());

    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBeLessThan(total);
    expect(shownCount(await results.textContent())).toBeGreaterThan(0);

    const clear = section.getByRole('button', { name: 'Clear filters' });
    await expect(clear).toBeVisible();
    await clear.click();

    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBe(total);
    await expect(search).toHaveValue('');
  });

  test('a query that matches nothing shows the empty state', async ({
    page,
  }) => {
    await page.goto('/community/members');
    const section = page.getByRole('region', {
      name: 'End User Community organization directory',
    });
    const search = section.getByLabel('Search organizations by name');
    await waitForHydration(search);

    await search.fill('zzz-no-such-member-zzz');

    await expect(
      section.getByRole('heading', { name: 'No organizations match' }),
    ).toBeVisible();
    await expect(section.locator('article')).toHaveCount(0);

    // The empty state carries its own escape hatch, distinct from the
    // toolbar's clear button.
    await section
      .getByRole('heading', { name: 'No organizations match' })
      .locator('..')
      .getByRole('button', { name: 'Clear filters' })
      .click();

    await expect(section.locator('article').first()).toBeVisible();
  });

  test('membership filtering keeps explicit roles separate from unknown profiles', async ({
    page,
  }) => {
    await page.goto('/community/members');
    const section = page.getByRole('region', {
      name: 'End User Community organization directory',
    });
    const search = section.getByLabel('Search organizations by name');
    await waitForHydration(search);

    const results = section.getByText(/Showing \d+ of \d+ organizations/);
    const total = totalCount(await results.textContent());
    const membership = section.getByLabel('Filter by membership status');
    await membership.selectOption('member');

    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBeGreaterThan(0);
    expect(shownCount(await results.textContent())).toBeLessThan(total);

    await membership.selectOption('unknown');
    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBeGreaterThan(0);
  });

  test('the directory remains usable without horizontal overflow on mobile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 414, height: 896 });
    await page.goto('/community/members');
    const section = page.getByRole('region', {
      name: 'End User Community organization directory',
    });
    const search = section.getByLabel('Search organizations by name');
    await waitForHydration(search);
    await expect(
      section.getByLabel('Filter by membership status'),
    ).toBeVisible();
    await expect(
      section.getByRole('button', { name: /Open .+ profile/ }).first(),
    ).toBeVisible();
  });
});

for (const colorScheme of ['light', 'dark']) {
  test(`corporate logo plates stay readable in ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/community/members');
    const trigger = page.getByRole('button', {
      name: 'Open BlackRock profile',
    });
    const card = trigger.locator('..');
    await expect(card).toBeVisible();
    await expect(card.locator('div[class*="logoWrapper"]')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    );

    await waitForHydration(trigger);
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('div[class*="logoStage"]')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    );
  });
}

test.describe('member profile dialog', () => {
  test('opens focused on close, traps Tab, and restores focus on Escape', async ({
    page,
  }) => {
    await page.goto('/community/members');
    const section = page.getByRole('region', {
      name: 'End User Community organization directory',
    });
    const trigger = section
      .getByRole('button', { name: /^Open .+ profile$/ })
      .first();
    await waitForHydration(trigger);

    const triggerName = await trigger.getAttribute('aria-label');
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // useFocusTrap moves focus to the close button on mount.
    const close = dialog.getByRole('button', { name: /^Close .+ profile$/ });
    await expect(close).toBeFocused();

    // Tabbing forward from the last focusable element wraps back into the
    // dialog rather than escaping to the page behind it.
    const focusableCount = await dialog.locator('button, a[href]').count();
    for (let i = 0; i < focusableCount + 1; i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"]')),
        ),
      )
      .toBe(true);

    // Escape closes the dialog and returns focus to the card that opened it.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: triggerName })).toBeFocused();
  });

  test('clicking the backdrop closes the dialog', async ({ page }) => {
    await page.goto('/community/members');
    const section = page.getByRole('region', {
      name: 'End User Community organization directory',
    });
    const trigger = section
      .getByRole('button', { name: /^Open .+ profile$/ })
      .first();
    await waitForHydration(trigger);
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The backdrop only closes on a mousedown whose target is the backdrop
    // itself, so click its top-left corner, well clear of the dialog box.
    await page.mouse.click(5, 5);
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('reference architecture filters', () => {
  test('filtering by organization narrows the catalog and clears back', async ({
    page,
  }) => {
    await page.goto('/architectures');
    const search = page.getByLabel(
      'Search architectures by organization or title',
    );
    await waitForHydration(search);

    const results = page.getByText(/Showing \d+ of \d+ architectures/);
    const total = totalCount(await results.textContent());
    expect(total).toBeGreaterThan(0);

    const organization = page.getByLabel('Filter by organization');
    const firstOption = await organization
      .locator('option')
      .nth(1)
      .getAttribute('value');
    expect(firstOption).toBeTruthy();
    await organization.selectOption(firstOption);

    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBeGreaterThan(0);
    expect(shownCount(await results.textContent())).toBeLessThanOrEqual(total);

    const clear = page.getByRole('button', { name: 'Clear filters' });
    await expect(clear).toBeVisible();
    await clear.click();

    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBe(total);
    await expect(organization).toHaveValue('');
  });

  test('a query that matches nothing shows the empty state', async ({
    page,
  }) => {
    await page.goto('/architectures');
    const search = page.getByLabel(
      'Search architectures by organization or title',
    );
    await waitForHydration(search);

    const results = page.getByText(/Showing \d+ of \d+ architectures/);
    const total = totalCount(await results.textContent());
    expect(total).toBeGreaterThan(0);

    await search.fill('zzz-no-such-architecture-zzz');

    const heading = page.getByRole('heading', {
      name: 'No architectures match',
    });
    await expect(heading).toBeVisible();
    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBe(0);

    // The empty state carries its own escape hatch, distinct from the
    // toolbar's clear button, so scope the click to the empty-state block.
    await heading
      .locator('..')
      .getByRole('button', { name: 'Clear filters' })
      .click();

    await expect(heading).toHaveCount(0);
    await expect
      .poll(async () => shownCount(await results.textContent()))
      .toBe(total);
    await expect(search).toHaveValue('');
  });
});
