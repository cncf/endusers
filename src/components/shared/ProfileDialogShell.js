import React from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import styles from './ProfileDialogShell.module.css';

/**
 * Shared profile-dialog modal shell (backdrop + focus-trapped dialog +
 * close button), used by every component in the repo that renders an
 * `aria-modal` profile popup (`CommunityPeople`'s `PersonDialog` and
 * `MemberDirectory`'s `MemberProfile`). Each caller keeps its own hero/body
 * content, labelledby id, and close-button label; this component only
 * generalizes the shell's markup and CSS, which was previously hand-copied
 * into two near-identical JSX trees and CSS modules -- the same shape of
 * duplication already extracted once for `FilterToolbar` (#1658/#1659).
 *
 * Rendered as a JSX element (`<ProfileDialogShell ... />`) by every caller,
 * per the shared-component rule in .agents/skills/ui-standards/SKILL.md. It
 * calls `useFocusTrap`, so render tests expand it with `renderElement()` while
 * their hook dispatcher is installed rather than through `walkElements`'s
 * hook-free `expand` option.
 *
 * This module also exports `ProfileHero`, `ProfileKicker`, and `ProfileBody`:
 * the hero row, kicker label, and body wrapper were hand-copied (CSS and
 * JSX) between the same two callers after the shell itself was extracted;
 * these three plain wrapper components carry the shared rules so neither
 * caller's own stylesheet needs to redeclare them.
 *
 * @param {object} props
 * @param {() => void} props.onClose
 * @param {React.RefObject} props.triggerRef focus returns here on close
 * @param {string} props.labelledBy id of the element naming the dialog
 * @param {string} props.closeLabel accessible name for the close button
 * @param {string} [props.maxWidth] CSS value for the dialog's max-width;
 *   defaults to the shared 680px used by the original single-dialog layout
 * @param {string} [props.maxHeight] CSS value for the dialog's max-height;
 *   defaults to the shared `min(720px, 92vh)`
 * @param {React.ReactNode} props.children hero/body content
 */
export default function ProfileDialogShell({
  onClose,
  triggerRef,
  labelledBy,
  closeLabel,
  maxWidth,
  maxHeight,
  children,
}) {
  const { dialogRef, closeRef } = useFocusTrap({ onClose, triggerRef });

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{
          ...(maxWidth && { '--profile-dialog-max-width': maxWidth }),
          ...(maxHeight && { '--profile-dialog-max-height': maxHeight }),
        }}
      >
        <button
          ref={closeRef}
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label={closeLabel}
        >
          <span aria-hidden="true">×</span>
        </button>
        {children}
      </section>
    </div>
  );
}

/**
 * Shared hero row (avatar/logo area + heading block) for a profile dialog's
 * content, used by both `CommunityPeople`'s `PersonDialog` and
 * `MemberDirectory`'s `MemberProfile`. Each caller still renders its own
 * avatar/logo markup and heading level (`h3` vs `h2`) as `children`; only the
 * byte-identical `.profileHero` wrapper rule is shared here.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export function ProfileHero({ children }) {
  return <div className={styles.profileHero}>{children}</div>;
}

/**
 * Shared uppercase kicker label shown above a profile dialog's heading.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export function ProfileKicker({ children }) {
  return <p className={styles.profileKicker}>{children}</p>;
}

/**
 * Shared body wrapper (padding only) for a profile dialog's content below
 * the hero row.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export function ProfileBody({ children }) {
  return <div className={styles.profileBody}>{children}</div>;
}
