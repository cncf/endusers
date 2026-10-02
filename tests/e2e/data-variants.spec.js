// End-to-end coverage for the branches that need a build of their own.
//
// tests/e2e/data-fixtures.spec.js covers the branches an *additive* overlay
// reaches: the extra record it appends renders alongside the real ones, so
// nothing already covered stops rendering. The two branches below are not like
// that. Each turns on a single document-level field read by a single page, so
// clearing it in the coverage build would not add a case -- it would swap
// which arm that page renders, trading the lines beside it for the one line
// gained:
//
//   * AwardsTimeline shows its provenance paragraph only when
//     data/awards.json carries a verifiedAt; the ': null' arm is the fourteen
//     lines of that paragraph not rendering
//     (src/components/AwardsTimeline/index.js line 80).
//   * ReferenceArchitectures dates its sync line from metrics.generatedAt;
//     the ': null' arm at line 23 and the '' arm at line 33 are the date
//     being left off. metrics.generatedAt is read by four other components,
//     so clearing it build-wide moves five pages at once.
//
// `npm run build:e2e:coverage` therefore produces two sites: the ordinary
// coverage build, and a second one under /e2e-coverage-variant/ with
// tests/e2e/fixtures/data-variants/** layered on top. One `docusaurus serve`
// offers both, so a single Playwright run visits the real page and its variant
// and the report unions what each reached -- the two builds compile the same
// src/** sources, so their scripts fold onto the same lines.
//
// Each case asserts the real route as well. On its own, an assertion that a
// variant page omits something passes just as well when the page is empty or
// broken; pairing it with the real route is what makes the pair evidence that
// the arm *switched*.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';

const VARIANT_BASE = '/e2e-coverage-variant';

// The variant site is only built by the coverage run; outside it the base
// path does not exist.
const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

const VARIANT_ENV = { E2E_COVERAGE: '1', E2E_COVERAGE_VARIANT: '1' };
const COVERAGE_ENV = { E2E_COVERAGE: '1' };

// Read through the overlay rather than hard-coded, so an edited variant
// overlay fails here instead of leaving a test that asserts nothing.
const awards = loadSiteData('awards.json', COVERAGE_ENV);
const variantAwards = loadSiteData('awards.json', VARIANT_ENV);
const metrics = loadSiteData('metrics.json', COVERAGE_ENV);
const variantMetrics = loadSiteData('metrics.json', VARIANT_ENV);

const PROVENANCE = /Winner history audited for completeness against/;
const SYNC_STATUS = /Last synced from/;

describeCoverage('data the site has not received yet', () => {
  test('AwardsTimeline drops its provenance paragraph with no verifiedAt', async ({
    page,
  }) => {
    expect(awards.verifiedAt).toBeTruthy();
    expect(variantAwards.verifiedAt).toBeNull();

    await page.goto('/community/awards');
    await expect(page.getByText(PROVENANCE)).toBeVisible();

    await page.goto(`${VARIANT_BASE}/community/awards`);
    // The timeline itself still renders: this is the paragraph being absent,
    // not the page failing to build.
    const years = page.getByText(/^\d{4}$/);
    await expect(years.first()).toBeVisible();
    await expect(page.getByText(PROVENANCE)).toHaveCount(0);
  });

  test('ReferenceArchitectures drops its sync date with no generatedAt', async ({
    page,
  }) => {
    expect(metrics.generatedAt).toBeTruthy();
    expect(variantMetrics.generatedAt).toBeNull();
    const revision = metrics.sources.architectures.revision.slice(0, 7);

    await page.goto('/architectures');
    const synced = page.getByText(SYNC_STATUS);
    await expect(synced).toBeVisible();
    await expect(synced).toContainText(/ on \w+ \d{1,2}, \d{4}\.$/);

    await page.goto(`${VARIANT_BASE}/architectures`);
    const unsynced = page.getByText(SYNC_STATUS);
    // The revision half of the line is unchanged, so what is missing is the
    // date and only the date.
    await expect(unsynced).toContainText(revision);
    await expect(unsynced).toHaveText(new RegExp(`${revision}\\.$`));
  });
});
