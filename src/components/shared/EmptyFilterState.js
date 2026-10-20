import React from 'react';
import styles from './EmptyFilterState.module.css';

/**
 * Shared "no results" block rendered in place of a catalog's result grid
 * when the active filters match nothing: a heading, a line of explanatory
 * copy, and a "Clear filters" button. Used by every catalog page that can
 * filter itself into an empty result set (MemberDirectory,
 * ReferenceArchitectures) -- previously hand-copied as an identical
 * `.emptyState`/`.clearButton` JSX tree and CSS pair into each.
 *
 * Called directly as a plain function (not as a JSX element), matching the
 * FilterToolbar/ProfileDialogShell convention, so its output expands inline
 * into the caller's own render for the hook-free render tests.
 *
 * @param {object} props
 * @param {string} props.heading
 * @param {React.ReactNode} props.children explanatory copy rendered in a <p>
 * @param {() => void} props.onClear
 * @param {string} [props.clearLabel]
 */
export default function EmptyFilterState({
  heading,
  children,
  onClear,
  clearLabel = 'Clear filters',
}) {
  return (
    <div className={styles.emptyState}>
      <h3>{heading}</h3>
      <p>{children}</p>
      <button type="button" onClick={onClear} className={styles.clearButton}>
        {clearLabel}
      </button>
    </div>
  );
}
