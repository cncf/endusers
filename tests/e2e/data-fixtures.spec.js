// End-to-end coverage for the component branches that only the overlaid
// coverage data can reach.
//
// Each case below renders a path the site will take as soon as upstream data
// shifts -- an archived user-group repository, a person listed with neither
// role nor company, an organization holding both membership roles. None of
// those shapes occur in
// the checked-in data/*.json, so against `npm run build:production` there is
// nothing to assert: the branches are not merely untested, they are
// unreachable. tests/tools/e2e-data-fixtures.cjs overlays the missing shapes
// into the E2E_COVERAGE=1 build only, which is what makes these assertions
// possible without changing a byte of what the site ships.
//
// The whole file is therefore skipped outside the coverage run: the gating
// "End-to-end tests" job builds with the real data, where every expectation
// here would be false.
//
// One related branch is deliberately absent. AwardsTimeline renders its
// provenance paragraph only when data/awards.json carries a verifiedAt, and
// the ': null' arm beside it only when it does not. verifiedAt is a single
// document-level field on the one file one page reads, so an overlay that
// clears it does not add a case -- it swaps which arm is reachable, covering
// one line at the cost of the fourteen that render the paragraph. That branch
// needs per-route data, not a per-build overlay.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';

// The overlays are applied by the E2E_COVERAGE=1 build only, so outside the
// coverage run there is no fixture data to assert against.
const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

// Addressed through the overlay rather than by a hard-coded string so a
// renamed fixture fails here instead of silently passing on the real data.
const groups = loadSiteData('community-groups.json').groups;
const stale = groups.filter((group) => group.archived || !group.reachable);
const people = loadSiteData('community-people.json').people.staff || [];
const anonymous = people.find((person) => !person.role && !person.company);
const members = loadSiteData('members.json').members;
const dualRole = members.find(
  (member) => member.membershipStatus === 'member-and-contributor',
);

// React attaches its fiber to the DOM node it hydrates, so the presence of a
// `__react*` property is the signal that the element's handlers are live.
// Clicking before that point silently discards the input.
async function waitForHydration(locator) {
  await locator.waitFor({ state: 'visible' });
  await locator.evaluate(async (element) => {
    const hydrated = (node) =>
      Object.keys(node).some((key) => key.startsWith('__react'));
    while (!hydrated(element)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
}

describeCoverage('drifted upstream data', () => {
  test('GroupLinkStatus warns about an archived or unreachable group', async ({
    page,
  }) => {
    expect(stale.length).toBeGreaterThan(0);

    await page.goto('/community');
    const warning = page.getByText(
      /archived or unreachable upstream repositor(y|ies) — verify the group is still active/,
    );
    await expect(warning).toBeVisible();
    for (const group of stale) {
      await expect(warning).toContainText(group.name);
    }
  });

  test('PersonDialog falls back to "Community member" with no role or company', async ({
    page,
  }) => {
    expect(anonymous).toBeTruthy();

    await page.goto('/community');
    const trigger = page.getByRole('button', {
      name: `Open ${anonymous.name} profile`,
    });
    await waitForHydration(trigger);
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#profile-name')).toHaveText(anonymous.name);
    await expect(
      dialog.getByText('Community member', { exact: true }),
    ).toHaveCount(1);
  });

  test('MemberCard labels an organization holding both membership roles', async ({
    page,
  }) => {
    expect(dualRole).toBeTruthy();

    await page.goto('/community/members');
    const section = page.getByRole('region', {
      name: 'End User Community organization directory',
    });
    const search = section.getByLabel('Search organizations by name');
    await waitForHydration(search);
    await search.fill(dualRole.name);

    const card = section.locator('article', { hasText: dualRole.name });
    await expect(card).toHaveCount(1);
    await expect(
      card.getByText('End User Member and Contributor').first(),
    ).toBeVisible();
  });
});
