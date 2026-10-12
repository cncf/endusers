// End-to-end coverage for the legacy inbound URLs (see
// tests/legacy-url-stubs.test.mjs for the source-side contract).
//
// Five routes exist only so links published elsewhere keep working: cncf.io,
// the End User mailing list and the `#enduser` Slack channel all still point
// at the pre-reorganisation paths. docusaurus.config.js registers no
// client-redirects plugin, so each route is served by an `unlisted: true`
// stub document whose body is a single onward link.
//
// The unit contract asserts the stubs' frontmatter and that their targets are
// routes some doc claims. It cannot see whether the *built site* serves them:
// an `unlisted` doc is dropped from the production build under some
// configurations, and a theme change can render the page shell with an empty
// article. Only a request against `build/` settles that, which is what this
// spec does.
//
// No other spec loads any of these paths — the eleven pre-existing specs
// navigate to /, /architectures, /blog, /blog/tags, /community,
// /community/awards, /community/members, /metrics, /resources/case-studies
// and /resources/radar-reports.
import { test, expect } from '../tools/e2e-coverage.cjs';

// Kept in step with LEGACY_STUBS in tests/legacy-url-stubs.test.mjs. Restated
// here rather than imported because these are the routes as a *visitor*
// reaches them, and because an unintended change should fail in both places.
const LEGACY_ROUTES = [
  { from: '/members', to: '/community/members' },
  { from: '/awards', to: '/community/awards' },
  { from: '/community/end-user-community', to: '/community' },
  {
    from: '/community/telecom-user-group',
    to: '/community/user-groups/telecom',
  },
  {
    from: '/community/public-sector-user-group',
    to: '/community/user-groups/public-sector',
  },
];

function normalise(pathname) {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

async function expectNotNotFound(page) {
  await expect(
    page.getByRole('heading', { name: 'Page Not Found' }),
  ).toHaveCount(0);
}

// The `<loc>` entries are absolute URLs, so a substring match for `/awards`
// also hits `/community/awards`. Compare parsed pathnames instead.
async function sitemapPaths(request) {
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  const sitemap = await response.text();

  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) =>
    normalise(new URL(loc).pathname),
  );
}

test.describe('legacy inbound URLs', () => {
  for (const route of LEGACY_ROUTES) {
    test(`${route.from} is still served`, async ({ page }) => {
      const response = await page.goto(route.from);

      // `docusaurus serve` answers an unknown path with the 404 page, so the
      // status alone is not conclusive; both are asserted.
      expect(response?.status(), `${route.from} should not 404`).toBeLessThan(
        400,
      );
      await expectNotNotFound(page);
      await expect(page.locator('article').first()).toBeVisible();
    });

    test(`${route.from} forwards a visitor to ${route.to}`, async ({
      page,
    }) => {
      await page.goto(route.from);

      // Matched by href rather than by link text: the stubs are not
      // consistent about the label (/community/end-user-community writes
      // "Community", the rest write the path), and the destination is the
      // part that has to stay correct.
      const onward = page
        .locator('article')
        .locator(`a[href="${route.to}"], a[href="${route.to}/"]`);
      await expect(
        onward,
        `${route.from} should offer a visible link to ${route.to}`,
      ).toBeVisible();

      await onward.click();

      expect(normalise(new URL(page.url()).pathname)).toBe(normalise(route.to));
      await expectNotNotFound(page);
      await expect(page.locator('article').first()).toBeVisible();
    });

    test(`${route.from} is presented as an unlisted page`, async ({ page }) => {
      await page.goto(route.from);

      // The theme renders this banner only for a doc the build treats as
      // unlisted. It is the runtime counterpart to the frontmatter assertion
      // in tests/legacy-url-stubs.test.mjs: it proves the built site agrees
      // that the stub is reachable-but-unindexed, rather than a normal page
      // that has drifted into the sidebar and search index.
      await expect(
        page.getByText('This page is unlisted.', { exact: false }),
      ).toBeVisible();
    });
  }

  test('the stubs stay out of the sitemap', async ({ request }) => {
    // `unlisted` is what keeps these routes reachable without offering search
    // engines a second URL for content that lives elsewhere. If a stub is
    // ever listed, the duplicate shows up here first.
    const paths = await sitemapPaths(request);
    expect(paths.length, 'sitemap.xml should list the site').toBeGreaterThan(
      LEGACY_ROUTES.length,
    );

    const listed = LEGACY_ROUTES.map((route) => route.from).filter((from) =>
      paths.includes(normalise(from)),
    );

    expect(listed).toEqual([]);
  });

  test('the sitemap still covers the pages the stubs forward to', async ({
    request,
  }) => {
    // Guards the assertion above from passing because the sitemap is empty or
    // truncated rather than because the stubs are excluded from it.
    const paths = await sitemapPaths(request);

    const missing = LEGACY_ROUTES.map((route) => route.to).filter(
      (to) => !paths.includes(normalise(to)),
    );

    expect(missing).toEqual([]);
  });
});
