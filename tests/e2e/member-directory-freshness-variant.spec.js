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
// overlay fails here instead of leaving a test that asserts nothing.
const members = loadSiteData('members.json', COVERAGE_ENV);
const variantMembers = loadSiteData('members.json', VARIANT_ENV);
const metrics = loadSiteData('metrics.json', COVERAGE_ENV);
const awards = loadSiteData('awards.json', COVERAGE_ENV);

const parses = (value) =>
  Boolean(value) && !Number.isNaN(new Date(value).getTime());

const MEMBERSHIP_SENTENCE = /Directory membership data last synced from/;
const ARCHITECTURES_SENTENCE = /Architecture-derived profiles last synced from/;

const note = (page) => page.locator('p[class*="freshnessNote"]');

describeCoverage(
  'member directory freshness with an unparseable timestamp',
  () => {
    test('the membership sentence is dropped rather than rendering "Invalid Date"', async ({
      page,
    }) => {
      expect(parses(members?.sources?.landscape?.collectedAt)).toBe(true);
      expect(parses(variantMembers?.sources?.landscape?.collectedAt)).toBe(
        false,
      );
      // The other two sentences must survive, or the note would disappear
      // entirely and this would stop being a test of the sentence being dropped.
      expect(parses(metrics?.generatedAt)).toBe(true);
      expect(parses(awards?.verifiedAt)).toBe(true);

      await page.goto(MEMBERS_PATH);
      await expect(note(page)).toContainText(MEMBERSHIP_SENTENCE);

      await page.goto(`${VARIANT_BASE}${MEMBERS_PATH}`);
      // The note still renders -- this is one sentence being absent, not the
      // component returning null or the page failing to build.
      await expect(note(page)).toHaveCount(1);
      await expect(note(page)).toContainText(ARCHITECTURES_SENTENCE);
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
