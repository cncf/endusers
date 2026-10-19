import React from 'react';
import styles from './FilterToolbar.module.css';

/**
 * Shared search-box + multi-select filter toolbar markup, used by every
 * catalog page that filters a list client-side (CaseStudies,
 * ArchitectureFilters, MemberDirectory). Each caller keeps its own filter
 * predicate and option lists (via `useFilterToolbar`); this component only
 * generalizes the toolbar's presentation, which was previously hand-copied
 * into three near-identical JSX trees and CSS modules.
 *
 * Called directly as a plain function (not as a JSX element) by every
 * caller so its output expands inline into the caller's own render -- the
 * repository's hook-free render tests walk the returned element tree without
 * invoking nested function components, and real React renders a function
 * component identically either way.
 *
 * @param {object} props
 * @param {string} props.searchId
 * @param {string} props.searchLabel accessible name for the search input
 * @param {string} props.searchValue
 * @param {string} props.searchPlaceholder
 * @param {(value: string) => void} props.onSearchChange
 * @param {Array<{id: string, label: string, value: string,
 *   onChange: (value: string) => void,
 *   options: Array<string|{value: string, label: string}>,
 *   allLabel: string}>} props.selects one entry per `<select>` filter
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
  selects,
  extra,
  resultCount,
  totalCount,
  resultNoun,
  activeCount,
  onClear,
}) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.searchRow}>
        <label htmlFor={searchId} className={styles.visuallyHidden}>
          {searchLabel}
        </label>
        <input
          id={searchId}
          type="search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className={styles.searchInput}
        />
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
              <option value="">{allLabel}</option>
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
