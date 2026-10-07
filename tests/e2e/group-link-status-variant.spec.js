// End-to-end coverage for the plural arms of src/components/GroupLinkStatus/
// index.js and for formatDate's invalid-date guard, which need a build of
// their own.
//
// The component reads data/community-groups.json at module scope and renders
// two things the checked-in corpus cannot vary:
//
//   line  7  `if (Number.isNaN(parsed.getTime())) return null;` — formatDate
//            returns null for a checkedAt that does not parse, which drops
//            the "Upstream group links last verified on ..." line entirely;
//   lines 32-33  `stale.length === 1 ? 'has an' : 'have'` and
//            `stale.length === 1 ? 'repository' : 'repositories'` — the
//            plural grammar of the drift warning.
//
// Neither is reachable against the data the site ships. Both real groups are
// archived:false / reachable:true, and tests/e2e/fixtures/data/
// community-groups.json appends exactly one archived group, so the ordinary
// coverage build has `stale.length === 1` and always takes the singular arm.
// The real checkedAt is a valid ISO timestamp, so line 7 never returns.
//
// Two groups drifting at once is an ordinary shape rather than defensive dead
// code: `npm run check:community-group-links` sets `archived` and `reachable`
// on every group independently, so a run that finds two repositories gone is
// exactly what produces it.
//
// This is not a case tests/e2e/data-fixtures.spec.js can take. That file
// covers the branches an *additive* overlay reaches, where an extra record
// renders beside the real ones and nothing already covered stops rendering.
// Here the two arms of each ternary are mutually exclusive on one page, and
// clearing checkedAt removes the verification line that the ordinary build
// covers — so overlaying once would swap which arm is reachable rather than
// add a case. They belong to the variant build for the same reason
// AwardsTimeline's provenance paragraph does; see the preamble of
// tests/e2e/data-variants.spec.js for the mechanism. `npm run
// build:e2e:coverage` compiles a second site under /e2e-coverage-variant/
// with tests/e2e/fixtures/data-variants/** layered on, one `docusaurus serve`
// offers both, and the report unions what each build reached.
//
// The real route is asserted alongside the variant one. On its own, an
// assertion that the variant page says "repositories" passes just as well
// when the page failed to build or the route is wrong; pairing it with the
// real route rendering "repository" is what makes the pair evidence that the
// arms *switched* rather than that one of them is all the site ever renders.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';

const COMMUNITY_PATH = '/community';
const VARIANT_BASE = '/e2e-coverage-variant';
const VERIFIED_LINE = /Upstream group links last verified on/;
const SINGULAR = /has an archived or unreachable upstream repository —/;
const PLURAL = /have archived or unreachable upstream repositories —/;

// The variant site is only built by the coverage run; outside it the base
// path does not exist and the ordinary page still has a parseable checkedAt.
const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

const COVERAGE_ENV = { E2E_COVERAGE: '1' };
const VARIANT_ENV = { E2E_COVERAGE: '1', E2E_COVERAGE_VARIANT: '1' };

// Read the corpus through the overlays rather than hard-coding names or a
// count, so an edited overlay fails here instead of leaving a test that
// asserts nothing.
const isStale = (group) => group.archived || group.reachable === false;
const groups = loadSiteData('community-groups.json', COVERAGE_ENV);
const variantGroups = loadSiteData('community-groups.json', VARIANT_ENV);
const stale = groups.groups.filter(isStale);
const variantStale = variantGroups.groups.filter(isStale);

describeCoverage('a link check that found more than one group drifting', () => {
  test('the real page dates its verification line and uses the singular', async ({
    page,
  }) => {
    // The premise of the whole file: against the data the coverage build
    // ships, both arms below are unreachable.
    expect(stale).toHaveLength(1);
    expect(new Date(groups.checkedAt).getTime()).not.toBeNaN();

    await page.goto(COMMUNITY_PATH);
    await expect(page.getByText(VERIFIED_LINE)).toBeVisible();
    const warning = page.getByText(SINGULAR);
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(stale[0].name);
    await expect(page.getByText(PLURAL)).toHaveCount(0);
  });

  test('the variant page drops the verification line and uses the plural', async ({
    page,
  }) => {
    expect(variantStale.length).toBeGreaterThan(1);
    // What line 7 turns on: the overlaid checkedAt is present but does not
    // parse, so formatDate reaches its guard instead of returning early on a
    // missing field.
    expect(variantGroups.checkedAt).toBeTruthy();
    expect(new Date(variantGroups.checkedAt).getTime()).toBeNaN();

    await page.goto(`${VARIANT_BASE}${COMMUNITY_PATH}`);
    // The route built and served: the page's own heading is prose around the
    // component, so it renders whether or not the corpus has anything to say.
    await expect(
      page.getByRole('heading', { name: 'Community', level: 1 }),
    ).toBeVisible();
    // formatDate returned null, so the verification line is gone rather than
    // rendering "Invalid Date".
    await expect(page.getByText(VERIFIED_LINE)).toHaveCount(0);
    await expect(page.getByText(/Invalid Date/)).toHaveCount(0);
    const warning = page.getByText(PLURAL);
    await expect(warning).toBeVisible();
    // Both drifted groups are named, which is what distinguishes the plural
    // arm rendering from the list simply having changed.
    for (const group of variantStale) {
      await expect(warning).toContainText(group.name);
    }
    await expect(page.getByText(SINGULAR)).toHaveCount(0);
  });
});
