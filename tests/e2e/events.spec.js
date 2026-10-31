// End-to-end coverage for the events section ADR 0012 shapes: the /events
// index that renders the latest year's events through <EventsIndex />, the
// year-grouped sidebar sidebars.js builds from the same pages, and the event
// pages themselves.
//
// tests/events-catalog.test.mjs, tests/events-sidebar-contract.test.mjs and
// tests/events-index.test.mjs are thorough contracts for the *source*: the
// reader that turns `event:` front matter into records, the sidebar shape it
// yields, and the element tree the component returns for it. All three run in
// Node against the files on disk, so these failure modes survive them:
//
//   * The plugin publishes the catalog as Docusaurus global data at build
//     time and the component reads it through usePluginData. Only the built
//     page proves the plugin is registered, ran, and handed the component the
//     same years the sidebar shows.
//   * The hero photo on the 2025 page is `require('@site/static/img/...')`,
//     which webpack resolves into a hashed URL. The unit test proves the file
//     exists; it cannot see whether the served <img> decodes.
//   * The sidebar is derived from the pages at config load. Nothing but the
//     served DOM proves the year categories render newest first with the
//     current year expanded.
//
// Every expectation is derived from docs/events/<year>/*.md rather than
// hardcoded, the way awards.spec.js drives itself from data/awards.json: a new
// event page is covered on arrival instead of needing this spec rewritten. The
// front matter is read with the same `yaml` package scripts/lib/events-catalog.mjs
// uses, but the ordering rule is restated here on purpose so that an
// unintended change to the reader fails in both places.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { test, expect } from '../tools/e2e-coverage.cjs';

const EVENTS_PATH = '/events/';
const AWARDS_PATH = '/community/awards';

// Playwright transpiles these .js specs to CommonJS (the package is not
// "type": "module"), so import.meta is unavailable. Playwright runs from the
// directory holding playwright.config.js, so docs are addressed from the
// project root.
const EVENTS_DIR = resolve('docs/events');

function frontMatter(file) {
  const matched = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(
    readFileSync(file, 'utf8'),
  );
  return {
    data: matched ? parseYaml(matched[1]) : {},
    body: matched?.[2] ?? '',
  };
}

const index = frontMatter(join(EVENTS_DIR, 'index.md'));

// One record per docs/events/<yyyy>/<slug>.md, newest start date first, the
// order sidebars.js and EventsIndex both present.
const events = readdirSync(EVENTS_DIR)
  .filter((entry) => /^\d{4}$/.test(entry))
  .flatMap((year) =>
    readdirSync(join(EVENTS_DIR, year))
      .filter((entry) => /\.mdx?$/.test(entry))
      .map((entry) => {
        const file = join(EVENTS_DIR, year, entry);
        const { data, body } = frontMatter(file);
        return {
          year: Number(year),
          route: `/events/${year}/${entry.replace(/\.mdx?$/, '')}`,
          title: data.title,
          start: data.event.start,
          end: data.event.end,
          location: data.event.location,
          url: data.event.url,
          heroAlt: /<img\b[\s\S]*?\balt="([^"]+)"/.exec(body)?.[1],
        };
      }),
  )
  .sort(
    (a, b) =>
      b.start.localeCompare(a.start) ||
      b.end.localeCompare(a.end) ||
      a.title.localeCompare(b.title, 'en'),
  );

const years = [...new Set(events.map((event) => event.year))];
const latestYear = years[0];
const latestEvents = events.filter((event) => event.year === latestYear);
const heroEvent = events.find((event) => event.heroAlt);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

