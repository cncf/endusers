// End-to-end coverage for the key useFocusTrap deliberately ignores.
//
// src/components/hooks/useFocusTrap.js installs one document-level keydown
// listener for the whole lifetime of an open lightbox, so it sees every key
// the user presses anywhere on the page, not just Tab and Escape:
//
//   28  const onKeyDown = (event) => {
//   29    if (event.key === 'Escape') { onClose(); return; }
//   33    if (event.key !== 'Tab') return;          // <- this arm
//   34    const focusable = dialogRef.current?.querySelectorAll(...);
//   38    if (event.shiftKey && document.activeElement === first) { ... }
//   41    else if (!event.shiftKey && document.activeElement === last) { ... }
//
// The Escape arm is driven by `Escape closes the dialog` in
// tests/e2e/community-people.spec.js and tests/e2e/member-directory.spec.js;
// the two wrap arms by `traps Tab inside the dialog` and the Shift+Tab case in
// tests/e2e/interactions.spec.js. Line 33 -- the early return that makes the
// listener indifferent to every other key -- had no browser assertion at all:
// the e2e coverage report lists region 33 as uncovered
// (src/components/hooks/useFocusTrap.js, 85.71% regions).
//
// What the guard protects is not academic. Without it, any keystroke reaching
// the document while a lightbox is open falls through into the wrap logic, and
// a keystroke made with focus on the dialog's *last* focusable element then
// satisfies `!event.shiftKey && activeElement === last` and yanks focus back to
// the close button. Typing in the dialog, or pressing an arrow key to scroll
// it, would bounce focus on every keypress.
//
// Each case therefore presses its indifferent key from the last focusable
// element rather than from the close button the trap focuses on mount, which is
// the only position from which the removal of line 33 is observable. Focus is
// read back as an index into the same `button, a[href]` list the trap queries,
// so the assertion is "focus did not move", not "some element is focused".
// Escape afterwards shows the listener was still attached and still listening,
// so a passing run cannot be a detached handler.
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

// The index of the focused element within the dialog's focusable list, using
// the same selector useFocusTrap queries. -1 means focus sits outside the
// dialog, which is itself a failure of the trap.
function focusedIndex(page) {
  return page.evaluate(() => {
    const node = document.querySelector('[role="dialog"]');
    if (!node) return -2;
    const items = [...node.querySelectorAll('button, a[href]')];
    return items.indexOf(document.activeElement);
  });
}

function focusableCount(page) {
  return page.evaluate(
    () =>
      document
        .querySelector('[role="dialog"]')
        ?.querySelectorAll('button, a[href]').length ?? 0,
  );
}

// Neither key is Tab or Escape, and neither activates a focused button the way
// Enter or Space would, so any focus movement they cause came from the wrap
// logic rather than from the control itself.
const INDIFFERENT_KEYS = ['ArrowDown', 'a'];

const LIGHTBOXES = [
  {
    name: 'member profile',
    path: '/community/members',
    // The directory is one region on a page with other profile triggers, so
    // the trigger is scoped to it.
    trigger: (page) =>
      page
        .getByRole('region', {
          name: 'End User Community organization directory',
        })
        .getByRole('button', { name: /^Open .+ profile$/ })
        .first(),
  },
  {
    name: 'TAB roster profile',
    path: '/community/technical-advisory-board',
    trigger: (page) =>
      page.getByRole('button', { name: /^Open .+ profile$/ }).first(),
  },
];

test.describe('focus trap ignores keys that are neither Tab nor Escape', () => {
  for (const lightbox of LIGHTBOXES) {
    test(`the ${lightbox.name} lightbox holds focus still`, async ({
      page,
    }) => {
      await page.goto(lightbox.path);
      const trigger = lightbox.trigger(page);
      await waitForHydration(trigger);
      await trigger.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // useFocusTrap focuses the close button on mount, and that button is the
      // first element its query matches.
      await expect(
        dialog.getByRole('button', { name: /^Close .+ profile$/ }),
      ).toBeFocused();
      const count = await focusableCount(page);
      // A dialog with a single focusable is both first and last, so the two
      // wrap arms would be indistinguishable and the guard unobservable.
      expect(count).toBeGreaterThan(1);
      expect(await focusedIndex(page)).toBe(0);

      // One backward Tab wraps to the last focusable -- the only position from
      // which a key falling through line 33 would move focus.
      await page.keyboard.press('Shift+Tab');
      await expect.poll(() => focusedIndex(page)).toBe(count - 1);

      for (const key of INDIFFERENT_KEYS) {
        await page.keyboard.press(key);
        // Still the last focusable: the listener returned without touching
        // focus. Were line 33 absent, `!shiftKey && activeElement === last`
        // would hold and focus would be back at index 0.
        expect(await focusedIndex(page)).toBe(count - 1);
        await expect(dialog).toBeVisible();
      }

      // The listener is still attached and still reading keys, so the frozen
      // focus above was the guard declining to act rather than a dead handler.
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });
  }
});
