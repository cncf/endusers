// End-to-end coverage for the blog routes: /blog, each post permalink, the
// generated tag and author pages, and the RSS/Atom feeds.
//
// No spec has ever navigated to /blog. tests/blog-frontmatter.test.mjs pins the
// *source* contract hard — every post has frontmatter, every author key resolves
// in blog/authors.yml, every tag key resolves in blog/tags.yml — but it reads
// blog/*.md off disk and never sees a rendered route. The pages under test here
// are not authored: Docusaurus generates /blog/tags/<key> and
// /blog/authors/<key> from that frontmatter, so the only place their existence
// can be observed is the built site.
//
// That matters because docusaurus.config.js sets two of the blog plugin's
// content guards to 'warn' rather than 'throw':
//
//   onInlineTags: 'warn'
//   onUntruncatedBlogPosts: 'warn'
//
// Both are builds that still succeed. Verified against this build by mutating
// the sources: deleting a key from blog/tags.yml leaves `npm run
// build:production` green while the tag degrades to an inline entry and its
// page renders the raw key instead of the declared label; deleting a post's
// {/*truncate*/} marker leaves the build green while the post's whole body
// lands on the index. Dropping `type: ['rss', 'atom']` to `['rss']` likewise
// builds clean and simply stops emitting /blog/atom.xml. The unit suite stays
// green through all three, because nothing downstream of the build is checked.
//
// A blog *author* key that does not resolve is not in that category — it fails
// the build outright ("Blog author with key ... not found in the authors map
// file"), so the byline cases below are not guarding against that. What they
// guard is the rendering: that the byline names the author blog/authors.yml
// declares and links their page, which no source-level test can observe.
//
// Every case is driven from blog/ rather than a hardcoded post list, so a newly
// published post is covered on arrival instead of needing this file edited.
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
const POST_FILENAME = /^\d{4}-\d{2}-\d{2}-(.+)\.mdx?$/;

const authors = parse(readFileSync(join(BLOG_DIR, 'authors.yml'), 'utf8'));
const tagDefinitions = parse(readFileSync(join(BLOG_DIR, 'tags.yml'), 'utf8'));

