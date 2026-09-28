// End-to-end coverage for the primary site navbar. tests/site-config.test.mjs
// asserts the navbar *configuration* (every `to:` resolves to a doc/static
// file, every docSidebar id exists in sidebars.js), but nothing exercises the
// navbar the build actually renders, so a theme or swizzle regression that
// drops a link, breaks the logo home link or leaves the mobile menu unopenable
// ships green. These tests drive the real production build served by
// playwright.config.js's webServer.
//
// The expected items are spelled out here rather than imported from
// docusaurus.config.js: Playwright's loader cannot evaluate that config (it
// needs Docusaurus's own require.resolve shim), and an explicit table also
// makes an unintended navbar change fail loudly instead of silently
// re-deriving itself.
import { test, expect } from '@playwright/test';

const LINK_ITEMS = [
  { label: 'Practitioners', to: '/' },
  {
    label: 'Projects from end users',
    to: '/community#projects-born-at-end-user-organizations',
  },
  { label: 'Metrics', to: '/metrics/' },
  { label: 'Events', to: '/events/' },
  { label: 'Blog', to: '/blog' },
];

const SIDEBAR_ITEMS = [
  { label: 'Architectures' },
  { label: 'Community' },
  { label: 'Resources' },
];

const ALL_LABELS = [...LINK_ITEMS, ...SIDEBAR_ITEMS].map((item) => item.label);

function navbarLink(page, label) {
  return page
    .locator('nav.navbar')
    .getByRole('link', { name: label, exact: true });
}

async function expectNotNotFound(page) {
  await expect(
    page.getByRole('heading', { name: 'Page Not Found' }),
  ).toHaveCount(0);
}

test.describe('primary navbar', () => {
  test('renders every configured top-level item', async ({ page }) => {
    await page.goto('/');

    for (const label of ALL_LABELS) {
      await expect(navbarLink(page, label)).toBeVisible();
    }
  });

  test('the logo links back to the site root', async ({ page }) => {
    await page.goto('/metrics/');

    const logo = page.locator('nav.navbar a.navbar__brand');
    await expect(logo).toBeVisible();
    await logo.click();

    expect(new URL(page.url()).pathname.replace(/\/$/, '')).toBe('');
    await expect(page.locator('main').first()).toBeVisible();
  });

  for (const item of LINK_ITEMS) {
    test(`"${item.label}" navigates to a page that renders content`, async ({
      page,
    }) => {
      await page.goto('/');
      await navbarLink(page, item.label).click();

      await expectNotNotFound(page);
      await expect(page.locator('main').first()).toBeVisible();

      const [path] = item.to.split('#');
      expect(new URL(page.url()).pathname.replace(/\/$/, '')).toBe(
        path.replace(/\/$/, ''),
      );
    });
  }

  for (const item of SIDEBAR_ITEMS) {
    test(`"${item.label}" opens a doc served by its sidebar`, async ({
      page,
    }) => {
      await page.goto('/');
      await navbarLink(page, item.label).click();

      await expectNotNotFound(page);
      // Doc pages render the sidebar the navbar item points at.
      await expect(page.locator('nav.menu').first()).toBeVisible();
      await expect(page.locator('article').first()).toBeVisible();
    });
  }

  test('marks the item for the current page as active', async ({ page }) => {
    await page.goto('/metrics/');

    await expect(navbarLink(page, 'Metrics')).toHaveClass(
      /navbar__link--active/,
    );
  });

  test('the fragment link lands on the section it names', async ({ page }) => {
    const fragmentItem = LINK_ITEMS.find((item) => item.to.includes('#'));
    const [, fragment] = fragmentItem.to.split('#');

    await page.goto('/');
    await navbarLink(page, fragmentItem.label).click();

    await expect(page).toHaveURL(new RegExp(`#${fragment}$`));
    await expect(page.locator(`#${fragment}`)).toBeAttached();
  });
});

test.describe('mobile navbar', () => {
  test.use({ viewport: { width: 414, height: 896 } });

  test('the hamburger opens a menu with the same items and closes again', async ({
    page,
  }) => {
    await page.goto('/');

    const toggle = page.locator('.navbar__toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();

    const sidebar = page.locator('.navbar-sidebar');
    await expect(sidebar).toBeVisible();
    for (const label of ALL_LABELS) {
      await expect(
        sidebar.getByRole('link', { name: label, exact: true }),
      ).toBeVisible();
    }

    await page.locator('.navbar-sidebar__close').click();
    await expect(sidebar).toBeHidden();
  });
});
