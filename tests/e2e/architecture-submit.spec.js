// End-to-end coverage for /architectures/submit, the one listed sidebar doc
// route no other spec loads.
//
// tests/e2e/docs-routes.spec.js covers the three routes that were unvisited
// when it was written, and its preamble says /resources is "the only doc on
// the site whose body is hand-written JSX". That is no longer true.
// docs/architectures/submit.md carries two hand-written markup blocks of its
// own — a `pillars pillars-duo` container holding the four `pillar` cards that
// answer "why submit?", and a `benefit-cards` container holding the four
// `benefit` cards that list what a submitting organization gets — and it ends
// with the two links that are the whole point of the page: the in-repo
// submission issue template and the CNCF TAB submission process.
//
// tests/architecture-submission-contract.test.mjs and
// tests/architectures-sidebar-contract.test.mjs assert this page, but they read
// the Markdown off disk. They cannot see whether the built site serves the
// route: an MDX compile change, a `className` rename in src/css, or a
// sidebar_position clash leaves the page reachable from the navbar while
// rendering an empty shell, and the sidebar contract still passes. This is the
// submission funnel for the whole reference-architecture programme, so a blank
// render costs submissions silently.
//
// The card headings are read from the Markdown rather than restated here, the
// way tests/e2e/user-groups.spec.js reads its expectations from
// _category_.json: what this pins is the relationship between the source and
// the rendered page, so adding a fifth card extends the contract instead of
// breaking it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test, expect } from '../tools/e2e-coverage.cjs';

// Resolved from the working directory, as tests/e2e/user-groups.spec.js and
// tests/e2e/architecture-detail.spec.js already do: Playwright runs the suite
// from the directory holding playwright.config.js, which is the repository
// root.
const SUBMIT_SOURCE = resolve('docs/architectures/submit.md');
const SUBMIT_PATH = '/architectures/submit';

const ISSUE_TEMPLATE_URL =
  'https://github.com/cncf/endusers/issues/new?template=reference-architecture.yml';
const TAB_PROCESS_URL =
  'https://github.com/cncf/tab/blob/main/process/reference-architectures.md';

const source = readFileSync(SUBMIT_SOURCE, 'utf8');

// The `<h3>` headings inside one `className="<container>"` block, in document
// order. Scoped to the block rather than taken from the whole file so the two
// groups stay distinguishable, and so a heading that moves between them is a
// visible change rather than a silent one.
function cardHeadings(containerClass) {
  const opening = new RegExp(
    `<div className="[^"]*\\b${containerClass}\\b[^"]*">`,
    'u',
  );
  const start = source.search(opening);
  if (start === -1) return [];

  // Each block is terminated by the first `</div>` that sits at the start of a
  // line, which is how both containers are written: the cards inside are
  // indented.
  const rest = source.slice(start);
  const end = rest.search(/^<\/div>/mu);
  const block = end === -1 ? rest : rest.slice(0, end);

  return [...block.matchAll(/<h3>([\s\S]*?)<\/h3>/gu)].map(([, text]) =>
    text.trim(),
  );
}

const PILLAR_HEADINGS = cardHeadings('pillars');
const BENEFIT_HEADINGS = cardHeadings('benefit-cards');

// A spec that silently found no headings would assert nothing at all and still
// report green, which is the failure mode this whole file exists to close.
// These run at collection time, before any browser starts.
test.describe('docs/architectures/submit.md is readable', () => {
  test('the "why submit" block holds cards', () => {
    expect(PILLAR_HEADINGS.length).toBeGreaterThan(0);
  });

  test('the organization-benefits block holds cards', () => {
    expect(BENEFIT_HEADINGS.length).toBeGreaterThan(0);
  });
});

async function gotoSubmit(page) {
  const response = await page.goto(SUBMIT_PATH);

  // `docusaurus serve` answers an unknown path with the 404 page, so the
  // status alone is not conclusive; both are asserted, as
  // tests/e2e/docs-routes.spec.js does.
  expect(response?.status(), `${SUBMIT_PATH} should not 404`).toBeLessThan(400);
  await expect(
    page.getByRole('heading', { name: 'Page Not Found' }),
  ).toHaveCount(0);

  return response;
}

test.describe('submit a reference architecture', () => {
  test('renders inside the architectures sidebar', async ({ page }) => {
    await gotoSubmit(page);

    await expect(
      page.getByRole('heading', {
        name: 'Submit a reference architecture',
        level: 1,
      }),
    ).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
    // The page is reached from the Architectures sidebar, so the built route
    // has to render one. A doc that falls out of the architectures sidebar
    // still renders an article but loses this.
    await expect(page.locator('nav.menu').first()).toBeVisible();
  });

  test('renders every "why submit" card from the source', async ({ page }) => {
    await gotoSubmit(page);

    const cards = page.locator('article .pillars .pillar');
    await expect(cards).toHaveCount(PILLAR_HEADINGS.length);

    for (const heading of PILLAR_HEADINGS) {
      // Located by role and name rather than by the `pillar` class alone: the
      // class positions the card, the heading is what a reader came for. Both
      // are asserted, because a card whose `<p>` body vanished still has its
      // heading.
      const card = cards.filter({
        has: page.getByRole('heading', { name: heading, exact: true }),
      });
      await expect(card, `the "${heading}" card should render`).toHaveCount(1);
      await expect(card.locator('p').first()).toBeVisible();
    }
  });

  test('renders every organization-benefit card from the source', async ({
    page,
  }) => {
    await gotoSubmit(page);

    const cards = page.locator('article .benefit-cards .benefit');
    await expect(cards).toHaveCount(BENEFIT_HEADINGS.length);

    for (const heading of BENEFIT_HEADINGS) {
      const card = cards.filter({
        has: page.getByRole('heading', { name: heading, exact: true }),
      });
      await expect(card, `the "${heading}" card should render`).toHaveCount(1);
      await expect(card.locator('p').first()).toBeVisible();
    }
  });

  for (const [label, href] of [
    ['the in-repo submission issue template', ISSUE_TEMPLATE_URL],
    ['the CNCF TAB submission process', TAB_PROCESS_URL],
  ]) {
    test(`links to ${label}`, async ({ page }) => {
      await gotoSubmit(page);

      // The call to action is the reason the page exists. An MDX change that
      // drops the link leaves the surrounding prose intact and reads as fine.
      await expect(
        page.locator('article').locator(`a[href="${href}"]`),
      ).toHaveCount(1);
    });
  }

  test('is in the sitemap', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);

    // The `<loc>` entries are absolute URLs, and a substring match for the
    // slug would also hit any longer path containing it. Compare parsed
    // pathnames instead, as tests/e2e/user-groups.spec.js does.
    const paths = [
      ...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/gu),
    ].map(([, loc]) => new URL(loc).pathname.replace(/\/+$/u, ''));

    expect(paths, 'the submission page should be indexable').toContain(
      SUBMIT_PATH,
    );
  });
});
