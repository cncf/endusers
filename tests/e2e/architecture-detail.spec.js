// End-to-end coverage for the reference architecture *detail* routes.
//
// smoke.spec.js loads /architectures and asserts the catalog listing reports a
// non-zero count, but no spec has ever opened one of the pages that listing
// links to. Those pages are the only surface on the site that is rewritten
// wholesale by automation: `npm run import:architectures` regenerates
// docs/architectures/<id>.md, data/architectures/catalog.json and the mirrored
// files under static/img/architectures/ from the upstream cncf/architecture
// repository on a schedule.
//
// The unit suite already pins the *file-level* contract hard — see
// tests/architecture-catalog-contract.test.mjs, which proves catalog ids and
// doc pages are one-to-one and that every declared asset exists on disk. What
// it cannot reach is whether the page a reader actually receives renders: MDX
// has to compile, <CNCFProjectCard> has to hydrate out of the shipped bundle,
// and the mirrored diagrams have to survive Docusaurus' asset pipeline, which
// rewrites each /img/architectures/... reference to a content-hashed URL under
// /assets/images/. A rename or a dropped mirror upstream leaves the on-disk
// contract satisfied and the rendered page broken.
//
// Every case is driven from catalog.json rather than a hardcoded id list, so a
// newly imported architecture is covered on arrival instead of needing this
// file edited.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

// Playwright transpiles these .js specs to CommonJS (the package is not
// "type": "module"), so import.meta is not available here. Playwright resolves
// testDir against the directory holding playwright.config.js and runs from the
// project root, so the catalog is addressed from there.
const catalog = JSON.parse(
  readFileSync(resolve('data/architectures/catalog.json'), 'utf8'),
);

const records = Array.isArray(catalog) ? catalog : catalog.architectures;

// A guard on the fixture itself: if the catalog ever loads empty, the
// generated per-record cases below would silently become zero tests and this
// file would pass while asserting nothing.
test('the catalog exposes at least one architecture to cover', () => {
  expect(records.length).toBeGreaterThan(0);
});

test.describe('reference architecture detail pages', () => {
  for (const record of records) {
    test(`${record.id} renders its imported content`, async ({ page }) => {
      const failed = [];
      page.on('response', (response) => {
        if (response.status() >= 400) {
          failed.push(`${response.status()} ${response.url()}`);
        }
      });

      await page.goto(`/architectures/${record.id}`);

      // The doc page title comes from the record, so a drifted import shows up
      // here before it shows up anywhere a reader would notice.
      await expect(
        page.getByRole('heading', { level: 1, name: record.title }),
      ).toBeVisible();

      // CC BY 4.0 obliges the site to carry attribution for the upstream text,
      // and the pinned revision is what makes the import reproducible. Both
      // live in the leading blockquote that import-architectures.mjs writes.
      const attribution = page.locator('article blockquote').first();
      await expect(attribution).toContainText(record.sourceCommit);
      await expect(attribution).toContainText('CC BY 4.0');

      // Each declared project is rendered by <CNCFProjectCard> as a link to
      // cncf.io/projects/...; the counts are exactly one-to-one today, so a
      // card that fails to hydrate is visible as a shortfall.
      const projects = record.projects ?? [];
      if (projects.length > 0) {
        await expect(
          page.locator('article a[href*="cncf.io/projects/"]'),
        ).toHaveCount(projects.length);
      }

      // Diagrams are lazily loaded, so an image below the fold reports
      // naturalWidth 0 until it is scrolled to. Scrolling every diagram into
      // view and waiting for each to decode is what actually proves the
      // pipeline, but it makes the page's whole image set compete for the
      // single `docusaurus serve` process across parallel workers, which turns
      // a correct page into a timeout. Resolve each src over HTTP instead:
      // that is the assertion that matters (a renamed or dropped mirror 404s)
      // and it costs one cheap request per diagram.
      const images = page.locator('article img');
      const sources = await images.evaluateAll((nodes) =>
        nodes.map((node) => node.src),
      );

      for (const source of sources) {
        // Some upstream diagrams are inlined as data: URIs by the importer and
        // have no URL to resolve.
        if (!source || source.startsWith('data:')) continue;
        const response = await page.request.get(source);
        expect(
          response.status(),
          `${source} referenced by /architectures/${record.id}`,
        ).toBeLessThan(400);
      }

      // One real decode per page still proves the rendered <img> reaches a
      // usable bitmap rather than only a reachable URL, without paying for it
      // on every diagram.
      const firstRenderable = sources.findIndex(
        (source) => source && !source.startsWith('data:'),
      );
      if (firstRenderable !== -1) {
        const image = images.nth(firstRenderable);
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(() => image.evaluate((node) => node.naturalWidth), {
            message: `image ${firstRenderable} on /architectures/${record.id} never decoded`,
          })
          .toBeGreaterThan(0);
      }

      expect(
        failed,
        'detail page requested a resource that does not exist',
      ).toEqual([]);
    });
  }

  test('the catalog listing links through to a detail page', async ({
    page,
  }) => {
    const [first] = records;

    await page.goto('/architectures');
    // The listing is rendered by src/components/ArchitectureFilters after
    // hydration, so wait for the entry rather than reading the static HTML.
    const link = page.locator(`a[href$="/architectures/${first.id}"]`).first();
    await expect(link).toBeVisible();

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/architectures/${first.id}/?$`));
    await expect(
      page.getByRole('heading', { level: 1, name: first.title }),
    ).toBeVisible();
  });
});
