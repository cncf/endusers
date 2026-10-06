// End-to-end coverage for the member directory provenance note when a source
// timestamp does not parse.
//
// DirectoryFreshness renders one sentence per scheduled data file, each behind
// its own formatDate() result (src/components/MemberDirectory/DirectoryFreshness.js
// lines 16-18). formatDate() returns null for anything Date cannot parse
// (src/components/MemberDirectory/utils.js line 16), and three regions of that
// code only run when one of the three results is null:
//
//   * utils.js line 16 -- the Number.isNaN guard itself;
//   * DirectoryFreshness line 19 -- `!landscapeDate && !architecturesDate &&
//     !awardsDate`, whose second and third operands are never evaluated while
//     the first date is truthy;
//   * DirectoryFreshness line 49 -- `(landscapeDate || architecturesDate)`,
//     whose right operand is never evaluated for the same reason.
//
// data/members.json always carries a parseable sources.landscape.collectedAt,
// and so does the ordinary coverage build. Clearing it there would not add a
// case: it would trade the membership sentence covered by
// tests/e2e/member-directory-freshness.spec.js for the arms above. The
// timestamp is made unparseable in tests/e2e/fixtures/data-variants/members.json
// instead, the mechanism tests/e2e/data-variants.spec.js documents for this
// class of branch, so one Playwright run visits /community/members and
// /e2e-coverage-variant/community/members and the report unions what each
// build reached.
//
// The real route is asserted beside the variant one. On its own, an assertion
// that a page omits a sentence passes just as well when the page is empty or
// broken; the pair is what makes it evidence that the arm switched.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';

const MEMBERS_PATH = '/community/members';
const VARIANT_BASE = '/e2e-coverage-variant';

// The variant site is only built by the coverage run; outside it the base path
// does not exist.
const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

const COVERAGE_ENV = { E2E_COVERAGE: '1' };
const VARIANT_ENV = { E2E_COVERAGE: '1', E2E_COVERAGE_VARIANT: '1' };

// Read through the overlay rather than hard-coded, so an edited variant
// overlay fails here instead of leaving a test that asserts nothing. Each
// document is loaded with the env of the build whose page it is asserted
// against: the real route is built from the COVERAGE_ENV overlay, the variant
// route from the VARIANT_ENV one. metrics.json and awards.json are patched by
// the variant overlay too, so reading them with COVERAGE_ENV would describe a
// document the variant page was never built from.
const members = loadSiteData('members.json', COVERAGE_ENV);
const variantMembers = loadSiteData('members.json', VARIANT_ENV);
const variantMetrics = loadSiteData('metrics.json', VARIANT_ENV);
const variantAwards = loadSiteData('awards.json', VARIANT_ENV);

// formatDate()'s own test: `null` is not unparseable. `new Date(null)` is the
// Unix epoch, not an Invalid Date, so Number.isNaN(getTime()) is false and the
// sentence renders with an epoch date rather than being dropped
// (src/components/MemberDirectory/utils.js lines 14-22).
const formatsToADate = (value) => !Number.isNaN(new Date(value).getTime());

const MEMBERSHIP_SENTENCE = /Directory membership data last synced from/;
const ARCHITECTURES_SENTENCE = /Architecture-derived profiles last synced from/;
// The epoch rendered by formatDate(null), in whichever timezone the browser
// runs: nothing pins TZ for the Playwright run, and 0ms is the last day of
// 1969 west of UTC.
const EPOCH_DATE = /December 31, 1969|January 1, 1970/;

const note = (page) => page.locator('p[class*="freshnessNote"]');

describeCoverage(
  'member directory freshness with an unparseable timestamp',
  () => {
    test('the membership sentence is dropped rather than rendering "Invalid Date"', async ({
      page,
    }) => {
      expect(formatsToADate(members?.sources?.landscape?.collectedAt)).toBe(
        true,
      );
      expect(
        formatsToADate(variantMembers?.sources?.landscape?.collectedAt),
      ).toBe(false);
      // The other two sentences must survive, or the note would disappear
      // entirely and this would stop being a test of the sentence being
      // dropped. They survive on the variant page for a reason worth stating:
      // the variant overlay clears both of their timestamps to null, and
      // formatDate(null) is the epoch rather than null, so each renders an
      // epoch date. That is why the assertions below pin that text -- if
      // formatDate is ever changed to treat null as missing, DirectoryFreshness
      // returns null here and this test must be revisited rather than quietly
      // asserting an empty page.
      expect(variantMetrics?.generatedAt).toBe(null);
      expect(variantAwards?.verifiedAt).toBe(null);
      expect(formatsToADate(variantMetrics?.generatedAt)).toBe(true);
      expect(formatsToADate(variantAwards?.verifiedAt)).toBe(true);

      await page.goto(MEMBERS_PATH);
      await expect(note(page)).toContainText(MEMBERSHIP_SENTENCE);

      await page.goto(`${VARIANT_BASE}${MEMBERS_PATH}`);
      // The note still renders -- this is one sentence being absent, not the
      // component returning null or the page failing to build.
      await expect(note(page)).toHaveCount(1);
      await expect(note(page)).toContainText(ARCHITECTURES_SENTENCE);
      await expect(note(page)).toContainText(EPOCH_DATE);
      await expect(note(page)).not.toContainText(MEMBERSHIP_SENTENCE);
      // "Invalid Date" is what formatDate() exists to prevent: without its
      // Number.isNaN guard, toLocaleDateString() would render that string into
      // the sentence instead of the sentence being left out.
      await expect(note(page)).not.toContainText('Invalid Date');
    });

    test('the directory itself is unaffected by the dropped sentence', async ({
      page,
    }) => {
      await page.goto(`${VARIANT_BASE}${MEMBERS_PATH}`);

      // A member card list proves the page is intact, so the assertions above
      // are about the note and not about a build that lost the route.
      const section = page.getByRole('region', {
        name: 'End User Community organization directory',
      });
      await expect(
        section.getByRole('button', { name: /^Open .+ profile$/ }).first(),
      ).toBeVisible();
    });
  },
);
