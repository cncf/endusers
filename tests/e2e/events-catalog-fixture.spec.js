// End-to-end coverage for the arms of EventsCatalog and formatDateRange() the
// published event pages never select.
//
//   if (years.length === 0) return <p ...>No events have been announced yet.</p>;
//     the empty state in src/components/EventsIndex/index.js
//   from.getTime() === to.getTime() || months differ || years differ
//     ? String(from.getUTCDate()) : `${from}–${to}`
//     the calendar block's day span, same file
//   the single-day, cross-year and cross-month returns of formatDateRange()
//     src/components/shared/formatDate.js
//
// Every page under docs/events/<year>/ is a multi-day event inside one
// calendar month and tests/events-page.test.mjs requires at least one, so
// /events always renders a populated list whose every row takes the
// `${from}–${to}` arm and the same-month range text. A data overlay cannot
// change that: the catalog is read from Markdown front matter by
// scripts/lib/events-catalog-plugin.mjs, not from a data/*.json file.
//
// So the shapes get a page of their own, following
// tests/e2e/fixtures/docs/community-people.mdx: docusaurus.config.js registers
// a second docs instance over tests/e2e/fixtures/docs/** when E2E_COVERAGE=1
// and serves it under /e2e-coverage-fixtures/. The fixture is compiled by the
// coverage build only -- `npm run build:production`, the gating "End-to-end
// tests" job and the deployed site never see it -- which is why this file is
// skipped outside the coverage run, where the route 404s.
//
// The published /events page is asserted first so the selectors are shown to
// find a populated list before the fixture is asked to render the arms.
import { test, expect } from '../tools/e2e-coverage.cjs';

const FIXTURE_ROUTE = '/e2e-coverage-fixtures/events-catalog';
const PUBLISHED_ROUTE = '/events/';

// CSS modules hash the class, so the prefix is the stable half.
const EMPTY = 'p[class^="empty_"]';
const ROW = 'li[class^="row_"]';
const CALENDAR_DAYS = 'span[class^="days_"]';

const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

describeCoverage('EventsCatalog date and empty arms', () => {
  test('the published index renders a populated list and no empty state', async ({
    page,
  }) => {
    const response = await page.goto(PUBLISHED_ROUTE);
    expect(response?.status()).toBe(200);

    const rows = page.locator('article').locator(ROW);
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(page.locator(EMPTY)).toHaveCount(0);
  });

  test('an empty catalog renders the empty state instead of a list', async ({
    page,
  }) => {
    const response = await page.goto(FIXTURE_ROUTE);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'EventsCatalog coverage fixture' }),
    ).toBeVisible();

    const empty = page.locator(EMPTY);
    await expect(empty).toHaveCount(1);
    await expect(empty).toHaveText('No events have been announced yet.');
  });

  test('single-day and month- or year-spanning events show only their start day and the matching range text', async ({
    page,
  }) => {
    await page.goto(FIXTURE_ROUTE);

    const rows = page.locator('article').locator(ROW);
    await expect(rows).toHaveCount(3);

    const expected = [
      { days: '30', range: 'December 30, 2031 – January 2, 2032' },
      { days: '30', range: 'March 30 – April 2, 2031' },
      { days: '14', range: 'February 14, 2031' },
    ];
    for (const [index, { days, range }] of expected.entries()) {
      const row = rows.nth(index);
      await expect(row.locator(CALENDAR_DAYS)).toHaveText(days);
      await expect(row.locator('time')).toHaveText(range);
    }
  });
});
