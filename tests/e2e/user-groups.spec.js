// End-to-end coverage for the User Groups section: the
// /community/user-groups hub page and the leaf docs it lists.
//
// The hub is an ordinary document, docs/community/user-groups/index.md, whose
// frontmatter `slug` publishes it at the directory's own route and whose body
// links to each group. It replaced a `generated-index` category link, which
// Docusaurus synthesised without an `article header h1` and which therefore
// indexed into site search under an empty title.
//
// The relationship this spec pins is between the sources on disk and the
// rendered page: the hub's frontmatter against its heading and meta
// description, and its body links against the group docs in the directory.
// Moving a doc out of the directory, renaming a `slug`, or dropping a
// frontmatter `description` leaves the hub linking nowhere, or the leaf page
// unlabelled, while the sidebar still renders correctly.
// docs/community/index.md links here as the way a visitor finds a peer group,
// so that regression is worth catching.
//
// No other spec loads these routes: the others navigate to /, /architectures,
// /blog, /blog/tags, /community, /community/awards, /community/members,
// /resources/metrics, /resources/case-studies and /resources/radar-reports.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { test, expect } from '../tools/e2e-coverage.cjs';

// Resolved from the working directory, as tests/e2e/architecture-detail.spec.js
// and tests/e2e/awards.spec.js already do: Playwright runs the suite from the
// directory holding playwright.config.js, which is the repository root.
const GROUPS_DIR = resolve('docs/community/user-groups');

// The hub document is the directory's own page rather than one of the groups
// it lists, so it is read separately and excluded from the group set below.
const HUB_FILE = 'index.md';

// Matches the frontmatter reader in tests/docs-contract.test.mjs: a leading
// `---` fence, values taken as single-line `key: value` pairs with optional
// surrounding quotes.
function frontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!match) return null;
  return match[1].replace(/^['"]|['"]$/g, '');
}

function readDoc(entry) {
  const source = readFileSync(join(GROUPS_DIR, entry), 'utf8');
  const fence = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = fence ? fence[1] : '';

  return {
    file: entry,
    title: frontmatterValue(frontmatter, 'title'),
    description: frontmatterValue(frontmatter, 'description'),
    slug: frontmatterValue(frontmatter, 'slug'),
  };
}

function readGroupDocs() {
  return readdirSync(GROUPS_DIR)
    .filter((entry) => entry.endsWith('.md') && entry !== HUB_FILE)
    .map(readDoc)
    .sort((a, b) => a.file.localeCompare(b.file));
}

const HUB = readDoc(HUB_FILE);
const INDEX_PATH = HUB.slug;
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

// The hub lists its groups as ordinary prose links in the document body, so
// the links are selected from the rendered `article` rather than from the
// `DocCardList` theme classes a generated index used to emit.
const BODY_LINK = 'article a[href]';

test.describe('User Groups section', () => {
  // Guards every assertion below from passing vacuously because the docs
  // directory was emptied or the frontmatter stopped parsing.
  test('the source docs declare the metadata the hub is built from', () => {
    expect(GROUP_DOCS.length).toBeGreaterThan(1);

    const incomplete = GROUP_DOCS.filter(
      (doc) => !doc.title || !doc.description || !doc.slug,
    ).map((doc) => doc.file);

    expect(
      incomplete,
      'each user-group doc needs a frontmatter title, description and slug; the hub and the search index have no other source for them',
    ).toEqual([]);

    expect(
      [HUB.title, HUB.description, HUB.slug].every(Boolean),
      `${HUB_FILE} needs a frontmatter title, description and slug of its own`,
    ).toBe(true);
  });

  test('the hub page is served', async ({ page }) => {
    const response = await page.goto(INDEX_PATH);

    // `docusaurus serve` answers an unknown path with the 404 page, so the
    // status alone is not conclusive; both are asserted.
    expect(response?.status(), `${INDEX_PATH} should not 404`).toBeLessThan(
      400,
    );
    await expectNotNotFound(page);
  });

  test('the hub renders its frontmatter title as a real heading', async ({
    page,
  }) => {
    await page.goto(INDEX_PATH);

    // This is the assertion that would have caught the regression the hub
    // replaced. A `generated-index` category route renders its heading
    // outside `article`, so the search plugin — which reads page titles from
    // `article header h1` — indexed this route with an empty title, leaving
    // it unreachable by name. Selecting the same element the indexer does
    // keeps the two in step.
    const heading = page.locator('article header h1');
    await expect(heading).toHaveCount(1);
    await expect(heading).toHaveText(HUB.title);
  });

  test('the hub publishes its frontmatter description to crawlers', async ({
    page,
  }) => {
    await page.goto(INDEX_PATH);

    // The blurb lives only in the frontmatter, and is rendered into the page
    // metadata rather than into the body. If it is ever dropped, the page
    // still renders a heading and its links — this is the assertion that
    // notices.
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      HUB.description,
    );
  });

  test('the hub links to every doc in the directory, and to nothing else under it', async ({
    page,
  }) => {
    await page.goto(INDEX_PATH);

    const hrefs = await page
      .locator(BODY_LINK)
      .evaluateAll((anchors) =>
        anchors.map((anchor) => anchor.getAttribute('href')),
      );

    const linkedGroupRoutes = [
      ...new Set(
        hrefs
          .map((href) => normalise(new URL(href, 'http://localhost').pathname))
          .filter(
            (route) =>
              route.startsWith(`${normalise(INDEX_PATH)}/`) &&
              route !== normalise(INDEX_PATH),
          ),
      ),
    ].sort();

    expect(
      linkedGroupRoutes,
      'every doc under docs/community/user-groups/ should be linked from the hub, and nothing else should',
    ).toEqual(GROUP_DOCS.map((doc) => normalise(doc.slug)).sort());
  });

  for (const doc of GROUP_DOCS) {
    test(`the hub's ${doc.title} link leads to ${doc.slug}`, async ({
      page,
    }) => {
      await page.goto(INDEX_PATH);

      const link = page
        .locator(BODY_LINK)
        .filter({ hasText: doc.title })
        .first();
      await expect(link).toBeVisible();

      await link.click();

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

      // The description is the frontmatter value verbatim. A doc that loses
      // its `description` still renders, just without the summary search
      // results and link previews show, which is exactly the silent
      // regression this pins.
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        'content',
        doc.description,
      );

      // These are ordinary listed docs. If one ever picked up
      // `unlisted: true` it would drop out of the sidebar and the sitemap
      // while still answering requests.
      await expect(
        page.getByText('This page is unlisted.', { exact: false }),
      ).toHaveCount(0);
    });
  }

  test('the hub and its leaves are in the sitemap', async ({ request }) => {
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
      'the User Groups hub and every group page should be indexable',
    ).toEqual([]);
  });
});
