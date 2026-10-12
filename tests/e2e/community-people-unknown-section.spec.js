// End-to-end coverage for the roster fallback in CommunityPeople.
//
//   const people = peopleData.people[section] || [];
//     src/components/CommunityPeople/index.js line 134
//
// The published site renders the component twice -- `section="tab"` from
// docs/community/technical-advisory-board.md and `section="staff"` from
// docs/community/index.md -- and both sections are guaranteed to exist and to
// be non-empty: tests/community-people-data.test.mjs scans docs/ for
// `<CommunityPeople section="..." />` and fails when the named section is
// absent from data/community-people.json or carries no entries. So the right
// operand is unreachable from published content by construction.
//
// A data overlay cannot reach it either. Deleting or emptying `people.tab`
// would hand the component an array straight off the object; the `|| []` arm
// only runs when the key is absent, and the overlay engine patches the data
// the published pages name rather than inventing a section they do not.
//
// So the shape gets a page of its own, following the precedent set by
// tests/e2e/fixtures/docs/cncf-project-card.mdx: docusaurus.config.js
// registers a second docs instance over tests/e2e/fixtures/docs/** when
// E2E_COVERAGE=1 and serves it under /e2e-coverage-fixtures/. The fixture is
// compiled by the coverage build only -- `npm run build:production`, the
// gating "End-to-end tests" job and the deployed site never see it -- which is
// why this file is skipped outside the coverage run, where the route 404s.
//
// The grid is asserted from both ends. An empty grid on its own would also be
// produced by a component that threw its markup away, or by a selector that
// matched nothing, so the same selector is first shown to find a populated
// grid on the published TAB page. The fixture page then has to produce the
// container and nothing inside it: rendering zero cards is the behaviour, and
// rendering no grid at all would be a different component.
import { test, expect } from '../tools/e2e-coverage.cjs';

const FIXTURE_ROUTE = '/e2e-coverage-fixtures/community-people';
const PUBLISHED_ROUTE = '/community/technical-advisory-board';

// CSS modules hash the class, so the prefix is the stable half. `peopleGrid`
// is the only element src/components/CommunityPeople/index.js returns.
const GRID = 'div[class^="peopleGrid_"]';
const CARD = 'article[class^="personCard_"]';

const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

describeCoverage('CommunityPeople roster fallback', () => {
  test('a published section renders a populated grid', async ({ page }) => {
    const response = await page.goto(PUBLISHED_ROUTE);
    expect(response?.status()).toBe(200);

    const grid = page.locator(GRID);
    await expect(grid).toHaveCount(1);
    expect(await grid.locator(CARD).count()).toBeGreaterThan(0);
  });

  test('a section the data does not define renders an empty grid', async ({
    page,
  }) => {
    const response = await page.goto(FIXTURE_ROUTE);
    expect(response?.status()).toBe(200);

    // The page itself has to have rendered, or an empty grid would prove
    // nothing about the component.
    await expect(
      page.getByRole('heading', { name: 'CommunityPeople coverage fixture' }),
    ).toBeVisible();

    const grid = page.locator(GRID);
    await expect(grid).toHaveCount(1);
    await expect(grid.locator(CARD)).toHaveCount(0);
  });
});
