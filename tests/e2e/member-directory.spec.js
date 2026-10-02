// End-to-end coverage for the MemberProfile dialog's logo-less rendering on
// /community/members.
//
// tests/e2e/interactions.spec.js already drives the dialog's focus trap and
// backdrop dismissal, but every case there opens `.first()` card — and the
// first card in data/members.json carries a logo. The dialog's other arm, the
// large initials shown when a member has no logo
// (src/components/MemberDirectory/MemberProfile.js:35-41), was therefore never
// executed in a browser: the CI e2e coverage report listed MemberProfile.js at
// 97.65% with lines 39-42 uncovered.
//
// The unit suite does cover that arm (tests/member-directory.test.mjs drives
// MemberProfile through tests/tools/fake-dom.mjs), so the unit gate cannot see
// this gap. Only a browser against `build/` can, because the hydrated dialog is
// mounted client-side on click and never appears in the static HTML at all.
//
// The card-level fallback in MemberCard.js is a separate element that *is*
// server-rendered, and is already covered; this spec is about the dialog.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '../tools/e2e-coverage.cjs';

const MEMBERS_PATH = '/community/members';

// Playwright transpiles these .js specs to CommonJS (the package is not
// "type": "module"), so import.meta is unavailable. Playwright runs from the
// directory holding playwright.config.js, so the data file is addressed from
// the project root.
const membersData = JSON.parse(
  readFileSync(resolve('data/members.json'), 'utf8'),
);
const members = membersData.members || [];

// data/members.json is regenerated from the CNCF landscape by
// `npm run generate:members`, so which organizations happen to lack a logo
// changes with no source edit. The member driving this case is therefore
// selected from the data at run time rather than named here.
const withoutLogo = members.find((member) => !member.logo);

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

test.describe('member profile dialog without a logo', () => {
  test('shows the member initials in place of a logo image', async ({
    page,
  }) => {
    test.skip(!withoutLogo, 'every member in data/members.json carries a logo');

    await page.goto(MEMBERS_PATH);
    const section = page.getByRole('region', {
      name: 'End User Community organization directory',
    });
    const trigger = section.getByRole('button', {
      name: `Open ${withoutLogo.name} profile`,
      exact: true,
    });
    await waitForHydration(trigger);

    // The card's own fallback is server-rendered, so it is readable before the
    // dialog exists. Comparing the dialog against it keeps this spec from
    // restating the initials() rule that utils.js owns and the unit suite
    // already pins.
    const cardInitials = (
      await trigger.locator('span[class^="initials_"]').innerText()
    ).trim();
    expect(cardInitials).not.toEqual('');

    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const stage = dialog.locator('div[class*="logoStage"]');
    const large = stage.locator('span[class^="initialsLarge_"]');
    await expect(large).toHaveCount(1);
    await expect(large).toHaveText(cardInitials);

    // The two arms are exclusive: the initials stand in for the image rather
    // than sitting behind a broken one.
    await expect(stage.locator('img')).toHaveCount(0);
  });

  test('renders a logo image for a member that has one', async ({ page }) => {
    const withLogo = members.find((member) => member.logo);
    test.skip(!withLogo, 'no member in data/members.json carries a logo');

    await page.goto(MEMBERS_PATH);
    const section = page.getByRole('region', {
      name: 'End User Community organization directory',
    });
    const trigger = section.getByRole('button', {
      name: `Open ${withLogo.name} profile`,
      exact: true,
    });
    await waitForHydration(trigger);
    await trigger.click();

    const stage = page.getByRole('dialog').locator('div[class*="logoStage"]');
    await expect(stage.locator('img')).toHaveCount(1);
    await expect(stage.locator('span[class^="initialsLarge_"]')).toHaveCount(0);
  });
});
