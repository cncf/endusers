// End-to-end coverage for the User Groups section: the
// /community/user-groups generated-index route and the two leaf docs it lists.
//
// This page is the one part of the community tree that has no source document.
// docs/community/user-groups/_category_.json declares
// `link.type: "generated-index"`, so Docusaurus synthesises the whole page at
// build time — the heading and blurb from that JSON, and one card per doc in
// the directory carrying that doc's frontmatter `title` and `description`.
//
// Nothing on disk holds the result, so no unit test can assert it: moving a
// doc out of the directory, renaming a `slug`, or dropping a frontmatter
// `description` empties or mislabels the index while the sidebar still renders
// correctly. docs/community/index.md links here as the way a visitor finds a
// peer group, so that regression is worth catching.
//
// No other spec loads these routes. legacy-urls.spec.js reaches the two leaves
// by clicking through the /community/telecom-user-group and
// /community/public-sector-user-group stubs, but asserts only that the
// destination is not a 404 and that an `article` element exists — never the
// page's own content, and never the index. The eleven other specs navigate to
// /, /architectures, /blog, /blog/tags, /community, /community/awards,
// /community/members, /metrics, /resources/case-studies and
// /resources/radar-reports.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { test, expect } from '../tools/e2e-coverage.cjs';

// Resolved from the working directory, as tests/e2e/architecture-detail.spec.js
// and tests/e2e/awards.spec.js already do: Playwright runs the suite from the
// directory holding playwright.config.js, which is the repository root.
const GROUPS_DIR = resolve('docs/community/user-groups');

// Expectations are read from the same sources the build reads, rather than
// restated here, so that adding a third user group extends this contract
// instead of breaking it. What the spec pins is the *relationship* between the
// sources and the rendered page.
const category = JSON.parse(
  readFileSync(join(GROUPS_DIR, '_category_.json'), 'utf8'),
);
const INDEX_PATH = category.link.slug;

