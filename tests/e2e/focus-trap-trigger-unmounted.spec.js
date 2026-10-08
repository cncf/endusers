// End-to-end coverage for useFocusTrap's cleanup when the element that opened
// the lightbox is gone by the time the lightbox closes.
//
// src/components/hooks/useFocusTrap.js ends its effect with:
//
//   48  return () => {
//   49    document.body.style.overflow = previousOverflow;
//   50    document.removeEventListener('keydown', onKeyDown);
//   51    (triggerRef.current || previousFocus)?.focus?.();
//   52  };
//
// Every existing lightbox spec closes the dialog with Escape, the close button
// or a backdrop click, and in all three the trigger is still mounted, so
// `triggerRef.current` is truthy and the `previousFocus` operand at line 51 is
// never evaluated. The e2e coverage report on `main` names line 51 as an
// uncovered region while the unit suite reports the file at 100% regions.
//
// There is a browser path that nulls the ref: both lightboxes are rendered by
// the card that triggers them (`src/components/MemberDirectory/MemberCard.js`
// lines 72-78), so filtering that card out of the directory unmounts the
// trigger and the dialog in the same commit. React detaches refs during the
// mutation phase and runs passive-effect cleanups afterwards, so the cleanup
// above observes `triggerRef.current === null` and falls through to
// `previousFocus`.
//
// That path is reachable by ordinary use: the search field stays live behind
// the backdrop, so a visitor who opens a profile and then keeps typing to
// narrow the directory lands in it. The regressions it guards are two, and
// both are user-visible rather than notional:
//
//   * Written as `triggerRef.current.focus()` -- the obvious simplification,
//     since in every other close path the trigger is mounted -- the cleanup
//     throws a TypeError in the middle of the commit, which React escalates
//     into an unmount of the surrounding tree. The page is left broken while
//     the visitor is mid-keystroke.
//   * The throw also happens *before* line 49 would have run on a reordered
//     cleanup, which is the body scroll lock. A visitor left with
//     `body { overflow: hidden }` and no dialog cannot scroll the page at all.
//
// The cases therefore assert the observable consequences -- no page error, the
// scroll lock released, and focus left where the visitor put it -- rather than
// asserting that a line ran.
import { test, expect } from '../tools/e2e-coverage.cjs';

// React attaches its fiber to the DOM node it hydrates, so the presence of a
// `__react*` property is the signal that the element's handlers are live.
// Interacting before that point silently discards the input.
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

// A query no organization in data/members.json can match, so every card --
// including the one whose profile is open -- leaves the list.
const NO_MATCH_QUERY = 'zzzz-no-such-organization';

test('closing a member profile by filtering its card away leaves the page usable', async ({
  page,
}) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/community/members');
  const directory = page.getByRole('region', {
    name: 'End User Community organization directory',
  });
  const trigger = directory
    .getByRole('button', { name: /^Open .+ profile$/ })
    .first();
  await waitForHydration(trigger);

  // The value the cleanup must restore. Read before the dialog opens rather
  // than assumed to be '': the trap saves whatever was there, and the theme
  // may have set it.
  const overflowBeforeOpen = await page.evaluate(
    () => document.body.style.overflow,
  );
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // useFocusTrap locks body scroll while the dialog is open; reading it here
  // makes the release assertion below a change rather than a coincidence.
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe('hidden');

  // Focused through the DOM rather than by clicking: the backdrop covers the
  // viewport, so a click would dismiss the dialog through the backdrop handler
  // and the trigger would still be mounted when it did. Focusing directly
  // reproduces what a visitor who never left the field is doing.
  const search = page.locator('#member-search');
  await search.evaluate((element) => element.focus());
  await expect(search).toBeFocused();

  // Real key events, so React's onChange drives the filter exactly as it does
  // for a visitor. The trap's listener ignores keys that are neither Tab nor
  // Escape (line 33), so the typing itself cannot close the dialog.
  await page.keyboard.type(NO_MATCH_QUERY);

  // The card carrying the dialog is filtered out, so the dialog unmounts with
  // it -- this is the close path, not a dismissal.
  await expect(dialog).toHaveCount(0);
  await expect(
    directory.getByRole('button', { name: /^Open .+ profile$/ }),
  ).toHaveCount(0);

  // The cleanup ran to completion: nothing threw out of the commit, ...
  expect(pageErrors).toEqual([]);
  // ... the scroll lock was released back to the value the trap saved, ...
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe(overflowBeforeOpen);
  // ... and focus was not yanked out of the field the visitor is typing in.
  // `previousFocus` is the now-detached trigger, and calling focus() on a
  // detached element is a no-op, so the search input keeps the caret.
  await expect(search).toBeFocused();
  await expect(search).toHaveValue(NO_MATCH_QUERY);

  // The directory is still live afterwards, so the assertions above describe a
  // working page rather than one that stopped responding mid-commit.
  await search.fill('');
  await expect(
    directory.getByRole('button', { name: /^Open .+ profile$/ }).first(),
  ).toBeVisible();
});
