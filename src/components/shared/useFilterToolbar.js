import { useMemo, useState } from 'react';

// Whether a single filter field counts toward the toolbar's "active filters"
// badge and the "Clear filters" escape hatch. String fields (search boxes,
// <select> values) are active once trimmed non-empty; everything else
// (checkbox toggles) is active when truthy.
function isActiveFilterValue(value) {
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}

/**
 * Owns the state shared by every search-box + multi-select filter toolbar in
 * this repository (CaseStudies, MemberDirectory, ArchitectureFilters): one
 * value per filter field, the derived "how many filters are active" count,
 * a `clearFilters` that resets every field, and the filtered item list.
 *
 * Each caller keeps its own filter predicate and presentational JSX; this
 * hook only generalizes the state shape and the active/clear bookkeeping
 * that was previously hand-duplicated in each component.
 *
 * @param {Array} items the unfiltered item list
 * @param {object} initialFilters default value for every filter field
 * @param {Function} filterItems `(items, filters) => Array`
 */
export function useFilterToolbar(items, initialFilters, filterItems) {
  const [filters, setFilters] = useState(initialFilters);

  const setFilter = (key, value) =>
    setFilters((previous) => ({ ...previous, [key]: value }));

  const clearFilters = () => setFilters(initialFilters);

  const filtered = useMemo(
    () => filterItems(items, filters),
    [items, filters, filterItems],
  );

  const activeCount = useMemo(
    () => Object.values(filters).filter(isActiveFilterValue).length,
    [filters],
  );

  return { filters, setFilter, filtered, clearFilters, activeCount };
}
