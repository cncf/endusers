// End-to-end coverage for the two empty-corpus arms of
// src/components/RadarReports/index.js, which need a build of their own.
//
// The component reads data/radar-reports.json at module scope and branches on
// two document-level fields:
//
//   line  6  `if (!data.generatedAt) return null;` — SyncStatus renders no
//            provenance line when the corpus carries no generatedAt;
//   line 24  `const radarReports = data.radarReports || [];` — the `|| []`
//            fallback supplies the list the page maps over when the corpus
//            carries no radarReports array at all.
//
// Neither arm is reachable against the data the site ships: the checked-in
// corpus always has a generatedAt and six reports. Both are ordinary shapes
// rather than defensive dead code — the file is regenerated daily from
// cncf.io by `npm run collect:radar-reports` via
// .github/workflows/refresh-radar-reports.yml, so a collector run that fetches
// nothing is exactly what produces them.
//
// This is not a case tests/e2e/data-fixtures.spec.js can take. That file
// covers the branches an *additive* overlay reaches, where an extra record
// renders beside the real ones and nothing already covered stops rendering.
// These two arms are the opposite: clearing the fields in the ordinary
// coverage build would trade the provenance line and all six rendered reports
// for them, so the arms beside them would go uncovered instead. They belong to
// the variant build for the same reason AwardsTimeline's provenance paragraph
// does — see the preamble of tests/e2e/data-variants.spec.js for the
// mechanism. `npm run build:e2e:coverage` compiles a second site under
// /e2e-coverage-variant/ with tests/e2e/fixtures/data-variants/** layered on,
// one `docusaurus serve` offers both, and the report unions what each build
// reached.
//
// The real route is asserted alongside the variant one. On its own, an
// assertion that the variant page has no provenance line and no reports passes
// just as well when the page failed to build or the route is wrong; pairing it
// with the real route is what makes the pair evidence that the arms
// *switched*.
//
// What this does NOT do, yet: move the two regions out of the e2e report's
// uncovered list. The browser demonstrably takes both arms — the variant
// chunk keeps the branches (`function i(){if(!o.ro)return null;...}` and
// `let e=o.Gb||[]` in build/e2e-coverage-variant/assets/js/b8512184.*.js,
// against `{"ro":null,...,"Gb":null}`) and the assertions below only pass if
// it did. But tests/tools/e2e-coverage-report.mjs keys a region on its exact
// original coordinates, and the two builds' generated code maps back to
// different ones: the real build records `6:25:6:37` count 0 and
// `24:40:24:46` count 0, while the variant records `7:2:21:1` count 0 and
// `21:0:29:26` count 1 and emits no key matching either zero region. So the
// union keeps both zeros. That is the region-attribution problem tracked in
// #1066 and #1079, not something this fixture can reach; once it lands, these
// two arms fold without any change here.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';

const RADAR_PATH = '/resources/radar-reports';
const VARIANT_BASE = '/e2e-coverage-variant';
const SECTION_NAME = 'CNCF Technology Radar reports';
const PROVENANCE = /Mirrored from/;

// The variant site is only built by the coverage run; outside it the base
// path does not exist and the ordinary page still has a full corpus.
const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

const COVERAGE_ENV = { E2E_COVERAGE: '1' };
const VARIANT_ENV = { E2E_COVERAGE: '1', E2E_COVERAGE_VARIANT: '1' };

// Read the corpus through the overlay rather than hard-coding a count, so an
// edited overlay fails here instead of leaving a test that asserts nothing.
const radar = loadSiteData('radar-reports.json', COVERAGE_ENV);
const variantRadar = loadSiteData('radar-reports.json', VARIANT_ENV);

const sectionOf = (page) => page.getByRole('region', { name: SECTION_NAME });

describeCoverage('a radar corpus the collector has not filled yet', () => {
  test('the real page dates its provenance line and lists its reports', async ({
    page,
  }) => {
    // The premise of the whole file: against the data the site ships, both
    // arms below are unreachable.
    expect(radar.generatedAt).toBeTruthy();
    expect(radar.radarReports.length).toBeGreaterThan(0);

    await page.goto(RADAR_PATH);
    const section = sectionOf(page);
    await expect(section).toBeVisible();
    await expect(section.getByText(PROVENANCE)).toBeVisible();
    await expect(section.locator('li')).toHaveCount(radar.radarReports.length);
  });

  test('the variant page drops the provenance line and renders an empty list', async ({
    page,
  }) => {
    expect(variantRadar.generatedAt).toBeNull();
    expect(variantRadar.radarReports).toBeNull();

    await page.goto(`${VARIANT_BASE}${RADAR_PATH}`);
    // The route built and served: the page's own heading is prose around the
    // component, so it renders whether or not the corpus has anything in it.
    await expect(
      page.getByRole('heading', { name: 'Radar Reports', level: 1 }),
    ).toBeVisible();
    const section = sectionOf(page);
    // The section itself still renders: this is the provenance line being
    // absent and the list being empty, not the page failing to build. It is
    // asserted as attached rather than visible because with no provenance
    // line and no <li> it has nothing to lay out, so its box collapses to
    // zero height and Playwright reports it hidden.
    await expect(section).toBeAttached();
    await expect(section.getByText(PROVENANCE)).toHaveCount(0);
    // `|| []` is what keeps `.map` off a null — reaching the empty <ul> at
    // all is the evidence the fallback supplied a list.
    await expect(section.locator('ul')).toHaveCount(1);
    await expect(section.locator('li')).toHaveCount(0);
  });
});
