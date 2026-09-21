import assert from 'node:assert/strict';
import test from 'node:test';
import { useFocusTrap } from '../src/components/hooks/useFocusTrap.js';
import { installFakeDom } from './tools/fake-dom.mjs';
import { renderHook } from './tools/react-hook-driver.mjs';

// Builds a mounted focus trap over a dialog containing the supplied focusable
// children, and returns everything a test needs to drive and inspect it.
function mountTrap({ children = [], overflow = '', trigger = null } = {}) {
  const dom = installFakeDom({ overflow });
  const closeButton = dom.createElement('button');
  const focusable = [closeButton, ...children];
  const closeCalls = [];
  const triggerRef = { current: trigger };

  const hook = renderHook(() =>
    useFocusTrap({
      onClose: (...args) => closeCalls.push(args),
      triggerRef,
    }),
  );

  // The effect reads these refs, and React attaches nodes before effects run.
  // Assign them, then rerender: onClose is a fresh closure each render, so the
  // dependency array changes and the effect re-runs against the attached refs.
  hook.result.closeRef.current = closeButton;
  hook.result.dialogRef.current = dom.createDialog(focusable);
  hook.rerender();

  return { dom, hook, closeButton, focusable, closeCalls, triggerRef };
}

test('returns stable dialogRef and closeRef objects', () => {
  const dom = installFakeDom();
  try {
    const hook = renderHook(() =>
      useFocusTrap({ onClose: () => {}, triggerRef: { current: null } }),
    );
    const first = hook.result;
    assert.ok(Object.hasOwn(first.dialogRef, 'current'));
    assert.ok(Object.hasOwn(first.closeRef, 'current'));
    const second = hook.rerender();
    assert.equal(second.dialogRef, first.dialogRef);
    assert.equal(second.closeRef, first.closeRef);
    hook.unmount();
  } finally {
    dom.restore();
  }
});

test('locks body scroll on mount and restores the previous value on unmount', () => {
  const dom = installFakeDom({ overflow: 'scroll' });
  try {
    const hook = renderHook(() =>
      useFocusTrap({ onClose: () => {}, triggerRef: { current: null } }),
    );
    assert.equal(dom.document.body.style.overflow, 'hidden');
    hook.unmount();
    assert.equal(dom.document.body.style.overflow, 'scroll');
  } finally {
    dom.restore();
  }
});

test('moves focus to the close button on mount', () => {
  const { dom, hook, closeButton } = mountTrap();
  try {
    assert.equal(closeButton.focusCount, 1);
    assert.equal(dom.document.activeElement, closeButton);
    hook.unmount();
  } finally {
    dom.restore();
  }
});

test('tolerates a closeRef that is not yet attached', () => {
  const dom = installFakeDom();
  try {
    assert.doesNotThrow(() => {
      const hook = renderHook(() =>
        useFocusTrap({ onClose: () => {}, triggerRef: { current: null } }),
      );
      hook.unmount();
    });
  } finally {
    dom.restore();
  }
});

test('Escape invokes onClose', () => {
  const { dom, hook, closeCalls } = mountTrap();
  try {
    dom.dispatchKeyDown({ key: 'Escape' });
    assert.equal(closeCalls.length, 1);
    hook.unmount();
  } finally {
    dom.restore();
  }
});

test('keys other than Tab and Escape are ignored', () => {
  const extra = [];
  const { dom, hook, closeCalls, closeButton } = mountTrap({
    children: extra,
  });
  try {
    const focusesBefore = closeButton.focusCount;
    for (const key of ['a', 'Enter', ' ', 'ArrowDown']) {
      const { defaultPrevented } = dom.dispatchKeyDown({ key });
      assert.equal(defaultPrevented, false, `${key} should not be prevented`);
    }
    assert.equal(closeCalls.length, 0);
    assert.equal(closeButton.focusCount, focusesBefore);
    hook.unmount();
  } finally {
    dom.restore();
  }
});

test('Shift+Tab on the first focusable wraps to the last', () => {
  const dom = installFakeDom();
  try {
    const closeButton = dom.createElement('button');
    const link = dom.createElement('a', { href: '/docs' });
    const hook = renderHook(() =>
      useFocusTrap({ onClose: () => {}, triggerRef: { current: null } }),
    );
    hook.result.closeRef.current = closeButton;
    hook.result.dialogRef.current = dom.createDialog([closeButton, link]);
    hook.rerender();

    dom.setActiveElement(closeButton);
    const { defaultPrevented } = dom.dispatchKeyDown({
      key: 'Tab',
      shiftKey: true,
    });
    assert.equal(defaultPrevented, true);
    assert.equal(dom.document.activeElement, link);
    hook.unmount();
  } finally {
    dom.restore();
  }
});

test('Tab on the last focusable wraps to the first', () => {
  const dom = installFakeDom();
  try {
    const closeButton = dom.createElement('button');
    const link = dom.createElement('a', { href: '/docs' });
    const hook = renderHook(() =>
      useFocusTrap({ onClose: () => {}, triggerRef: { current: null } }),
    );
    hook.result.closeRef.current = closeButton;
    hook.result.dialogRef.current = dom.createDialog([closeButton, link]);
    hook.rerender();

    dom.setActiveElement(link);
    const { defaultPrevented } = dom.dispatchKeyDown({ key: 'Tab' });
    assert.equal(defaultPrevented, true);
    assert.equal(dom.document.activeElement, closeButton);
    hook.unmount();
  } finally {
    dom.restore();
  }
});

