import React from 'react';
import styles from './FreshnessNote.module.css';

/**
 * Shared "data last refreshed/synced" note styling (color + size), used by
 * every component that surfaces a freshness or drift signal next to data
 * sourced from `/data/` (DirectoryFreshness, PeopleFreshness,
 * GroupLinkStatus). Each caller keeps its own wording, root tag, and layout
 * margin; this only generalizes the `.freshnessNote` CSS rule that was
 * previously hand-copied, byte-for-byte in two of the three callers, into
 * three separate CSS modules.
 *
 * Called directly as a plain function (not as a JSX element), matching
 * ../shared/FilterToolbar.js: the repository's hook-free render tests walk
 * the element tree a component returns without invoking nested function
 * components, and at least one caller (PeopleFreshness) is pinned to return a
 * literal 'p' element from its own call, not a wrapped component reference.
 *
 * @param {object} props
 * @param {'p'|'div'} [props.as] - root tag, default 'p'
 * @param {string} [props.className] - additional class (e.g. a margin
 *   override kept in the caller's own CSS module)
 * @param {React.ReactNode} props.children
 */
export function FreshnessNote({ as: Tag = 'p', className, children }) {
  return (
    <Tag
      className={
        className
          ? `${styles.freshnessNote} ${className}`
          : styles.freshnessNote
      }
    >
      {children}
    </Tag>
  );
}
