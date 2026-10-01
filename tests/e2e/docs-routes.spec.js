// End-to-end coverage for the three sidebar doc routes no other spec loads:
// /resources, /community/governance and
// /community/technical-community-groups/platform-engineering.
//
// The existing specs reach /resources/case-studies and /resources/radar-reports
// but never the Resources landing page itself, and no spec has ever requested
// either community doc. tests/docs-contract.test.mjs and
// tests/root-docs-links.test.mjs assert the source files — frontmatter, slugs
// and that every in-repo link target exists — but they read Markdown off disk.
// They cannot see whether the built site serves the route at all: an MDX
// compile change, a sidebar_position clash or a theme regression can leave a
// page reachable from the navbar yet rendering an empty shell.
//
// /resources is the only doc on the site whose body is hand-written JSX: it
// imports @docusaurus/Link and renders the two `pillar` cards that are the sole
// entry points to the case-study and radar-report tables. A `<Link to>` that
// stops resolving under the deployed baseUrl breaks both, and nothing else
// would catch it.
import { test, expect } from '../tools/e2e-coverage.cjs';

const RESOURCES_PATH = '/resources';
const GOVERNANCE_PATH = '/community/governance';
const PLATFORM_ENGINEERING_PATH =
  '/community/technical-community-groups/platform-engineering';

function normalise(pathname) {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

async function gotoDoc(page, path) {
  const response = await page.goto(path);

  // `docusaurus serve` answers an unknown path with the 404 page, so the
  // status alone is not conclusive; both are asserted.
  expect(response?.status(), `${path} should not 404`).toBeLessThan(400);
  await expect(
    page.getByRole('heading', { name: 'Page Not Found' }),
  ).toHaveCount(0);

  return response;
}

test.describe('resources landing page', () => {
  test('renders inside its sidebar', async ({ page }) => {
    await gotoDoc(page, RESOURCES_PATH);

    await expect(
      page.getByRole('heading', { name: 'Resources' }),
    ).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
    // The Resources navbar item points at a docSidebar, so the built page has
    // to render one; a doc that falls out of resourcesSidebar still renders an
    // article but loses this.
    await expect(page.locator('nav.menu').first()).toBeVisible();
  });

  for (const pillar of [
    { label: 'Case Studies', to: '/resources/case-studies' },
    { label: 'Radar Reports', to: '/resources/radar-reports' },
  ]) {
    test(`the "${pillar.label}" pillar links to ${pillar.to}`, async ({
      page,
    }) => {
      await gotoDoc(page, RESOURCES_PATH);

      // Located by role and name rather than by the `pillar` class: the class
      // is presentation, the link is the contract.
      const link = page
        .locator('article')
        .getByRole('link', { name: pillar.label, exact: true });
      await expect(link).toBeVisible();

      await link.click();

      expect(normalise(new URL(page.url()).pathname)).toBe(
        normalise(pillar.to),
      );
      await expect(
        page.getByRole('heading', { name: 'Page Not Found' }),
      ).toHaveCount(0);
      await expect(page.locator('article').first()).toBeVisible();
    });
  }
});

test.describe('community reference docs', () => {
  test('governance renders the reproduced TAB document', async ({ page }) => {
    await gotoDoc(page, GOVERNANCE_PATH);

    await expect(page.locator('article').first()).toBeVisible();
    await expect(page.locator('nav.menu').first()).toBeVisible();

    // The source-and-license admonition is the part a re-import of the
    // upstream cncf/tab text is most likely to drop, and the page may not be
    // republished without it.
    await expect(
      page.getByText('Source and license', { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.locator('article').getByRole('link', {
        name: "CNCF TAB's User Group Governance",
      }),
    ).toBeVisible();
  });

  test('the platform engineering TCG page renders and links to governance', async ({
    page,
  }) => {
    await gotoDoc(page, PLATFORM_ENGINEERING_PATH);

    await expect(
      page.getByRole('heading', {
        name: 'Platform Engineering Technical Community Group',
      }),
    ).toBeVisible();
    await expect(page.locator('nav.menu').first()).toBeVisible();

    // Written as a relative Markdown link (`../governance.md`); this asserts
    // the build resolved it to the governance route rather than emitting the
    // source path.
    const governanceLink = page
      .locator('article')
      .getByRole('link', { name: 'Governance', exact: true });
    await expect(governanceLink).toBeVisible();

    await governanceLink.click();

    expect(normalise(new URL(page.url()).pathname)).toBe(
      normalise(GOVERNANCE_PATH),
    );
    await expect(page.locator('article').first()).toBeVisible();
  });
});
