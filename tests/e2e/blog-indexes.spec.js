// End-to-end coverage for the two blog index routes the plugin emits and the
// sitemap advertises, but which no spec has ever loaded: /blog/archive and
// /blog/authors.
//
// Both are in build/sitemap.xml, so a crawler reaches them, yet neither is
// linked from any built page on the site — nothing in the navbar, the blog
// listing or the footer points at them. That makes them the two routes on the
// site least likely to be noticed when they break: no human click path leads
// there, and no test went there either.
//
// tests/blog-frontmatter.test.mjs asserts the same underlying data, but it
// reads blog/*.md, blog/authors.yml and blog/tags.yml off disk; no unit test
// in the suite opens build/. It therefore cannot see the pages these indexes
// render. The two failures that matter are invisible at source level:
//
//   - a post that never appears in the archive, or appears under the wrong
//     year, because its filename date stopped parsing;
//   - an author whose post-count badge disagrees with the posts that actually
//     declare them, which is the only place on the site that count is shown.
//
// Everything is derived from blog/ rather than hardcoded, so a newly published
// post or a newly declared author is covered on arrival without editing this
// file.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from '../tools/e2e-coverage.cjs';
import { parse } from 'yaml';

// Playwright transpiles these .js specs to CommonJS (the package is not
// "type": "module"), so import.meta is not available here. Playwright resolves
// testDir against the directory holding playwright.config.js and runs from the
// project root, so blog/ is addressed from there.
const BLOG_DIR = resolve('blog');

// Same shape tests/blog-frontmatter.test.mjs enforces: YYYY-MM-DD-<slug>.md.
// No post carries a `date:` in frontmatter, so the filename is what Docusaurus
// dates the post from, and therefore what decides its archive year.
const POST_FILENAME = /^(\d{4})-\d{2}-\d{2}-(.+)\.mdx?$/;

const authors = parse(readFileSync(join(BLOG_DIR, 'authors.yml'), 'utf8'));

