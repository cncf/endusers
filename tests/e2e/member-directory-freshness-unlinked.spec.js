// End-to-end coverage for the plain-text arms of the provenance note on
// /community/members, which render when a source carries a date but no URL.
//
// DirectoryFreshness links each named source through a ternary
// (src/components/MemberDirectory/DirectoryFreshness.js):
//
//   25    {landscape?.sourceUrl ? (
//   26      <a href={landscape.sourceUrl} ...>cncf/landscape</a>
//   29    ) : (
//   30      'cncf/landscape'
//   31    )}
//
//   39    {architectures?.repository ? (
//   40      <a href={architectures.repository} ...>cncf/architecture</a>
//   43    ) : (
//   44      'cncf/architecture'
//   45    )}
//
// The right-hand arms at lines 30 and 44 are ordinary shapes rather than
// defensive dead code: data/members.json's sources.landscape is copied from
// the pinned landscape snapshot by scripts/generate-members.mjs, and
// data/metrics.json's sources.architectures is written by
// `npm run collect:metrics`. Either collector can pin a source it cannot
// address by URL, and the component is written to name the source as text
// rather than emit an empty anchor. tests/e2e/member-directory-freshness.spec.js
// already asserts the other side -- that both URLs are present and absolute --
// and says in so many words that "the component falls back to plain text when
// a source carries no URL", but the committed data always carries both URLs,
// so no browser has ever run the fallback.
//
// Why this rides the no-revision build. Each arm needs its sentence to render
// -- a parseable timestamp -- while its URL is absent, and that pair conflicts
// with both existing builds:
//
//   * the ordinary coverage build is where the anchors at lines 26 and 40 are
//     measured from, so clearing the URLs there would trade those arms for
//     these rather than add a case;
//   * tests/e2e/fixtures/data-variant/ makes sources.landscape.collectedAt
//     unparseable and clears metrics.generatedAt, so on that page neither
//     sentence renders at all and the ternaries are never evaluated.
//
// tests/e2e/fixtures/data-no-revision/ holds exactly the shape these arms
// need: it leaves metrics.generatedAt and the landscape timestamp alone, so
// the note renders both sentences, and ReferenceArchitectures -- the component
// that build exists for -- returns at its revision guard before it reads
// sources.architectures.repository. Clearing the two URLs there un-covers
// nothing that build reaches. It is hosted there rather than in a directory of
// its own because each fixture directory is a full Docusaurus compile in the
// "End-to-end coverage" job (see the preamble of
// tests/tools/e2e-data-fixtures.cjs): a new build is for a shape that
// conflicts with every existing one, and this shape does not.
//
// The real route is asserted beside the no-revision one. An assertion that a
// page has no link passes just as well when the page failed to build or the
// selector is wrong; the pair is what makes it evidence that the ternary
// switched arms.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';

const MEMBERS_PATH = '/community/members';
const NO_REVISION_BASE = '/e2e-coverage-no-revision';

const COVERAGE_ENV = { E2E_COVERAGE: '1' };
const NO_REVISION_ENV = {
  E2E_COVERAGE: '1',
  E2E_COVERAGE_BUILD: 'no-revision',
};

// Read through the overlays rather than hard-coded, so an edited fixture fails
// here instead of leaving a test that asserts nothing. Each document is loaded
// with the env of the build whose page it is asserted against.
const members = loadSiteData('members.json', COVERAGE_ENV);
const metrics = loadSiteData('metrics.json', COVERAGE_ENV);
const unlinkedMembers = loadSiteData('members.json', NO_REVISION_ENV);
const unlinkedMetrics = loadSiteData('metrics.json', NO_REVISION_ENV);

const MEMBERSHIP_SENTENCE = /Directory membership data last synced from/;
const ARCHITECTURES_SENTENCE = /Architecture-derived profiles last synced from/;

const note = (page) => page.locator('p[class*="freshnessNote"]');

// The no-revision site is only built by the coverage run; outside it the base
// path does not exist.
const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

describeCoverage('member directory freshness without source URLs', () => {
  test('each source is named as plain text when it carries no URL', async ({
    page,
  }) => {
    // The shapes the two pages are built from. Stated as assertions rather
    // than used to skip: an overlay that stopped clearing a URL would leave
    // the arms below unexercised, which is the silent retirement this pair
    // exists to catch.
    expect(members?.sources?.landscape?.sourceUrl).toMatch(/^https:\/\//);
    expect(metrics?.sources?.architectures?.repository).toMatch(/^https:\/\//);
    expect(unlinkedMembers?.sources?.landscape?.sourceUrl).toBe(null);
    expect(unlinkedMetrics?.sources?.architectures?.repository).toBe(null);
    // Both sentences have to render on the no-revision page, or the ternaries
    // are never reached and an absent link would prove nothing.
    expect(unlinkedMembers?.sources?.landscape?.collectedAt).toEqual(
      members?.sources?.landscape?.collectedAt,
    );
    expect(unlinkedMetrics?.generatedAt).toEqual(metrics?.generatedAt);

    await page.goto(MEMBERS_PATH);
    for (const name of ['cncf/landscape', 'cncf/architecture']) {
      await expect(
        note(page).getByRole('link', { name, exact: true }),
      ).toHaveCount(1);
    }

    await page.goto(`${NO_REVISION_BASE}${MEMBERS_PATH}`);
    // The note still renders both sentences -- this is two links becoming
    // text, not a sentence being dropped or the component returning null.
    await expect(note(page)).toHaveCount(1);
    await expect(note(page)).toContainText(MEMBERSHIP_SENTENCE);
    await expect(note(page)).toContainText(ARCHITECTURES_SENTENCE);

    for (const name of ['cncf/landscape', 'cncf/architecture']) {
      // The source is still named, so the sentence reads as prose rather than
      // losing the source it is about...
      await expect(note(page)).toContainText(name);
      // ...and it is named as text, not as an anchor with an empty href,
      // which is what the ternary exists to avoid.
      await expect(
        note(page).getByRole('link', { name, exact: true }),
      ).toHaveCount(0);
    }
    await expect(note(page).getByRole('link')).toHaveCount(0);
  });

  test('the directory itself is unaffected by the unlinked sources', async ({
    page,
  }) => {
    await page.goto(`${NO_REVISION_BASE}${MEMBERS_PATH}`);

    // A member card list proves the page is intact, so the assertions above
    // are about the note and not about a build that lost the route.
    const section = page.getByRole('region', {
      name: 'End User Community organization directory',
    });
    await expect(
      section.getByRole('button', { name: /^Open .+ profile$/ }).first(),
    ).toBeVisible();
  });
});
