// End-to-end coverage for the absent-collection fallback in
// src/components/GroupLinkStatus/index.js:
//
//   const stale = (groupsData?.groups || []).filter(...)
//
// The `|| []` operand is the component's guard against a
// data/community-groups.json that carries no collection at all.
// `npm run check:community-group-links` rewrites the document in one pass, so
// a run that is interrupted, or that fails after truncating the file, can
// leave the Community page a document without `groups`. The guard is what
// makes that render the page without the drift warning rather than throw on
// `undefined.filter` and take the whole route down.
//
// Why this is the one arm of the component no existing build reaches.
// tests/e2e/group-link-status-variant.spec.js covers the plural drift arms
// from the variant build, which *appends* a second drifted group, and the
// ordinary coverage build appends one; both therefore carry `groups`, and the
// left operand wins in each. Clearing the collection cannot go in either:
// the variant build needs two drifted groups to render the plural grammar,
// and the ordinary build is where the singular arm and the drift warning are
// measured from. The shape rides tests/e2e/fixtures/data-no-revision/ because
// nothing that build already covers reads community-groups.json, so it costs
// no additional Docusaurus compile (see the preamble of
// tests/tools/e2e-data-fixtures.cjs).
//
// The collection is cleared to null rather than to an empty array because an
// empty array is truthy: `[] || []` takes the left operand and leaves the
// fallback unreached.
//
// The real route is asserted beside the no-revision one. An assertion that a
// page carries no drift warning passes just as well when the route 404s or
// the build lost the page, so the pair is what makes it evidence that the
// fallback supplied the empty collection rather than that nothing rendered.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';

const COMMUNITY_PATH = '/community';
const NO_REVISION_BASE = '/e2e-coverage-no-revision';

const COVERAGE_ENV = { E2E_COVERAGE: '1' };
const NO_REVISION_ENV = {
  E2E_COVERAGE: '1',
  E2E_COVERAGE_BUILD: 'no-revision',
};

// Read through the overlays rather than hard-coded, so an edited fixture fails
// here instead of leaving a test that asserts nothing.
const groups = loadSiteData('community-groups.json', COVERAGE_ENV);
const absentGroups = loadSiteData('community-groups.json', NO_REVISION_ENV);

const isStale = (group) => group.archived || group.reachable === false;
const UPDATED_LINE = /Upstream group status last updated on/;
const DRIFT_WARNING = /archived or unreachable upstream/;

// The no-revision site is only built by the coverage run; outside it the base
// path does not exist.
const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

describeCoverage('a community-groups document carrying no collection', () => {
  test('the drift warning is dropped rather than throwing on the missing collection', async ({
    page,
  }) => {
    // The shapes the two pages are built from. Stated as assertions rather
    // than used to skip: an overlay that stopped clearing the collection
    // would leave the fallback unexercised, which is the silent retirement
    // this pair exists to catch.
    expect(Array.isArray(groups.groups)).toBe(true);
    expect(groups.groups.filter(isStale).length).toBeGreaterThan(0);
    expect(absentGroups.groups).toBe(null);
    // The last-updated line is the evidence that the component rendered at
    // all on the no-revision page, so it has to survive the cleared
    // collection: generatedAt is left alone by this overlay.
    expect(absentGroups.generatedAt).toEqual(groups.generatedAt);

    await page.goto(COMMUNITY_PATH);
    await expect(page.getByText(DRIFT_WARNING)).toBeVisible();

    await page.goto(`${NO_REVISION_BASE}${COMMUNITY_PATH}`);
    // The route built and served: the page's own heading is prose around the
    // component, so it renders whether or not the corpus has anything to say.
    await expect(
      page.getByRole('heading', { name: 'Community', level: 1 }),
    ).toBeVisible();
    // The component itself still rendered -- this is an empty collection, not
    // a page that lost the component or a build that lost the route.
    await expect(page.getByText(UPDATED_LINE)).toBeVisible();
    // ...and with nothing to report it says nothing, rather than reporting an
    // empty list of drifted groups.
    await expect(page.getByText(DRIFT_WARNING)).toHaveCount(0);
  });
});
