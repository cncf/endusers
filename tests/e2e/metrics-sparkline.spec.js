// End-to-end coverage for the Sparkline arm that centres a lone point.
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
// This *is* a case tests/e2e/data-fixtures.spec.js's mechanism can take, and
// it did not used to be. The trend grid is keyed
// (`Object.entries(lifecycle?.trends || {})`), and until
// tests/tools/e2e-data-fixtures.cjs grew an `add` operation an overlay could
// only reshape a key the real document already carried. The single-point arm
// could therefore only be made by appending a point onto `submissions` -- the
// one trend that also reaches the no-values arm -- which trades one arm for
// the other rather than adding a case, so it was given the variant build.
// `add` introduces a trend *beside* the real two instead: both keep rendering
// exactly as they did, and all three Sparkline arms -- no values, one value,
// many values -- render together on the one real /metrics page in one build.
//
// Keeping it out of the variant build is what lets
// tests/e2e/metrics-empty-collections-variant.spec.js clear
// `referenceArchitectureLifecycle.trends` there for the `|| {}` fallback at
// line 76, which no build could reach while the append had to stay.
//
// All three arms are asserted together rather than the single-point one alone.
// An assertion that one sparkline centres its point passes just as well when
// the page has quietly stopped rendering the other trends; pairing them is
// what makes this evidence that the arm was *selected* rather than that the
// grid happens to hold one thing.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';

const METRICS_PATH = '/metrics';
const LIFECYCLE = 'section[aria-labelledby="lifecycle-title"]';

// The overlay is applied by the E2E_COVERAGE=1 build only, so outside the
// coverage run there is no added trend to assert against.
const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

const COVERAGE_ENV = { E2E_COVERAGE: '1' };

// Read the trends through the overlay rather than hard-coding a label or a
// number, so an edited overlay fails here instead of leaving a test that
// asserts nothing.
const trends = loadSiteData('metrics.json', COVERAGE_ENV)
  .referenceArchitectureLifecycle.trends;

const entriesWith = (predicate) =>
  Object.entries(trends).filter(([, trend]) => predicate(trend.values));

const NO_TREND = 'No trend data yet';

/**
 * The aria-label Sparkline announces for a trend, which is how a sparkline is
 * addressed here: the <svg> carries role="img" and no other accessible name.
 */
const trendLabel = (trend) =>
  `Trend from ${trend.values[0].date} to ${trend.values.at(-1).date}`;

/** The component's own y formula, so the assertion is tied to the data. */
const pointY = (point, values) =>
  24 - (point.value / Math.max(...values.map((v) => v.value), 1)) * 20;

describeCoverage('lifecycle trend sparklines', () => {
  test('a lone point is centred while the arms beside it still render', async ({
    page,
  }) => {
    const single = entriesWith((values) => values.length === 1);
    const empty = entriesWith((values) => values.length === 0);
    const many = entriesWith((values) => values.length > 1);

    // Exactly one trend holds the shape under test: more than one would mean
    // the overlay had displaced a real trend rather than added one.
    expect(single).toHaveLength(1);
    // The other two arms are present in the same document, which is what makes
    // this a case added beside the real data rather than traded for it.
    expect(empty.length).toBeGreaterThan(0);
    expect(many.length).toBeGreaterThan(0);

    await page.goto(METRICS_PATH);
    const section = page.locator(LIFECYCLE);
    await expect(section).toBeVisible();

    // The empty arm: Sparkline returns before the ternary is reached.
    await expect(section.getByText(NO_TREND)).toHaveCount(empty.length);

    // The many-value arm: more than one coordinate pair, so `points` carries a
    // separator and the first x is the index-derived 0 rather than the centre.
    for (const [, trend] of many) {
      const sparkline = section.getByRole('img', {
        name: trendLabel(trend),
        exact: true,
      });
      await expect(sparkline).toBeVisible();
      const points = await sparkline.locator('polyline').getAttribute('points');
      expect(points.split(' ')).toHaveLength(trend.values.length);
      expect(points.split(' ')[0]).toBe(
        `0,${pointY(trend.values[0], trend.values)}`,
      );
    }

    // The single-value arm: one coordinate pair, so there is no separator in
    // `points`, and its x is the centre of the 0..100 viewBox rather than an
    // index-derived offset.
    const [, lone] = single[0];
    const sparkline = section.getByRole('img', {
      name: trendLabel(lone),
      exact: true,
    });
    await expect(sparkline).toBeVisible();
    await expect(sparkline.locator('polyline')).toHaveAttribute(
      'points',
      `50,${pointY(lone.values[0], lone.values)}`,
    );
  });
});