// Matches the frontmatter reader in tests/docs-contract.test.mjs and
// tests/legacy-url-stubs.test.mjs: a leading `---` fence, values taken as
// single-line `key: value` pairs with optional surrounding quotes.
function frontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!match) return null;
  return match[1].replace(/^['"]|['"]$/g, '');
}

function readGroupDocs() {
  return readdirSync(GROUPS_DIR)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => {
      const source = readFileSync(join(GROUPS_DIR, entry), 'utf8');
      const fence = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const frontmatter = fence ? fence[1] : '';

      return {
        file: entry,
        title: frontmatterValue(frontmatter, 'title'),
        description: frontmatterValue(frontmatter, 'description'),
        slug: frontmatterValue(frontmatter, 'slug'),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

const GROUP_DOCS = readGroupDocs();

function normalise(pathname) {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

async function expectNotNotFound(page) {
  await expect(
    page.getByRole('heading', { name: 'Page Not Found' }),
  ).toHaveCount(0);
}

// Docusaurus's documented stable theme class names for DocCardList, which is
// what a generated-index renders. Selecting on these rather than on the
// hashed CSS-module classes beside them keeps the spec tied to the theme
// contract instead of to a build hash.
const CARD = '.theme-doc-card-container';
const CARD_TITLE = '.theme-doc-card-title';
const CARD_DESCRIPTION = '.theme-doc-card-description';

test.describe('User Groups section', () => {
  // Guards every assertion below from passing vacuously because the docs
  // directory was emptied or the frontmatter stopped parsing.
  test('the source docs declare the metadata the index is built from', () => {
    expect(GROUP_DOCS.length).toBeGreaterThan(1);

    const incomplete = GROUP_DOCS.filter(
      (doc) => !doc.title || !doc.description || !doc.slug,
    ).map((doc) => doc.file);

    expect(
      incomplete,
      'each user-group doc needs a frontmatter title, description and slug; the generated index has no other source for its cards',
    ).toEqual([]);
  });

  test('the generated index is served', async ({ page }) => {
    const response = await page.goto(INDEX_PATH);

    // `docusaurus serve` answers an unknown path with the 404 page, so the
    // status alone is not conclusive; both are asserted.
    expect(response?.status(), `${INDEX_PATH} should not 404`).toBeLessThan(
      400,
    );
    await expectNotNotFound(page);
  });

  test('the index renders the category title and description', async ({
    page,
  }) => {
    await page.goto(INDEX_PATH);

    await expect(
      page.getByRole('heading', { name: category.link.title, exact: true }),
    ).toBeVisible();

    // The blurb lives only in _category_.json, and is rendered into the page
    // `header` above the card list rather than into the `article` that holds
    // the cards. If the generated-index link is ever downgraded to a plain
    // `doc` link, or the description dropped, the page still renders a
    // heading and cards — this is the assertion that notices.
    await expect(
      page.getByRole('main').getByText(category.link.description, {
        exact: false,
      }),
    ).toBeVisible();
  });

  test('the index shows one card per doc in the directory', async ({
    page,
  }) => {
    await page.goto(INDEX_PATH);

    const titles = await page.locator(CARD).locator(CARD_TITLE).allInnerTexts();

    expect(
      titles.map((title) => title.trim()).sort(),
      'every doc under docs/community/user-groups/ should have a card, and nothing else should',
    ).toEqual(GROUP_DOCS.map((doc) => doc.title).sort());
  });

  for (const doc of GROUP_DOCS) {
    test(`the ${doc.title} card carries its doc's description and link`, async ({
      page,
    }) => {
      await page.goto(INDEX_PATH);

      const card = page.locator(CARD).filter({
        has: page.locator(CARD_TITLE, { hasText: doc.title }),
      });
      await expect(card).toHaveCount(1);

      // The description is the frontmatter value verbatim. A doc that loses
      // its `description` still gets a card, just an unhelpfully blank one,
      // which is exactly the silent regression this pins.
      await expect(card.locator(CARD_DESCRIPTION)).toHaveText(doc.description);

      const href = await card.getAttribute('href');
      expect(normalise(new URL(href, 'http://localhost').pathname)).toBe(
        normalise(doc.slug),
      );
    });

    test(`the ${doc.title} card leads to ${doc.slug}`, async ({ page }) => {
      await page.goto(INDEX_PATH);

      await page
        .locator(CARD)
        .filter({ has: page.locator(CARD_TITLE, { hasText: doc.title }) })
        .click();

      expect(normalise(new URL(page.url()).pathname)).toBe(normalise(doc.slug));
      await expectNotNotFound(page);
    });

    test(`${doc.slug} renders its own page`, async ({ page }) => {
      const response = await page.goto(doc.slug);

      expect(response?.status(), `${doc.slug} should not 404`).toBeLessThan(
        400,
      );
      await expectNotNotFound(page);
      await expect(page.locator('article h1')).toBeVisible();

      // These are ordinary listed docs, unlike the /community/*-user-group
      // stubs that forward to them (see legacy-urls.spec.js). If one ever
      // picked up `unlisted: true` it would drop out of the sidebar and the
      // sitemap while still answering requests.
      await expect(
        page.getByText('This page is unlisted.', { exact: false }),
      ).toHaveCount(0);
    });
  }

  test('the index and its leaves are in the sitemap', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);

    // The `<loc>` entries are absolute URLs, and a substring match for a slug
    // would also hit any longer path that contains it. Compare parsed
    // pathnames instead.
    const paths = [
      ...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g),
    ].map(([, loc]) => normalise(new URL(loc).pathname));

    const expected = [INDEX_PATH, ...GROUP_DOCS.map((doc) => doc.slug)];
    const missing = expected.filter(
      (route) => !paths.includes(normalise(route)),
    );

    expect(
      missing,
      'the User Groups index and every group page should be indexable',
    ).toEqual([]);
  });
});