function readPost(file) {
  const source = readFileSync(join(BLOG_DIR, file), 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error(`${file}: missing a YAML frontmatter block`);
  const frontmatter = parse(match[1]);
  const body = source.slice(match[0].length);

  // The probe for the truncate contract is the *last* section heading in the
  // post. Deriving it from the {/*truncate*/} marker instead would make the
  // test circular: removing the marker is exactly the regression under test,
  // and a probe computed from the text after the marker simply disappears
  // along with it, leaving the assertion vacuous. The last heading is below
  // the fold whenever a marker exists anywhere above it, so it stays a valid
  // probe while remaining independent of the marker.
  const headings = [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map(
    (heading) => heading[1],
  );

  return {
    file,
    slug: frontmatter.slug ?? file.replace(POST_FILENAME, '$1'),
    title: frontmatter.title,
    authors: [frontmatter.authors ?? []].flat(),
    tags: [frontmatter.tags ?? []].flat(),
    belowFoldHeading: headings.at(-1),
  };
}

const posts = readdirSync(BLOG_DIR)
  .filter((name) => POST_FILENAME.test(name))
  .sort()
  .map(readPost);

// A guard on the fixtures themselves: if the glob ever matches nothing, every
// data-driven test below would vacuously pass.
test('blog/ supplies at least one post to exercise', () => {
  expect(posts.length).toBeGreaterThan(0);
});

test.describe('blog index', () => {
  test('lists every published post with a date and a permalink', async ({
    page,
  }) => {
    await page.goto('/blog');

    const main = page.getByRole('main');
    await expect(main.locator('article')).toHaveCount(posts.length);

    for (const post of posts) {
      const heading = main.getByRole('heading', {
        name: post.title,
        exact: true,
      });
      await expect(heading, `${post.file} is missing from /blog`).toBeVisible();

      // The heading is the permalink; a post whose slug stops resolving still
      // renders its title, so assert the href, not just the text.
      await expect(heading.getByRole('link')).toHaveAttribute(
        'href',
        `/blog/${post.slug}`,
      );
    }

    // Docusaurus renders each post's date in a <time datetime=...> element.
    // Without it the listing loses its chronology entirely.
    const dates = main.locator('article time');
    await expect(dates).toHaveCount(posts.length);
    for (const datetime of await dates.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('datetime')),
    )) {
      expect(datetime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  test('shows excerpts, not whole posts', async ({ page }) => {
    await page.goto('/blog');
    const main = page.getByRole('main');

    for (const post of posts) {
      // Nothing to probe with if a post has no section headings at all.
      if (!post.belowFoldHeading) continue;

      await expect(
        main.getByRole('heading', { name: post.belowFoldHeading }),
        `${post.file}: below-the-fold content leaked onto /blog, which is what ` +
          "onUntruncatedBlogPosts: 'warn' lets through",
      ).toHaveCount(0);
    }
  });
});

test.describe('blog posts', () => {
  for (const post of posts) {
    test(`${post.slug} renders its full page`, async ({ page }) => {
      const response = await page.goto(`/blog/${post.slug}`);
      expect(response?.status()).toBe(200);

      await expect(
        page.getByRole('heading', { level: 1, name: post.title, exact: true }),
      ).toBeVisible();

      await expect(page.locator('article time')).toHaveAttribute(
        'datetime',
        /^\d{4}-\d{2}-\d{2}T/,
      );

      // The other half of the excerpt contract: content the index withheld has
      // to be present here.
      if (post.belowFoldHeading) {
        await expect(
          page.getByRole('heading', { name: post.belowFoldHeading }),
        ).toBeVisible();
      }
    });
  }
});

test.describe('blog tag pages', () => {
  const taggedPosts = new Map();
  for (const post of posts) {
    for (const tag of post.tags) {
      if (!taggedPosts.has(tag)) taggedPosts.set(tag, []);
      taggedPosts.get(tag).push(post);
    }
  }

  for (const [tag, tagPosts] of taggedPosts) {
    test(`/blog/tags/${tag} lists the posts declaring it`, async ({ page }) => {
      const response = await page.goto(`/blog/tags/${tag}`);
      // A tag key that stops resolving in blog/tags.yml degrades to an inline
      // tag under onInlineTags: 'warn', and this route stops being generated.
      expect(
        response?.status(),
        `/blog/tags/${tag} was not generated; blog/tags.yml may no longer ` +
          `define "${tag}"`,
      ).toBe(200);

      // The heading carries the human label from blog/tags.yml, not the key.
      // An inline tag — what onInlineTags: 'warn' degrades to when the key
      // stops resolving — renders the raw key instead, so this pins the
      // key -> label mapping rather than restating it. No `?? tag` fallback:
      // that would make the assertion satisfy itself for exactly the broken
      // case it exists to catch.
      const definition = tagDefinitions[tag];
      expect(
        definition?.label,
        `blog/tags.yml does not define a label for "${tag}"`,
      ).toBeTruthy();
      await expect(page.getByRole('heading', { level: 1 })).toContainText(
        definition.label,
      );

      const main = page.getByRole('main');
      for (const post of tagPosts) {
        await expect(
          main.getByRole('heading', { name: post.title, exact: true }),
        ).toBeVisible();
      }
      await expect(main.locator('article')).toHaveCount(tagPosts.length);
    });
  }

  test('the tag index links every tag in use', async ({ page }) => {
    await page.goto('/blog/tags');
    const main = page.getByRole('main');
    for (const tag of taggedPosts.keys()) {
      await expect(
        main.locator(`a[href="/blog/tags/${tag}"]`),
        `/blog/tags is missing a link to the "${tag}" tag`,
      ).toHaveCount(1);
    }
  });
});

test.describe('blog author bylines', () => {
  // An unresolvable author key fails the build, so it needs no assertion here.
  // What is unobserved is the rendered byline: whether the post page actually
  // names the author blog/authors.yml declares and links their page. The name
  // is read from authors.yml rather than from the page, so the assertion
  // cannot be satisfied by whatever the page happens to render.
  for (const post of posts) {
    test(`${post.slug} attributes its declared authors`, async ({ page }) => {
      await page.goto(`/blog/${post.slug}`);
      const article = page.getByRole('main').locator('article');

      for (const key of post.authors) {
        const author = authors[key];
        expect(
          author?.name,
          `blog/authors.yml does not define "${key}", declared by ${post.file}`,
        ).toBeTruthy();

        await expect(
          article.getByText(author.name, { exact: true }).first(),
          `${post.file}: byline does not name ${author.name}`,
        ).toBeVisible();

        // An author with a page is also linked from the byline.
        if (author.page) {
          await expect(
            article.locator(`a[href="/blog/authors/${key}"]`).first(),
          ).toBeVisible();
        }
      }
    });
  }
});

test.describe('blog author pages', () => {
  // `page: true` is what asks Docusaurus to generate /blog/authors/<key>.
  const paged = Object.entries(authors).filter(([, author]) => author?.page);

  for (const [key, author] of paged) {
    test(`/blog/authors/${key} renders ${author.name}`, async ({ page }) => {
      const response = await page.goto(`/blog/authors/${key}`);
      expect(
        response?.status(),
        `/blog/authors/${key} was not generated even though blog/authors.yml ` +
          `declares "${key}" with page: true`,
      ).toBe(200);

      await expect(page.getByRole('heading', { level: 1 })).toContainText(
        author.name,
      );

      // Authors with no posts yet still get a page; only assert a listing for
      // the ones who have written something.
      const own = posts.filter((post) => post.authors.includes(key));
      const main = page.getByRole('main');
      for (const post of own) {
        await expect(
          main.getByRole('heading', { name: post.title, exact: true }),
        ).toBeVisible();
      }
      await expect(main.locator('article')).toHaveCount(own.length);
    });
  }
});

test.describe('blog feeds', () => {
  // feedOptions.type is ['rss', 'atom'] in docusaurus.config.js. The feeds are
  // build artefacts with no page that renders them, so a regression in that
  // config is invisible everywhere else in the suite.
  for (const [name, path] of [
    ['RSS', '/blog/rss.xml'],
    ['Atom', '/blog/atom.xml'],
  ]) {
    test(`the ${name} feed is served and carries every post`, async ({
      request,
    }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('xml');

      const body = await response.text();
      for (const post of posts) {
        expect(body, `${path} does not link /blog/${post.slug}`).toContain(
          `/blog/${post.slug}`,
        );
      }
    });
  }

  test('post pages advertise the feeds for discovery', async ({ page }) => {
    await page.goto(`/blog/${posts[0].slug}`);
    for (const [type, path] of [
      ['application/rss+xml', '/blog/rss.xml'],
      ['application/atom+xml', '/blog/atom.xml'],
    ]) {
      await expect(
        page.locator(`link[rel="alternate"][type="${type}"]`),
      ).toHaveAttribute('href', path);
    }
  });
});