test('Tab in the middle of the dialog is left to the browser', () => {
  const dom = installFakeDom();
  try {
    const first = dom.createElement('button');
    const middle = dom.createElement('button');
    const last = dom.createElement('a', { href: '/docs' });
    const hook = renderHook(() =>
      useFocusTrap({ onClose: () => {}, triggerRef: { current: null } }),
    );
    hook.result.closeRef.current = first;
    hook.result.dialogRef.current = dom.createDialog([first, middle, last]);
    hook.rerender();

    dom.setActiveElement(middle);
    const forward = dom.dispatchKeyDown({ key: 'Tab' });
    assert.equal(forward.defaultPrevented, false);
    const backward = dom.dispatchKeyDown({ key: 'Tab', shiftKey: true });
    assert.equal(backward.defaultPrevented, false);
    assert.equal(dom.document.activeElement, middle);
    hook.unmount();
  } finally {
    dom.restore();
  }
});

test('a single focusable element traps Tab onto itself in both directions', () => {
  const dom = installFakeDom();
  try {
    const only = dom.createElement('button');
    const hook = renderHook(() =>
      useFocusTrap({ onClose: () => {}, triggerRef: { current: null } }),
    );
    hook.result.closeRef.current = only;
    hook.result.dialogRef.current = dom.createDialog([only]);
    hook.rerender();

    dom.setActiveElement(only);
    assert.equal(dom.dispatchKeyDown({ key: 'Tab' }).defaultPrevented, true);
    assert.equal(dom.document.activeElement, only);
    assert.equal(
      dom.dispatchKeyDown({ key: 'Tab', shiftKey: true }).defaultPrevented,
      true,
    );
    assert.equal(dom.document.activeElement, only);
    hook.unmount();
  } finally {
    dom.restore();
  }
});

test('Tab is ignored when the dialog holds no focusable elements', () => {
  const dom = installFakeDom();
  try {
    const hook = renderHook(() =>
      useFocusTrap({ onClose: () => {}, triggerRef: { current: null } }),
    );
    hook.result.dialogRef.current = dom.createDialog([]);
    hook.rerender();

    const { defaultPrevented } = dom.dispatchKeyDown({ key: 'Tab' });
    assert.equal(defaultPrevented, false);
    hook.unmount();
  } finally {
    dom.restore();
  }
});

test('Tab is ignored when the dialog ref is not attached', () => {
  const dom = installFakeDom();
  try {
    const hook = renderHook(() =>
      useFocusTrap({ onClose: () => {}, triggerRef: { current: null } }),
    );
    assert.doesNotThrow(() => dom.dispatchKeyDown({ key: 'Tab' }));
    hook.unmount();
  } finally {
    dom.restore();
  }
});

test('non-focusable descendants are excluded from the tab cycle', () => {
  const dom = installFakeDom();
  try {
    const button = dom.createElement('button');
    const anchorWithoutHref = dom.createElement('a');
    const span = dom.createElement('span');
    const link = dom.createElement('a', { href: '/docs' });
    const hook = renderHook(() =>
      useFocusTrap({ onClose: () => {}, triggerRef: { current: null } }),
    );
    hook.result.closeRef.current = button;
    hook.result.dialogRef.current = dom.createDialog([
      button,
      anchorWithoutHref,
      span,
      link,
    ]);
    hook.rerender();

    // `link` is the last *focusable* node even though `span` follows it in the
    // DOM, so Tab from it must wrap back to `button`.
    dom.setActiveElement(link);
    assert.equal(dom.dispatchKeyDown({ key: 'Tab' }).defaultPrevented, true);
    assert.equal(dom.document.activeElement, button);
    hook.unmount();
  } finally {
    dom.restore();
  }
});

test('removes its keydown listener on unmount', () => {
  const { dom, hook, closeCalls } = mountTrap();
  try {
    assert.equal(dom.keydownListenerCount(), 1);
    hook.unmount();
    assert.equal(dom.keydownListenerCount(), 0);
    dom.dispatchKeyDown({ key: 'Escape' });
    assert.equal(closeCalls.length, 0);
  } finally {
    dom.restore();
  }
});

test('restores focus to the trigger element on unmount', () => {
  const dom = installFakeDom();
  try {
    const trigger = dom.createElement('button');
    const closeButton = dom.createElement('button');
    const hook = renderHook(() =>
      useFocusTrap({ onClose: () => {}, triggerRef: { current: trigger } }),
    );
    hook.result.closeRef.current = closeButton;
    hook.rerender();

    assert.equal(dom.document.activeElement, closeButton);
    hook.unmount();
    assert.equal(dom.document.activeElement, trigger);
  } finally {
    dom.restore();
  }
});

test('falls back to the previously focused element when no trigger is set', () => {
  const dom = installFakeDom();
  try {
    const previous = dom.createElement('button');
    dom.setActiveElement(previous);
    const closeButton = dom.createElement('button');
    const hook = renderHook(() =>
      useFocusTrap({ onClose: () => {}, triggerRef: { current: null } }),
    );
    hook.result.closeRef.current = closeButton;
    hook.rerender();

    hook.unmount();
    assert.equal(dom.document.activeElement, previous);
    assert.equal(previous.focusCount, 2);
  } finally {
    dom.restore();
  }
});

test('unmount does not throw when there is nothing to restore focus to', () => {
  const dom = installFakeDom();
  try {
    const hook = renderHook(() =>
      useFocusTrap({ onClose: () => {}, triggerRef: { current: null } }),
    );
    assert.doesNotThrow(() => hook.unmount());
  } finally {
    dom.restore();
  }
});
