// End-to-end coverage for the /community/technical-community-groups
// generated-index route and the leaf docs it lists.
//
// `docs/community/technical-community-groups/_category_.json` declares
// `link.type: "generated-index"`, so this route has no source document at all.
// Docusaurus synthesises the whole page: the <h1> and the blurb come from that
// JSON, and one card per doc in the directory is built from each doc's
// frontmatter `title` and `description`.
//
// Nothing on disk holds that result, so no unit test can assert it — and
// before this file, the string "technical-community-groups" did not appear
// anywhere under tests/. `npm run test:unit:coverage` cannot see the gap
// either: on `main` @ `7772dcf` it reports `src files | 99.84 | 98.46 |
// 6329/6339 lines` while this route is entirely unexercised, because a
// generated index contributes no executable source lines of its own.
//
// The route is not incidental. `docs/community/index.md` links to it twice
// (as the way a visitor finds a topic group, and as step 3 of "get involved"),
// and `docs/community/technical-advisory-board.md` names it as one of the two
// bodies the TAB governs. Moving a doc out of this directory, renaming a
// `slug`, or dropping a frontmatter `description` would empty or mislabel the
// page while every existing test stayed green.
//
// Expectations are read from `_category_.json` and the leaf frontmatter rather
// than hardcoded, so a newly added TCG is covered on arrival instead of
// needing this file edited.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { parse } from 'yaml';

// Playwright transpiles these .js specs to CommonJS (the package is not
// "type": "module"), so import.meta is not available here. Playwright resolves
// testDir against the directory holding playwright.config.js and runs from the
// project root, so the docs are addressed from there.
const DOCS_DIR = resolve('docs/community/technical-community-groups');

const category = JSON.parse(
  readFileSync(join(DOCS_DIR, '_category_.json'), 'utf8'),
);

const INDEX_PATH = category.link.slug;

function frontmatter(file) {
  const source = readFileSync(join(DOCS_DIR, file), 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  expect(match, `${file} should open with a frontmatter block`).not.toBeNull();
  return parse(match[1]);
}

// One entry per doc in the directory. `_category_.json` is configuration, not
// a doc, so it is excluded; everything else in here is a TCG page and is
// expected to show up as a card.
const leaves = readdirSync(DOCS_DIR)
  .filter((entry) => entry.endsWith('.md') || entry.endsWith('.mdx'))
  .sort()
  .map((file) => ({ file, ...frontmatter(file) }));

function normalise(pathname) {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

async function expectNotNotFound(page) {
  await expect(
    page.getByRole('heading', { name: 'Page Not Found' }),
  ).toHaveCount(0);
}

// A guard on the fixtures themselves: without it, a directory that stopped
// yielding docs would turn the per-leaf cases below into zero tests and this
// file would pass while asserting almost nothing.
test('the category declares a generated index with at least one doc', () => {
  expect(category.link.type).toBe('generated-index');
  expect(INDEX_PATH).toBe('/community/technical-community-groups');
  expect(leaves.length).toBeGreaterThan(0);

  for (const leaf of leaves) {
    expect(leaf.title, `${leaf.file} needs a frontmatter title`).toBeTruthy();
    expect(
      leaf.description,
      `${leaf.file} needs a frontmatter description — the card body is built from it`,
    ).toBeTruthy();
    expect(leaf.slug, `${leaf.file} needs a frontmatter slug`).toBeTruthy();
  }
});

test.describe('technical community groups index', () => {
  test('serves the generated index', async ({ page }) => {
    const response = await page.goto(INDEX_PATH);

    // `docusaurus serve` answers an unknown path with the 404 page, so the
    // status alone is not conclusive; both are asserted.
    expect(response?.status(), `${INDEX_PATH} should not 404`).toBeLessThan(
      400,
    );
    await expectNotNotFound(page);
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('renders the title and description declared in _category_.json', async ({
    page,
  }) => {
    await page.goto(INDEX_PATH);

    // These two strings exist only in _category_.json. If the file is renamed,
    // reshaped, or loses its `link` block, Docusaurus silently falls back to
    // the directory name and drops the blurb — a build that stays green.
    await expect(
      page.getByRole('heading', { level: 1, name: category.link.title }),
    ).toBeVisible();
    await expect(page.getByText(category.link.description)).toBeVisible();
  });

  test('keeps the community sidebar and breadcrumb trail', async ({ page }) => {
    await page.goto(INDEX_PATH);

    // sidebars.js routes this directory through the autogenerated
    // communitySidebar. A generated index that drops out of it becomes
    // reachable only by typing the URL.
    await expect(page.locator('nav.menu').first()).toBeVisible();

    const breadcrumbs = page.getByLabel('Breadcrumbs');
    await expect(breadcrumbs).toBeVisible();
    await expect(breadcrumbs.getByText(category.link.title)).toBeVisible();
  });

  test('shows exactly one card per doc in the directory', async ({ page }) => {
    await page.goto(INDEX_PATH);

    const cards = page.locator('a.theme-doc-card-container');
    await expect(cards).toHaveCount(leaves.length);
  });

  for (const leaf of leaves) {
    test(`cards ${leaf.file} with its own title and description`, async ({
      page,
    }) => {
      await page.goto(INDEX_PATH);

      const card = page.locator('a.theme-doc-card-container').filter({
        has: page.getByRole('heading', { level: 2, name: leaf.title }),
      });
      await expect(card).toHaveCount(1);

      // Docusaurus truncates the card description with CSS, not by cutting the
      // string, so the full frontmatter text is present in the DOM.
      await expect(card.getByText(leaf.description)).toBeVisible();

      const href = await card.getAttribute('href');
      expect(normalise(href ?? '')).toBe(normalise(leaf.slug));
    });

    test(`the ${leaf.file} card reaches a rendered page`, async ({ page }) => {
      await page.goto(INDEX_PATH);

      const card = page.locator('a.theme-doc-card-container').filter({
        has: page.getByRole('heading', { level: 2, name: leaf.title }),
      });
      await card.click();

      expect(normalise(new URL(page.url()).pathname)).toBe(
        normalise(leaf.slug),
      );
      await expectNotNotFound(page);

      // The leaf's own <h1> is written in its body, not derived from the
      // frontmatter title, so this catches a page that resolves to an empty
      // shell as well as one that 404s.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  }

  test('the index and its leaves are listed in the sitemap', async ({
    request,
  }) => {
    // These pages are the public entry point for topic groups, so they have to
    // be indexable. The `<loc>` entries are absolute URLs; compare parsed
    // pathnames so a substring match cannot pass for a different route.
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);

    const paths = [
      ...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g),
    ].map(([, loc]) => normalise(new URL(loc).pathname));

    const expected = [INDEX_PATH, ...leaves.map((leaf) => leaf.slug)].map(
      normalise,
    );

    expect(expected.filter((path) => !paths.includes(path))).toEqual([]);
  });
});
