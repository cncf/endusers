// End-to-end coverage for the arm of the profile lightboxes' backdrop handler
// that must *not* dismiss: a mousedown that starts inside the dialog box.
//
// Both lightboxes guard dismissal the same way, with the handler bound to the
// backdrop rather than to the dialog:
//
//   onMouseDown={(event) => event.target === event.currentTarget && onClose()}
//     src/components/MemberDirectory/MemberProfile.js line 15
//     src/components/CommunityPeople/index.js line 32
//
// tests/e2e/interactions.spec.js:261 and tests/e2e/community-people.spec.js:181
// drive the true arm in a browser -- a mousedown at a coordinate clear of the
// dialog closes it. Nothing drives the false arm, and the e2e coverage report
// on `main` names both lines as uncovered regions while the unit suite reports
// both files at 100% region coverage.
//
// The regression this guards is specific: drop the
// `event.target === event.currentTarget` test, and pressing a mouse button
// anywhere inside the profile dismisses it. Replacing both handlers with a
// bare `onMouseDown={() => onClose()}` and rebuilding was measured against the
// three specs that already drive these dialogs: 34 of their 35 cases stay
// green, and the one that fails -- community-people.spec.js:170, "clicking the
// close button closes it and restores focus" -- fails on its focus-restoration
// assertion, saying nothing about the guard. Both cases below fail on the
// dialog disappearing, which is the behaviour itself. The unit suite cannot
// see any of it: tests/tools/fake-dom.mjs dispatches a synthesised event
// straight at the handler, so it never exercises which element the listener is
// bound to or the bubbling that the guard reads.
//
// The cases below are stated as behaviour rather than as a coverage claim: the
// e2e reporter keys a region on its mapped original coordinates, and the two
// arms here are emitted under coordinates that no browser interaction reaches,
// so landing this spec does not clear either line from the uncovered-region
// list (the same attribution limit tracked by #1066 and #1079).
import { test, expect } from '../tools/e2e-coverage.cjs';

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

async function openProfile(page, path, region) {
  await page.goto(path);
  const root = region ? page.getByRole('region', { name: region }) : page;
  const trigger = root
    .getByRole('button', { name: /^Open .+ profile$/ })
    .first();
  await waitForHydration(trigger);
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

const DIALOGS = [
  {
    name: 'member profile',
    path: '/community/members',
    region: 'End User Community organization directory',
    // MemberProfile labels its <section role="dialog"> with this heading.
    headingId: 'member-profile-name',
  },
  {
    name: 'TAB roster profile',
    path: '/community/technical-advisory-board',
    // PersonDialog labels itself with the heading carrying this id.
    headingId: 'profile-name',
  },
];

for (const { name, path, region, headingId } of DIALOGS) {
  test(`${name} dialog survives a mousedown inside it`, async ({ page }) => {
    const dialog = await openProfile(page, path, region);

    // Pressed on the dialog's own heading rather than at a coordinate, so the
    // case cannot pass by missing the backdrop altogether: the event starts on
    // a descendant and bubbles to the backdrop, which is exactly the shape the
    // `event.target === event.currentTarget` test rejects. The heading is
    // inert, so nothing else can swallow the event or navigate away.
    const heading = dialog.locator(`#${headingId}`);
    await expect(heading).toBeVisible();
    await heading.click();

    await expect(dialog).toBeVisible();
    await expect(heading).toBeVisible();

    // Still dismissible afterwards, so the assertion above is the guard
    // declining to close rather than the handler having come detached.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}
