// End-to-end coverage for the swizzled theme footer, src/theme/Footer/index.js.
//
// The footer is the only component that renders on *every* route of the site,
// and no spec has ever asserted it. tests/e2e/smoke.spec.js reaches the
// in-page ProjectsBorn section on /community by its section heading id
// precisely to avoid the footer's compact copy of the same component, so the
// footer strip is deliberately excluded there rather than covered elsewhere.
//
// tests/footer.test.mjs pins the contract hard, but it does so by invoking
// Footer() directly and walking the returned element tree with
// tests/tools/react-element-tree.mjs. That never runs the shipped bundle:
// `@docusaurus/Link` and `useBaseUrl` are stubs, `styles.module.css` resolves
// to an identity proxy, and no asset pipeline runs. A footer that is correct
// as an element tree can still ship broken — the CSS module can drop, the
// wordmark's useBaseUrl() path can stop resolving to a file that exists under
// the deployed baseUrl, or a Docusaurus major can change the theme's slot so
// the swizzled component stops being mounted at all. Each of those leaves
// tests/footer.test.mjs green.
//
// These cases assert the rendered result of the production build: that the
// footer is mounted, that its wordmark actually decodes, that its outbound
// links carry the tabnabbing guard, and that the compact ProjectsBorn strip
// hydrates from the shipped data.
import { test, expect } from '../tools/e2e-coverage.cjs';

// Two routes from different plugins: the docs route and the architectures
// catalog. Asserting on both is what distinguishes "the footer renders" from
// "the footer renders on the one page we happened to check".
const ROUTES = ['/community', '/architectures'];

// Docs routes render two <footer> elements: Docusaurus' own
// `theme-doc-footer` ("Edit this page") inside the article, and the site
// footer below it. Neither position nor the CSS-module class name is stable,
// so the site footer is addressed by the one piece of content only it has.
function footerOf(page) {
  return page
    .locator('footer')
    .filter({ has: page.locator('img[alt="CNCF Logo"]') });
}

for (const route of ROUTES) {
  test(`footer is mounted on ${route}`, async ({ page }) => {
    await page.goto(route);

    const footer = footerOf(page);
    await expect(footer).toBeVisible();

    // The copyright line is rendered from `new Date().getFullYear()` at build
    // time, so it is asserted as a shape rather than against a pinned year:
    // a literal would rot every January.
    await expect(
      footer.getByText(/©\s*\d{4}\s*Cloud Native Computing Foundation/),
    ).toBeVisible();
  });
}

test('the CNCF wordmark resolves to an image that decodes', async ({
  page,
}) => {
  await page.goto(ROUTES[0]);

  const logo = footerOf(page).locator('img[alt="CNCF Logo"]');
  await expect(logo).toBeVisible();

  // Unlike the upstream portraits in community-people.spec.js, this asset is
  // served by this site from static/, so waiting for it to decode tests our
  // own build output rather than a third party's availability. A useBaseUrl()
  // path that no longer resolves under the deployed baseUrl leaves the <img>
  // in the DOM with naturalWidth 0.
  await expect
    .poll(() => logo.evaluate((img) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);

  const anchor = footerOf(page).locator('a:has(img[alt="CNCF Logo"])');
  await expect(anchor).toHaveAttribute('href', /^https:\/\/www\.cncf\.io\//);
});

test('every social icon link is https and guarded against tabnabbing', async ({
  page,
}) => {
  await page.goto(ROUTES[0]);

  // The icon links are the only footer anchors carrying a `title`, the same
  // discriminator tests/footer.test.mjs uses against the element tree.
  const icons = footerOf(page).locator('a[title]');
  const count = await icons.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const icon = icons.nth(i);
    const name = await icon.getAttribute('title');
    expect(name?.trim()).toBeTruthy();

    await expect(icon).toHaveAttribute('href', /^https:\/\//);
    await expect(icon).toHaveAttribute('target', '_blank');
    // noreferrer implies noopener, but both are asserted because the source
    // sets both and dropping either is the regression worth catching.
    await expect(icon).toHaveAttribute('rel', /noopener/);
    await expect(icon).toHaveAttribute('rel', /noreferrer/);

    // Each icon is an inline <svg>; a link whose glyph failed to inline would
    // be an unlabelled empty hit target.
    await expect(icon.locator('svg')).toHaveCount(1);
  }
});

test('the "All CNCF Sites" button links out of the site', async ({ page }) => {
  await page.goto(ROUTES[0]);

  const button = footerOf(page).getByRole('link', { name: 'All CNCF Sites' });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('href', /^https:\/\/www\.cncf\.io\//);
});

test('the compact projects-born strip hydrates from the shipped data', async ({
  page,
}) => {
  await page.goto(ROUTES[1]);

  // The compact variant is addressed by its own heading id, which is what
  // distinguishes it from the in-page section on /community.
  const strip = footerOf(page).locator(
    'section[aria-labelledby="projects-born-title-footer"]',
  );
  await expect(strip).toBeVisible();

  const projects = strip.getByRole('link', { name: /Born at / });
  const count = await projects.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    await expect(projects.nth(i)).toHaveAttribute('href', /^https?:\/\//);
  }

  // The compact variant must stay compact: the long description and the
  // closing TAB note belong to the in-page section only, and leaking them
  // into the footer on every route is the regression this guards.
  await expect(strip.locator('p')).toHaveCount(0);
});
