import styles from './EmptyFilterState.module.css';

/**
 * Shared "no results" block rendered in place of a catalog's result grid
 * when the active filters match nothing: a heading, a line of explanatory
 * copy, and a "Clear filters" button. Used by every catalog page that can
 * filter itself into an empty result set (MemberDirectory,
 * ReferenceArchitectures) -- previously hand-copied as an identical
 * `.emptyState`/`.clearButton` JSX tree and CSS pair into each. The button's
 * style now composes `.clearButton` from
 * `./FilterToolbar.module.css` (`composes: clearButton from
 * './FilterToolbar.module.css'`) rather than carrying its own identical
 * copy of the rule.
 *
 * Rendered as a JSX element (`<EmptyFilterState ... />`) by every caller,
 * per the shared-component rule in .agents/skills/ui-standards/SKILL.md. It
 * is hook-free, so render tests reach its markup through the harness's
 * `expand` option.
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