function readPost(file) {
  const [, year, filenameSlug] = file.match(POST_FILENAME);
  const source = readFileSync(join(BLOG_DIR, file), 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error(`${file}: missing a YAML frontmatter block`);
  const frontmatter = parse(match[1]);

  return {
    file,
    year,
    slug: frontmatter.slug ?? filenameSlug,
    title: frontmatter.title,
    authors: [frontmatter.authors ?? []].flat(),
  };
}

const posts = readdirSync(BLOG_DIR)
  .filter((name) => POST_FILENAME.test(name))
  .sort()
  .map(readPost);

const years = [...new Set(posts.map((post) => post.year))].sort();

const authorKeys = Object.keys(authors);

// Docusaurus renders each archive year as an anchored heading: the year text
// followed by a hash-link carrying aria-label="Direct link to <year>". The
// heading's *accessible* name therefore concatenates both, so it is matched on
// text content instead, which is the year plus the hash-link's zero-width
// space. The trailing-character class keeps this anchored to the whole heading
// rather than degrading into a substring match.
//
// The selector is deliberately root-relative (no leading `main`) so the same
// locator can be reused inside `filter({ has: ... })`, where Playwright
// re-roots it against the candidate element.
function yearHeading(page, year) {
  return page
    .locator(':is(h1, h2, h3, h4)')
    .filter({ hasText: new RegExp(`^${year}[\\s\\u200b]*$`) });
}

// The badge each author carries on the index is their post count, so derive
// the expected value from the posts rather than restating it. Authors with no
// posts are listed too, and must show 0 — an author dropped from the listing
// entirely is a different failure from one shown with the wrong count.
const postCounts = Object.fromEntries(
  authorKeys.map((key) => [
    key,
    posts.filter((post) => post.authors.includes(key)).length,
  ]),
);

// `docusaurus serve` answers an unknown path with the 404 page, so the status
// alone is not conclusive; both are asserted.
async function gotoIndex(page, path) {
  const response = await page.goto(path);

  expect(response?.status(), `${path} should not 404`).toBeLessThan(400);
  await expect(
    page.getByRole('heading', { name: 'Page Not Found' }),
  ).toHaveCount(0);
}

test.describe('blog archive', () => {
  test('renders its heading and one section per publication year', async ({
    page,
  }) => {
    await gotoIndex(page, '/blog/archive');

    await expect(
      page.getByRole('heading', { name: 'Archive', level: 1 }),
    ).toBeVisible();

    for (const year of years) {
      await expect(
        yearHeading(page, year),
        `the archive should group posts under a ${year} heading`,
      ).toBeVisible();
    }
  });

  test('links every published post exactly once', async ({ page }) => {
    await gotoIndex(page, '/blog/archive');

    // Scoped to the archive's own list so the navbar and footer links cannot
    // satisfy the count.
    const postLinks = page.locator('main a[href^="/blog/"]');

    await expect(
      postLinks,
      'the archive should list one link per post in blog/',
    ).toHaveCount(posts.length);
  });

  for (const post of posts) {
    test(`lists ${post.slug} under ${post.year} with its title`, async ({
      page,
    }) => {
      await gotoIndex(page, '/blog/archive');

      // The link text is "<Month> <day> - <title>", so the accessible name is
      // not the title alone; match on the href and assert the title is part of
      // the rendered text.
      const link = page.locator(`main a[href$="/blog/${post.slug}"]`);

      await expect(
        link,
        `${post.file} should appear in the archive`,
      ).toHaveCount(1);
      await expect(link).toContainText(post.title);

      // Docusaurus renders each year as a heading followed by that year's list.
      // Asserting the link sits inside the section headed by the post's own
      // year is what catches a post filed under the wrong year, which a bare
      // "the link exists" check would pass.
      const section = page.locator('main .row > div').filter({
        has: yearHeading(page, post.year),
      });

      await expect(
        section.locator(`a[href$="/blog/${post.slug}"]`),
        `${post.file} should be grouped under ${post.year}`,
      ).toHaveCount(1);
    });
  }
});

test.describe('blog authors index', () => {
  test('renders its heading and one entry per declared author', async ({
    page,
  }) => {
    await gotoIndex(page, '/blog/authors');

    await expect(
      page.getByRole('heading', { name: 'Authors', level: 1 }),
    ).toBeVisible();

    await expect(
      page.locator('main a[href^="/blog/authors/"]').first(),
      'the index should link at least one author page',
    ).toBeVisible();
  });

  for (const key of authorKeys) {
    const author = authors[key];

    test(`lists ${key} with a link to their page`, async ({ page }) => {
      await gotoIndex(page, '/blog/authors');

      const link = page.locator(`main a[href$="/blog/authors/${key}"]`).first();

      await expect(
        link,
        `blog/authors.yml declares ${key}, so the index should link them`,
      ).toBeVisible();

      // The name is read from authors.yml rather than from the page, so the
      // assertion fails if the rendered name drifts from the declared one.
      await expect(
        page.getByRole('heading', { name: author.name, level: 2 }),
        `${key} should be rendered under their declared name`,
      ).toBeVisible();
    });

    test(`shows ${key} with a post count of ${postCounts[key]}`, async ({
      page,
    }) => {
      await gotoIndex(page, '/blog/authors');

      // The listing entry is the nearest ancestor holding both the author's
      // link and their count badge.
      const entry = page
        .locator('main li')
        .filter({ has: page.locator(`a[href$="/blog/authors/${key}"]`) })
        .first();

      await expect(
        entry,
        `blog/authors.yml declares ${key}, so the index should list them`,
      ).toHaveCount(1);

      // This count exists nowhere else on the site, so nothing but this
      // assertion would notice it disagreeing with blog/.
      await expect(
        entry.locator('[class*="authorBlogPostCount"]'),
        `${key} authors ${postCounts[key]} post(s) in blog/`,
      ).toHaveText(String(postCounts[key]));
    });
  }
});
