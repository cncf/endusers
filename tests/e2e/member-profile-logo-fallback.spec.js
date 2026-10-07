// End-to-end coverage for the arm MemberProfile takes when an organization
// ships no logo.
//
// `MemberProfile` resolves its logo before it knows whether there is one:
//
//   const logoUrl = useBaseUrl(member.logo || '');
//     src/components/MemberDirectory/MemberProfile.js line 10
//
//   {member.logo ? (<img ... />) : (<span className={styles.initialsLarge}>…)}
//     src/components/MemberDirectory/MemberProfile.js lines 35-41
//
// `MemberCard` carries the identical `member.logo || ''` on its own line 10 and
// the browser reaches it, because the directory grid renders every card at
// once and some organizations have no logo. The dialog is different: it is
// mounted only for the one organization whose card was clicked, and every
// existing spec clicks an organization that *has* a logo --
// tests/e2e/interactions.spec.js:154 opens BlackRock, and
// tests/e2e/data-fixtures.spec.js:169 reads the fixture organization's card
// without ever opening it. So nothing drives the logo-less dialog, and the e2e
// coverage report on `main` names line 10 an uncovered region while the unit
// suite reports the file at 100%.
//
// Measured at `7ab301e`, run `local-1` (see the PR body for provenance): the
// `|| ''` region `10:40:10:48` has count 0 in all six scripts that carry this
// module, and the initials arm's region `35:24:38:15` has count 0 as well --
// it stays off the uncovered list only because the reporter's phantom-region
// filter drops it. The paired case below drives both.
//
// This is an *additive* case, not a build swap: the fixture organization is
// one appended record, so the directory keeps rendering the hundred-odd
// organizations that do have logos and both arms are reachable in the same
// build. The region therefore folds onto the real build's coordinates rather
// than needing the variant site, unlike the branches in
// tests/e2e/data-variants.spec.js.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';

// The logo-less organization is supplied by the overlay in
// tests/e2e/fixtures/data/members.json, which only the E2E_COVERAGE=1 build
// applies. Outside the coverage run there is no record to address.
const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

const members = loadSiteData('members.json').members;

// Addressed through the overlay rather than by a hard-coded string, so a
// renamed or dropped fixture fails here instead of leaving a spec that asserts
// nothing. `data/members.json` carries real logo-less organizations too, but
// which ones is decided by an upstream refresh; the fixture record is
// committed, so it cannot stop being logo-less.
const logoless = members.find((member) => member.id === 'coverage-fixture-org');
const withLogo = members.find((member) => member.logo);

// src/components/MemberDirectory/utils.js initials(): the first letter of each
// of the first two whitespace-separated words, upper-cased.
function initialsOf(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

// React attaches its fiber to the DOM node it hydrates, so the presence of a
// `__react*` property is the signal that the element's handlers are live.
// Typing before that point silently discards the input.
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

// The directory renders every member card, so the search box is what makes one
// organization's card addressable without depending on grid order.
async function openMemberProfile(page, name) {
  await page.goto('/community/members');
  const section = page.getByRole('region', {
    name: 'End User Community organization directory',
  });
  const search = section.getByLabel('Search organizations by name');
  await waitForHydration(search);
  await search.fill(name);

  const trigger = section.getByRole('button', { name: `Open ${name} profile` });
  await expect(trigger).toHaveCount(1);
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#member-profile-name')).toHaveText(name);
  return dialog;
}

describeCoverage('member profile logo fallback', () => {
  test('an organization with no logo opens on its initials', async ({
    page,
  }) => {
    expect(logoless).toBeTruthy();
    expect(logoless.logo).toBe(null);

    const dialog = await openMemberProfile(page, logoless.name);
    const stage = dialog.locator('div[class*="logoStage"]');

    // The initials stand in for the image: an empty stage would pass an
    // img-count assertion on its own, so assert what renders instead.
    await expect(stage.locator('img')).toHaveCount(0);
    await expect(stage).toHaveText(initialsOf(logoless.name));
  });

  test('an organization with a logo opens on its image', async ({ page }) => {
    expect(withLogo).toBeTruthy();
    expect(typeof withLogo.logo).toBe('string');

    const dialog = await openMemberProfile(page, withLogo.name);
    const stage = dialog.locator('div[class*="logoStage"]');

    // Paired with the case above so the two together are evidence that the
    // ternary *switched*, rather than that every profile renders the same
    // stage.
    await expect(stage.locator('img')).toHaveCount(1);
    await expect(stage.locator('img')).toHaveAttribute(
      'src',
      new RegExp(`${withLogo.logo}$`),
    );
    await expect(stage).toHaveText('');
  });
});
