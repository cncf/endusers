// End-to-end coverage for the member directory provenance note being dropped
// altogether, when none of the three dates it is built from parses.
//
// DirectoryFreshness opens with an all-absent guard
// (src/components/MemberDirectory/DirectoryFreshness.js):
//
//   if (!landscapeDate && !architecturesDate && !awardsDate) return null;
//
// Every other build renders the note, so that `return null` is the one arm of
// the component no browser took. The "End-to-end coverage" job recorded it as
// an uncovered region in all three compiled builds while the unit suite scored
// the file at 100% regions -- the gap this build and this spec close.
//
// Why this needs a build of its own. The arm needs all three dates to be
// absent at the same time, and that shape conflicts with every existing build:
//
//   * the ordinary coverage build is where the whole note is measured --
//     tests/e2e/member-directory-freshness.spec.js asserts both source
//     anchors -- so clearing the dates there would trade that coverage for
//     this arm rather than add a case;
//   * tests/e2e/fixtures/data-variant/ sets metrics.generatedAt and
//     awards.verifiedAt to null, and formatDate renders null as the Unix
//     epoch rather than dropping it, so two of the three dates stay truthy
//     there. tests/e2e/member-directory-freshness-variant.spec.js asserts
//     exactly that, and asserts the sentences they produce, so the shape
//     cannot be changed underneath it;
//   * tests/e2e/fixtures/data-no-revision/ needs both timestamps parseable,
//     because the plain-text `cncf/landscape` and `cncf/architecture` arms it
//     exists for are only reached while their sentences render.
//
// That is the bar tests/tools/e2e-data-fixtures.cjs sets for a new directory:
// a shape that provably conflicts with every existing one.
//
// The three overlays use unparseable strings rather than null for the reason
// the variant build demonstrates: `new Date(null)` is the epoch, not an
// Invalid Date, so a null leaves the sentence rendering with an absurd date
// instead of reaching the guard.
//
// The real route is asserted beside this one. On its own, an assertion that a
// page has no note passes just as well when the page failed to build or the
// selector is wrong; the pair is what makes it evidence that the guard fired.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';
import { expectDirectoryIntact } from './helpers/member-directory-assertions.js';

const MEMBERS_PATH = '/community/members';
const ABSENT_BASE = '/e2e-coverage-unparseable-dates';

const COVERAGE_ENV = { E2E_COVERAGE: '1' };
const ABSENT_ENV = {
  E2E_COVERAGE: '1',
  E2E_COVERAGE_BUILD: 'unparseable-dates',
};

// Read through the overlays rather than hard-coded, so an edited fixture fails
// here instead of leaving a test that asserts nothing. Each document is loaded
// with the env of the build whose page it is asserted against.
const members = loadSiteData('members.json', COVERAGE_ENV);
const metrics = loadSiteData('metrics.json', COVERAGE_ENV);
const awards = loadSiteData('awards.json', COVERAGE_ENV);
const absentMembers = loadSiteData('members.json', ABSENT_ENV);
const absentMetrics = loadSiteData('metrics.json', ABSENT_ENV);
const absentAwards = loadSiteData('awards.json', ABSENT_ENV);

// formatDate()'s own contract: `null` is not unparseable. `new Date(null)` is
// the Unix epoch, so Number.isNaN(getTime()) is false and the date formats
// rather than dropping (src/components/shared/formatDate.js). This is the
// distinction the whole build rests on, so it is asserted rather than assumed.
const formatsToADate = (value) => !Number.isNaN(new Date(value).getTime());

const MEMBERSHIP_SENTENCE = /Directory membership data last synced from/;
const ARCHITECTURES_SENTENCE = /Architecture-derived profiles last synced from/;
const AWARDS_SENTENCE = /Award data last verified on/;

const note = (page) => page.locator('p[class*="freshnessNote"]');

// The unparseable-dates site is only built by the coverage run; outside it the
// base path does not exist.
const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

describeCoverage('member directory freshness with no parseable date', () => {
  test('the whole provenance note is dropped rather than rendering empty sentences', async ({
    page,
  }) => {
    // The shapes the two pages are built from. Stated as assertions rather
    // than used to skip: an overlay that stopped clearing a date would leave
    // the guard unexercised, which is the silent retirement this pair exists
    // to catch.
    expect(formatsToADate(members?.sources?.landscape?.collectedAt)).toBe(true);
    expect(formatsToADate(metrics?.generatedAt)).toBe(true);
    expect(formatsToADate(awards?.verifiedAt)).toBe(true);
    // All three must be unparseable together, or the guard's remaining
    // operands short-circuit and the note still renders.
    expect(formatsToADate(absentMembers?.sources?.landscape?.collectedAt)).toBe(
      false,
    );
    expect(formatsToADate(absentMetrics?.generatedAt)).toBe(false);
    expect(formatsToADate(absentAwards?.verifiedAt)).toBe(false);

    await page.goto(MEMBERS_PATH);
    await expect(note(page)).toHaveCount(1);
    await expect(note(page)).toContainText(MEMBERSHIP_SENTENCE);
    await expect(note(page)).toContainText(ARCHITECTURES_SENTENCE);
    await expect(note(page)).toContainText(AWARDS_SENTENCE);

    await page.goto(`${ABSENT_BASE}${MEMBERS_PATH}`);
    // The component returned null: not one sentence missing, the element
    // itself absent.
    await expect(note(page)).toHaveCount(0);
    // "Invalid Date" is what formatDate() exists to prevent, and dropping the
    // note is what DirectoryFreshness does once formatDate has dropped every
    // date. Neither the string nor a stranded sentence may survive.
    await expect(page.locator('body')).not.toContainText('Invalid Date');
    for (const sentence of [
      MEMBERSHIP_SENTENCE,
      ARCHITECTURES_SENTENCE,
      AWARDS_SENTENCE,
    ]) {
      await expect(page.locator('body')).not.toContainText(sentence);
    }
  });

  test('the directory itself is unaffected by the dropped note', async ({
    page,
  }) => {
    await page.goto(`${ABSENT_BASE}${MEMBERS_PATH}`);

    // A member card list proves the page is intact, so the assertions above
    // are about the note and not about a build that lost the route.
    await expectDirectoryIntact(page, expect);
  });
});
