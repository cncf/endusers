// End-to-end coverage for /events, the one top-level navbar destination with
// no spec of its own. navigation.spec.js and practitioners-home.spec.js name
// the route only as a link target, so the sole assertion it has ever received
// is the generic "main is visible" check in the navbar loop.
//
// tests/events-page.test.mjs is a thorough contract for the *source* of
// docs/events/index.md — frontmatter, the Upcoming/Past sections, the
// "Last verified" date, that every `require('@site/...')` asset exists on
// disk, and that every internal link names a real doc route. It reads Markdown
// off disk, so three failure modes survive it:
//
//   * The hero photo is embedded as
//     `require('@site/static/img/...').default`, which webpack resolves during
//     the build into a hashed URL under baseUrl. The unit test proves only
//     that the source file exists; it cannot see whether the served page
//     emits an <img> a browser can actually fetch and decode.
//   * The figcaption's `<Link to="/community/awards">` is checked against the
//     set of known doc routes in the source. Nothing proves the built anchor
//     resolves under baseUrl and navigates.
//   * The Upcoming/Past structure is asserted in Markdown but never in the
//     rendered DOM, so an MDX compile or theme regression can leave the route
//     reachable while rendering an empty shell.
//
// The expectations below are derived from docs/events/index.md rather than
// hardcoded, the way awards.spec.js drives itself from data/awards.json: an
// edit to the page is covered on arrival instead of needing this spec
// rewritten.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '../tools/e2e-coverage.cjs';

const EVENTS_PATH = '/events/';
const AWARDS_PATH = '/community/awards';

// Playwright transpiles these .js specs to CommonJS (the package is not
// "type": "module"), so import.meta is unavailable. Playwright runs from the
// directory holding playwright.config.js, so the doc is addressed from the
// project root.
const source = readFileSync(resolve('docs/events/index.md'), 'utf8');
const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
const body = frontmatter ? source.slice(frontmatter[0].length) : source;

function frontmatterValue(key) {
  const matched = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(
    frontmatter ? frontmatter[1] : '',
  );
  return matched ? matched[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

const pageTitle = frontmatterValue('title');
const pageDescription = frontmatterValue('description');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Section headings in document order. The page's own contract is that
// "Upcoming" precedes "Past"; asserting the order in the DOM is what proves
// a reader is not shown last year's events first.
const sectionHeadings = [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map(
  ([, heading]) => heading,
);

// The alt text is the stable handle on the hero <img>: the src is a
// build-hashed URL that cannot be predicted from the source.
const heroAlt = /<img\b[\s\S]*?\balt="([^"]+)"/.exec(body)?.[1];

// Outbound links, deduplicated. Asserted as rendered hrefs only — never
// requested, so the suite makes no third-party traffic from CI.
const externalHosts = [
  ...new Set(
    [...body.matchAll(/\]\(\s*(https?:\/\/[^)\s]+)/g)].map(
      ([, url]) => new URL(url).host,
    ),
  ),
];

// Docusaurus renders a zero-width hash-link anchor inside every heading, so
// the rendered text carries a U+200B the source never had.
function stripAnchor(text) {
  return text.replace(/\u200b/g, '').trim();
}

async function gotoEvents(page) {
  const response = await page.goto(EVENTS_PATH);

  // `docusaurus serve` answers an unknown path with the 404 page, so the
  // status alone is not conclusive; both are asserted.
  expect(response?.status(), `${EVENTS_PATH} should not 404`).toBeLessThan(400);
  await expect(
    page.getByRole('heading', { name: 'Page Not Found' }),
  ).toHaveCount(0);

  return response;
}

test.describe('events page', () => {
  test('renders its title and frontmatter metadata', async ({ page }) => {
    await gotoEvents(page);

    await expect(
      page.getByRole('heading', { name: pageTitle, level: 1 }),
    ).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();

    // The document title and meta description are emitted by the docs plugin
    // from this page's frontmatter. They are what a search engine and a shared
    // link show, and nothing else in either suite reads them off the built
    // page: tests/events-page.test.mjs only asserts the frontmatter keys are
    // present in the source.
    await expect(page).toHaveTitle(
      new RegExp(`^${escapeRegExp(pageTitle)}\\b`),
    );
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      pageDescription,
    );
  });

  test('renders every section heading in source order', async ({ page }) => {
    await gotoEvents(page);

    expect(
      sectionHeadings.length,
      'docs/events/index.md has no "##" sections; this spec needs updating if the page stopped using them',
    ).toBeGreaterThan(0);

    const article = page.locator('article');
    for (const heading of sectionHeadings) {
      // Docusaurus appends a zero-width hash-link anchor inside every heading,
      // so the accessible name is never an exact match for the source text.
      await expect(
        article.getByRole('heading', { name: heading }),
      ).toBeVisible();
    }

    const rendered = await article
      .getByRole('heading', { level: 2 })
      .allInnerTexts();
    const positions = sectionHeadings.map((heading) =>
      rendered.findIndex((text) => stripAnchor(text) === heading),
    );
    expect(
      positions,
      'a section heading declared in docs/events/index.md did not render',
    ).not.toContain(-1);
    expect(
      positions,
      'section headings render in a different order than docs/events/index.md declares them',
    ).toEqual([...positions].sort((a, b) => a - b));
  });

  test('serves the hero photo the page requires', async ({ page }) => {
    await gotoEvents(page);

    expect(
      heroAlt,
      'docs/events/index.md no longer embeds an <img> with alt text; this spec needs updating',
    ).toBeTruthy();

    const hero = page.locator('article').getByAltText(heroAlt, { exact: true });
    await expect(hero).toBeVisible();

    // Visibility alone passes on an <img> whose src 404s — the element still
    // occupies its width/height box. naturalWidth is non-zero only once the
    // browser has actually fetched and decoded the bytes, which is what proves
    // webpack's `require('@site/...')` URL resolves under the served baseUrl.
    await expect
      .poll(() => hero.evaluate((img) => img.naturalWidth), {
        message: `the hero photo (alt: ${heroAlt}) never decoded; its built src does not resolve`,
      })
      .toBeGreaterThan(0);
  });

  test('the figcaption link navigates to the awards page', async ({ page }) => {
    await gotoEvents(page);

    // Located by role within the figure rather than by class: the caption's
    // styling is presentation, the link out to the awards timeline is the
    // contract.
    const link = page.locator('article figcaption').getByRole('link').first();
    await expect(link).toBeVisible();

    await link.click();

    expect(new URL(page.url()).pathname.replace(/\/$/, '')).toBe(
      AWARDS_PATH.replace(/\/$/, ''),
    );
    await expect(
      page.getByRole('heading', { name: 'Page Not Found' }),
    ).toHaveCount(0);
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('renders the outbound event links it cites', async ({ page }) => {
    await gotoEvents(page);

    expect(
      externalHosts.length,
      'docs/events/index.md cites no external event pages; this spec needs updating if that changed',
    ).toBeGreaterThan(0);

    for (const host of externalHosts) {
      await expect(
        page.locator('article').locator(`a[href*="${host}"]`).first(),
        `no link to ${host} rendered`,
      ).toBeVisible();
    }
  });
});