test.describe('events index', () => {
  test('renders its title and frontmatter metadata', async ({ page }) => {
    await gotoDoc(page, EVENTS_PATH);

    await expect(
      page.getByRole('heading', { name: index.data.title, level: 1 }),
    ).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
    await expect(page).toHaveTitle(
      new RegExp(`^${escapeRegExp(index.data.title)}\\b`),
    );
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      index.data.description,
    );
  });

  test('lists the latest year with events, newest first', async ({ page }) => {
    await gotoDoc(page, EVENTS_PATH);

    expect(
      latestEvents.length,
      'docs/events/ has no event pages; this spec needs updating if the section emptied',
    ).toBeGreaterThan(0);

    const article = page.locator('article');
    // The year heading is the component's h2 and carries the id the section
    // is labelled by; a year typed into docs/events/index.md would not.
    await expect(
      article.getByRole('heading', { level: 2, name: String(latestYear) }),
    ).toBeVisible();

    const rows = article.locator('ol > li');
    await expect(rows).toHaveCount(latestEvents.length);

    for (const [position, event] of latestEvents.entries()) {
      const row = rows.nth(position);
      const link = row.getByRole('link', { name: event.title });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute(
        'href',
        new RegExp(`^${escapeRegExp(event.route)}/?$`),
      );
      await expect(row.locator('time')).toHaveAttribute(
        'dateTime',
        event.start,
      );
      await expect(row).toContainText(event.location);
    }
  });

  test('links earlier years to their most recent event', async ({ page }) => {
    // Fails rather than skips when a single year is left (see
    // tests/e2e-data-dependent-skips.test.mjs): the earlier-years row renders
    // nothing then, and this case would need rewriting, not silencing.
    expect(
      years.length,
      'only one year has events; this spec needs updating',
    ).toBeGreaterThan(1);
    await gotoDoc(page, EVENTS_PATH);

    for (const year of years.slice(1)) {
      const target = events.find((event) => event.year === year);
      const link = page
        .locator('article')
        .getByRole('link', { name: String(year), exact: true });
      await expect(link).toHaveAttribute(
        'href',
        new RegExp(`^${escapeRegExp(target.route)}/?$`),
      );
    }

    const earliest = events.find((event) => event.year === years.at(-1));
    await page
      .locator('article')
      .getByRole('link', { name: String(earliest.year), exact: true })
      .click();
    expect(normalise(new URL(page.url()).pathname)).toBe(earliest.route);
    await expect(
      page.getByRole('heading', { name: earliest.title, level: 1 }),
    ).toBeVisible();
  });

  test('groups the sidebar by year, newest first, with the latest expanded', async ({
    page,
  }) => {
    await gotoDoc(page, EVENTS_PATH);

    const sidebar = page.locator('nav.menu').first();
    await expect(sidebar).toBeVisible();

    // Each year is a collapsible category whose label is the year. The
    // category links carry the `menu__link--sublist` class in the classic
    // theme; the order of their labels is the order sidebars.js emitted.
    const categories = sidebar.locator('a.menu__link--sublist');
    await expect(categories).toHaveCount(years.length);
    expect(
      (await categories.allInnerTexts()).map((text) => text.trim()),
    ).toEqual(years.map(String));

    // Only the latest year is expanded on arrival, so its event links are the
    // visible doc links below the index entry; the older years' links are
    // collapsed and therefore absent from the accessibility tree.
    for (const event of latestEvents) {
      await expect(
        sidebar.getByRole('link', { name: event.title, exact: true }),
      ).toBeVisible();
    }
    for (const event of events.filter((event) => event.year !== latestYear)) {
      await expect(
        sidebar.getByRole('link', { name: event.title, exact: true }),
      ).toBeHidden();
    }
  });
});

test.describe('event pages', () => {
  for (const event of events) {
    test(`${event.route} renders its title and cites the event site`, async ({
      page,
    }) => {
      await gotoDoc(page, event.route);

      await expect(
        page.getByRole('heading', { name: event.title, level: 1 }),
      ).toBeVisible();
      await expect(page.locator('nav.menu').first()).toBeVisible();

      // Asserted as a rendered href only, never requested, so the suite makes
      // no third-party traffic from CI.
      const host = new URL(event.url).host;
      await expect(
        page.locator('article').locator(`a[href*="${host}"]`).first(),
        `no link to ${host} rendered on ${event.route}`,
      ).toBeVisible();
    });
  }

  test('serves the hero photo the page requires', async ({ page }) => {
    expect(
      heroEvent,
      'no event page embeds an <img> with alt text; this spec needs updating',
    ).toBeTruthy();
    await gotoDoc(page, heroEvent.route);

    const hero = page
      .locator('article')
      .getByAltText(heroEvent.heroAlt, { exact: true });
    await expect(hero).toBeVisible();

    // Visibility alone passes on an <img> whose src 404s — the element still
    // occupies its width/height box. naturalWidth is non-zero only once the
    // browser has actually fetched and decoded the bytes, which is what proves
    // webpack's `require('@site/...')` URL resolves under the served baseUrl.
    await expect
      .poll(() => hero.evaluate((img) => img.naturalWidth), {
        message: `the hero photo (alt: ${heroEvent.heroAlt}) never decoded; its built src does not resolve`,
      })
      .toBeGreaterThan(0);
  });

  test('the figcaption link navigates to the awards page', async ({ page }) => {
    await gotoDoc(page, heroEvent.route);

    const link = page.locator('article figcaption').getByRole('link').first();
    await expect(link).toBeVisible();
    await link.click();

    expect(normalise(new URL(page.url()).pathname)).toBe(AWARDS_PATH);
    await expect(
      page.getByRole('heading', { name: 'Page Not Found' }),
    ).toHaveCount(0);
    await expect(page.locator('article').first()).toBeVisible();
  });
});
