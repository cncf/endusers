// End-to-end coverage for the one Sparkline arm that needs a build of its own.
//
// src/components/MetricsDashboard/index.js line 28 picks a sparkline point's
// x-coordinate:
//
//   `${values.length === 1 ? 50 : (index / (values.length - 1)) * 100},...`
//
// The `50` arm centres a lone point, because the expression beside it divides
// by `values.length - 1` and would be a division by zero. Nothing in the
// checked-in data reaches it. `data/metrics.json` defines exactly two
// lifecycle trends: `submissions` carries zero values, so Sparkline returns
// "No trend data yet" before reaching the ternary at all, and `publications`
// carries five, which takes the arm beside it. A trend holding exactly one
// point is an ordinary shape -- `submissions` becomes one the first month a
// single submission is recorded -- and it is the shape neither trend has.
//
// This is not a case tests/e2e/data-fixtures.spec.js can take. That file
// covers the branches an *additive* overlay reaches, where the extra record
// renders alongside the real ones and nothing already covered stops
// rendering. Appending a point to `submissions` in the ordinary coverage build
// is not additive in that sense: `submissions` is the only trend that reaches
// the empty-values arm, so giving it a point trades that arm for this one
// rather than adding a case. It belongs to the variant build for the same
// reason AwardsTimeline's provenance paragraph does -- see the preamble of
// tests/e2e/data-variants.spec.js for the mechanism. `npm run
// build:e2e:coverage` compiles a second site under /e2e-coverage-variant/
// with tests/e2e/fixtures/data-variants/** layered on, one `docusaurus serve`
// offers both, and the report unions what each build reached.
//
// The real route is asserted as well as the variant one. An assertion that
// the variant page centres a lone point passes just as well when the real page
// has quietly stopped rendering trends at all; pairing the two is what makes
// this evidence that the arm *switched* rather than that one page happens to
// look a certain way.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';

const METRICS_PATH = '/metrics';
const VARIANT_BASE = '/e2e-coverage-variant';

// The variant site is only built by the coverage run; outside it the base
// path does not exist and the ordinary page still has an empty trend.
const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

const COVERAGE_ENV = { E2E_COVERAGE: '1' };
const VARIANT_ENV = { E2E_COVERAGE: '1', E2E_COVERAGE_VARIANT: '1' };

// Read the trends through the overlay rather than hard-coding a label or a
// number, so an edited overlay fails here instead of leaving a test that
// asserts nothing.
const trendsIn = (env) =>
  loadSiteData('metrics.json', env).referenceArchitectureLifecycle.trends;

const coverageTrends = trendsIn(COVERAGE_ENV);
const variantTrends = trendsIn(VARIANT_ENV);

// The id is fixed by the overlay, which must name a trend that already exists
// in data/metrics.json; `npm run build:e2e:coverage` fails if it does not.
const SINGLE_POINT_ID = 'submissions';

const NO_TREND = 'No trend data yet';

/**
 * The aria-label Sparkline announces for a trend, which is how a sparkline is
 * addressed here: the <svg> carries role="img" and no other accessible name.
 */
const trendLabel = (trend) =>
  `Trend from ${trend.values[0].date} to ${trend.values.at(-1).date}`;

describeCoverage('a lifecycle trend with a single data point', () => {
  test('the real page has no single-point trend to centre', async ({
    page,
  }) => {
    // The premise of the whole file: against the data the site ships, one
    // trend is empty and the other is not single-point, so the `50` arm is
    // unreachable here.
    expect(coverageTrends[SINGLE_POINT_ID].values).toHaveLength(0);
    expect(
      Object.values(coverageTrends).filter(
        (trend) => trend.values.length === 1,
      ),
    ).toHaveLength(0);

    await page.goto(METRICS_PATH);

    const trends = page.locator('section[aria-labelledby="lifecycle-title"]');
    await expect(trends.getByText(NO_TREND)).toBeVisible();
  });

  test('the variant page centres the lone point at x=50', async ({ page }) => {
    const trend = variantTrends[SINGLE_POINT_ID];
    expect(trend.values).toHaveLength(1);

    // The other trend keeps more than one point, so the arm beside the one
    // under test stays reachable in this same build and the variant does not
    // simply trade one uncovered region for another.
    const multiPoint = Object.entries(variantTrends).filter(
      ([id, other]) => id !== SINGLE_POINT_ID && other.values.length > 1,
    );
    expect(multiPoint.length).toBeGreaterThan(0);

    await page.goto(`${VARIANT_BASE}${METRICS_PATH}`);

    // The lifecycle section still renders the rest of itself: this is a lone
    // point being centred, not the page failing to build.
    const lifecycle = page.locator(
      'section[aria-labelledby="lifecycle-title"]',
    );
    await expect(lifecycle).toBeVisible();
    await expect(lifecycle.getByText(NO_TREND)).toHaveCount(0);

    const sparkline = lifecycle.getByRole('img', {
      name: trendLabel(trend),
      exact: true,
    });
    await expect(sparkline).toBeVisible();

    // `points` is one coordinate pair, so there is no separator in it, and its
    // x is the centre of the 0..100 viewBox rather than an index-derived
    // offset. The y is the component's own formula over the overlaid value,
    // which ties the assertion to the data instead of to a literal.
    const max = Math.max(trend.values[0].value, 1);
    const y = 24 - (trend.values[0].value / max) * 20;
    await expect(sparkline.locator('polyline')).toHaveAttribute(
      'points',
      `50,${y}`,
    );
  });
});
