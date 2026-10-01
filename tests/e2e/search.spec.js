// End-to-end coverage for the local site search
// (`docusaurus-plugin-search-local`, registered in docusaurus.config.js).
//
// The unit suite can only assert that the plugin is listed in the config
// (tests/site-config.test.mjs, "local search is registered as a plugin"). It
// cannot see whether the build actually emitted a usable index or whether
// /search returns anything, because both only exist in the production build
// output. A plugin that silently stops indexing therefore leaves the whole
// suite green while site search returns nothing.
//
// Note: these assertions deliberately do not require the index to contain the
// docs pages. On the current configuration it does not — the plugin's default
// docsRouteBasePath (["docs"]) does not match the site's docs
// routeBasePath ("/"), so only blog routes are indexed. Tightening this file
// to assert docs coverage belongs with that configuration fix, not here.
import { test, expect } from '../tools/e2e-coverage.cjs';

// A term that appears across the docs the site is built around. Asserting on a
// term rather than a count keeps this stable as content grows.
const KNOWN_TERM = 'architecture';
// Deliberately not a word: exercises the "no documents" branch.
const NONSENSE_TERM = 'zzzqqqxnotaterm';

test.describe('search index', () => {
  test('the build publishes a non-empty index of internal routes', async ({
    request,
  }) => {
    const response = await request.get('/search-index.json');
    expect(response.ok()).toBe(true);

    const index = await response.json();
    expect(Array.isArray(index)).toBe(true);
    expect(index.length).toBeGreaterThan(0);

    const documents = index.flatMap((entry) => entry.documents || []);
    expect(documents.length).toBeGreaterThan(0);

    // Every indexed document must point somewhere on this site, otherwise the
    // result links render as dead ends.
    for (const document of documents) {
      expect(document.u).toMatch(/^\//);
    }

    // Every indexed document needs a route the result list can address.
    for (const document of documents) {
      expect(document.u.length).toBeGreaterThan(1);
    }
  });
});

test.describe('search page', () => {
  test('a known term returns results that link to real pages', async ({
    page,
  }) => {
    await page.goto(`/search?q=${KNOWN_TERM}`);

    const input = page.locator('input[type="search"][name="q"]');
    await expect(input).toHaveValue(KNOWN_TERM);

    const summary = page.getByText(/\d+ documents? found/);
    await expect(summary).toBeVisible();

    const count = await summary.textContent();
    expect(Number(count?.match(/(\d+) documents? found/)?.[1])).toBeGreaterThan(
      0,
    );

    const firstResult = page.locator('article a[href^="/"]').first();
    await expect(firstResult).toBeVisible();

    const href = await firstResult.getAttribute('href');
    const target = await page.request.get(href);
    expect(target.ok()).toBe(true);
  });

  test('a term that matches nothing shows the empty state', async ({
    page,
  }) => {
    await page.goto(`/search?q=${NONSENSE_TERM}`);

    await expect(page.getByText('No documents were found')).toBeVisible();
    expect(await page.locator('article').count()).toBe(0);
  });

  test('typing in the search box updates the results in place', async ({
    page,
  }) => {
    await page.goto(`/search?q=${NONSENSE_TERM}`);
    await expect(page.getByText('No documents were found')).toBeVisible();

    const input = page.locator('input[type="search"][name="q"]');
    await input.fill(KNOWN_TERM);

    await expect(page.getByText(/\d+ documents? found/)).toBeVisible();
    expect(await page.locator('article').count()).toBeGreaterThan(0);
  });
});

test.describe('navbar search', () => {
  test('is reachable from a content page and leads to results', async ({
    page,
  }) => {
    await page.goto('/architectures');

    const trigger = page.getByLabel(/^Search \(/);
    await expect(trigger).toBeVisible();
    await trigger.click();

    const modalInput = page.locator('input[type="search"]').first();
    await expect(modalInput).toBeVisible();
    await modalInput.fill(KNOWN_TERM);

    await expect(page.locator('a[href^="/"]').first()).toBeVisible();
  });
});
