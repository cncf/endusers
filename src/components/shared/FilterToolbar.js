import styles from './FilterToolbar.module.css';

/**
 * Shared search-box + multi-select filter toolbar markup, used by every
 * catalog page that filters a list client-side (CaseStudies,
 * ArchitectureFilters, MemberDirectory). Each caller keeps its own filter
 * predicate and option lists (via `useFilterToolbar`); this component only
 * generalizes the toolbar's presentation, which was previously hand-copied
 * into three near-identical JSX trees and CSS modules.
 *
 * Rendered as a JSX element (`<FilterToolbar ... />`) by every caller, like
 * any other component. The repository's hook-free render tests walk the
 * returned element tree without invoking nested function components, so a
 * test that asserts on this toolbar's markup expands it through
 * tests/tools/react-element-tree.mjs (the `expand` option on
 * `walkElements`/`findAllByType`/`findByType`, or `renderElement()`).
 *
 * @param {object} props
 * @param {string} props.searchId
 * @param {string} props.searchLabel accessible name for the search input
 * @param {string} props.searchValue
 * @param {string} props.searchPlaceholder
 * @param {(value: string) => void} props.onSearchChange
 * @param {{values: string[], listLabel: string,
 *   removeLabel: (value: string) => string,
 *   onRemove: (value: string) => void}} [props.searchChips] selected values
 *   shown as removable chips inside the search box; Backspace in an empty
 *   search box removes the last one
 * @param {Array<{id: string, label: string, value: string,
 *   onChange: (value: string) => void,
 *   options: Array<string|{value: string, label: string}>,
 *   allLabel?: string}>} props.selects one entry per `<select>`; omit
 *   `allLabel` for a control with no empty "All" choice, such as a sort order
 * @param {React.ReactNode} [props.extra] additional controls rendered after
 *   the selects (e.g. checkbox toggles), in the same `filtersRow`
 * @param {number} props.resultCount
 * @param {number} props.totalCount
 * @param {string} props.resultNoun plural noun for the result count, e.g.
 *   "case studies"
 * @param {number} props.activeCount
 * @param {() => void} props.onClear
 */
export default function FilterToolbar({
  searchId,
  searchLabel,
  searchValue,
  searchPlaceholder,
  onSearchChange,
  searchChips,
  selects,
  extra,
  resultCount,
  totalCount,
  resultNoun,
  activeCount,
  onClear,
}) {
  const input = (
    <input
      id={searchId}
      type="search"
      value={searchValue}
      onChange={(event) => onSearchChange(event.target.value)}
      onKeyDown={
        searchChips &&
        ((event) => {
          const last = searchChips.values.at(-1);
          if (event.key === 'Backspace' && searchValue === '' && last) {
            searchChips.onRemove(last);
          }
        })
      }
      placeholder={searchPlaceholder}
      className={searchChips ? styles.chipInput : styles.searchInput}
    />
  );
  return (
    <div className={styles.toolbar}>
      <div className={styles.searchRow}>
        <label htmlFor={searchId} className={styles.visuallyHidden}>
          {searchLabel}
        </label>
        {searchChips ? (
          <div className={styles.chipField}>
            {searchChips.values.length > 0 && (
              <ul
                className={styles.chipList}
                aria-label={searchChips.listLabel}
              >
                {searchChips.values.map((value) => (
                  <li key={value} className={styles.chip}>
                    {value}
                    <button
                      type="button"
                      className={styles.chipRemove}
                      aria-label={searchChips.removeLabel(value)}
                      onClick={(event) => {
                        searchChips.onRemove(value);
                        // The button unmounts with its chip; keep focus in
                        // the search box rather than dropping it to <body>.
                        event.currentTarget.ownerDocument
                          .getElementById(searchId)
                          ?.focus();
                      }}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {input}
          </div>
        ) : (
          input
        )}
      </div>
      <div className={styles.filtersRow}>
        {selects.map(({ id, label, value, onChange, options, allLabel }) => (
          <div className={styles.filter} key={id}>
            <label htmlFor={id} className={styles.visuallyHidden}>
              {label}
            </label>
            <select
              id={id}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              className={styles.select}
            >
              {allLabel !== undefined && <option value="">{allLabel}</option>}
              {options.map((option) => {
                const optionValue =
                  typeof option === 'string' ? option : option.value;
                const optionLabel =
                  typeof option === 'string' ? option : option.label;
                return (
                  <option key={optionValue} value={optionValue}>
                    {optionLabel}
                  </option>
                );
              })}
            </select>
          </div>
        ))}
        {extra}
      </div>
      <div className={styles.resultsBar}>
        <p aria-live="polite">
          {'Showing '}
          <strong>{resultCount}</strong>
          {` of ${totalCount} ${resultNoun}`}
        </p>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className={styles.clearButton}
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
