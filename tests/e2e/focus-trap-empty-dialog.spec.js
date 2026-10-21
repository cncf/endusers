// End-to-end coverage for the focusable-free arm of the focus trap.
//
//   const focusable = dialogRef.current?.querySelectorAll('button, a[href]');
//   if (!focusable?.length) return;
//     the Tab cycling in src/components/hooks/useFocusTrap.js
//
// Both shipped consumers of the hook -- PersonDialog in
// src/components/CommunityPeople/index.js and MemberProfile in
// src/components/MemberDirectory/MemberProfile.js -- render their close
// <button> unconditionally, so every dialog the published site can build
// matches at least one focusable element and the early return is unreachable
// from published content. No field of data/community-people.json or
// data/members.json decides whether that button renders, so a data overlay
// cannot reach it either. tests/use-focus-trap.test.mjs pins the arm in the
// unit suite ("Tab is ignored when the dialog holds no focusable elements"),
// which left it covered there and nowhere in a browser.
//
// So the shape gets a page of its own in the fixture docs instance, the same
// mechanism tests/e2e/community-people-unknown-section.spec.js uses:
// docusaurus.config.js registers a second docs instance over
// tests/e2e/fixtures/docs/** when E2E_COVERAGE=1 and serves it under
// /e2e-coverage-fixtures/. That page is compiled by the coverage build only --
// `npm run build:production`, the gating "End-to-end tests" job and the
// deployed site never see it -- which is why this file is skipped outside the
// coverage run, where the route 404s.
//
// Taking the arm is asserted from both ends, because an unmoved caret proves
// nothing on its own.
//
//   * Tab must behave as though no handler were installed: focus leaves the
//     trigger for the sentinel that follows the dialog in document order. A
//     dialog whose Tab were trapped would have kept focus inside it, and one
//     whose handler ran past the guard would have called preventDefault.
//   * Escape must still close the dialog. Without that, a hook that never
//     installed its keydown listener at all -- or one unmounted early --
//     would produce the same Tab result, and the first assertion would be
//     measuring the browser rather than the guard.
import { test, expect } from '../tools/e2e-coverage.cjs';

const FIXTURE_ROUTE = '/e2e-coverage-fixtures/focus-trap-empty-dialog';

const TRIGGER = '#focus-trap-fixture-trigger';
const SENTINEL = '#focus-trap-fixture-sentinel';
const DIALOG = '#focus-trap-fixture-dialog';

const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

describeCoverage('useFocusTrap with a focusable-free dialog', () => {
  test('Tab is left to the browser when the dialog holds nothing focusable', async ({
    page,
  }) => {
    const response = await page.goto(FIXTURE_ROUTE);
    expect(response?.status()).toBe(200);

    await page.click(TRIGGER);
    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible();

    // The premise of the case: this dialog is the shape no shipped dialog can
    // be. If a future edit gave the fixture a close button, the assertions
    // below would still pass against a fully trapped dialog.
    await expect(dialog.locator('button, a[href]')).toHaveCount(0);

    // Clicking the trigger focused it, and the hook had no close ref to move
    // focus to, so focus is still there when the dialog is open.
    await expect(page.locator(TRIGGER)).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.locator(SENTINEL)).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(page.locator(TRIGGER)).toBeFocused();
  });

  test('the trap is still listening: Escape closes the dialog', async ({
    page,
  }) => {
    const response = await page.goto(FIXTURE_ROUTE);
    expect(response?.status()).toBe(200);

    await page.click(TRIGGER);
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toHaveCount(0);

    // The hook restores focus to the trigger on unmount, which is the other
    // half of the listener having been live.
    await expect(page.locator(TRIGGER)).toBeFocused();
  });
});
