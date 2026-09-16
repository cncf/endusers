import { useEffect, useRef } from 'react';

/**
 * Manages focus trapping for accessible modal dialogs.
 *
 * Locks body scroll, moves focus to the close button on mount, handles
 * Tab/Shift-Tab cycling within the dialog, closes on Escape, and
 * restores focus to the trigger element on unmount.
 *
 * Mount this hook only when the dialog is visible — the effect fires
 * immediately on mount and cleans up on unmount.
 *
 * @param {object}   params
 * @param {Function} params.onClose     - Callback invoked when Escape is pressed
 * @param {object}   params.triggerRef  - Ref to the element that opened the dialog
 * @returns {{ dialogRef: object, closeRef: object }}
 */
export function useFocusTrap({ onClose, triggerRef }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll('button, a[href]');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      (triggerRef.current || previousFocus)?.focus?.();
    };
  }, [onClose, triggerRef]);

  return { dialogRef, closeRef };
}
