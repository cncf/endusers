import React, { useMemo } from 'react';
import { useFilterToolbar } from '../shared/useFilterToolbar';
import styles from './styles.module.css';

const DEFAULT_FILTERS = {
  query: '',
  industry: '',
  project: '',
  organization: '',
};

export function useArchitectureFilterOptions(architectures) {
  return useMemo(() => {
    const industries = new Set();
    const projects = new Set();
    const organizations = new Set();
    for (const architecture of architectures) {
      organizations.add(architecture.organization);
      architecture.industries.forEach((i) => industries.add(i));
      architecture.projects.forEach((p) => projects.add(p));
    }
    return {
      industries: Array.from(industries).sort(),
      projects: Array.from(projects).sort(),
      organizations: Array.from(organizations).sort(),
    };
  }, [architectures]);
}

export function filterArchitectures(architectures, filters) {
  const { query, industry, project, organization } = filters;
  const normalizedQuery = query.trim().toLowerCase();
  return architectures.filter((architecture) => {
    if (normalizedQuery) {
      const searchable =
        `${architecture.organization} ${architecture.title} ${architecture.summary}`.toLowerCase();
      if (!searchable.includes(normalizedQuery)) {
        return false;
      }
    }
    if (industry && !architecture.industries.includes(industry)) {
      return false;
    }
    if (project && !architecture.projects.includes(project)) {
      return false;
    }
    if (organization && architecture.organization !== organization) {
      return false;
    }
    return true;
  });
}

export function useArchitectureFilters(architectures) {
  const options = useArchitectureFilterOptions(architectures);
  const { filters, setFilter, filtered, clearFilters, activeCount } =
    useFilterToolbar(architectures, DEFAULT_FILTERS, filterArchitectures);

  return {
    options,
    filters,
    setQuery: (value) => setFilter('query', value),
    setIndustry: (value) => setFilter('industry', value),
    setProject: (value) => setFilter('project', value),
    setOrganization: (value) => setFilter('organization', value),
    filtered,
    clearFilters,
    activeCount,
  };
}

export default function ArchitectureFilters({
  options,
  filters,
  setQuery,
  setIndustry,
  setProject,
  setOrganization,
  activeCount,
  onClear,
  resultCount,
  totalCount,
}) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.searchRow}>
        <label htmlFor="architecture-search" className={styles.visuallyHidden}>
          Search architectures by organization or title
        </label>
        <input
          id="architecture-search"
          type="search"
          value={filters.query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search architectures by organization or title"
          className={styles.searchInput}
        />
      </div>
      <div className={styles.filtersRow}>
        <div className={styles.filter}>
          <label
            htmlFor="architecture-organization"
            className={styles.visuallyHidden}
          >
            Filter by organization
          </label>
          <select
            id="architecture-organization"
            value={filters.organization}
            onChange={(event) => setOrganization(event.target.value)}
            className={styles.select}
          >
            <option value="">All organizations</option>
            {options.organizations.map((org) => (
              <option key={org} value={org}>
                {org}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filter}>
          <label
            htmlFor="architecture-industry"
            className={styles.visuallyHidden}
          >
            Filter by industry
          </label>
          <select
            id="architecture-industry"
            value={filters.industry}
            onChange={(event) => setIndustry(event.target.value)}
            className={styles.select}
          >
            <option value="">All industries</option>
            {options.industries.map((ind) => (
              <option key={ind} value={ind}>
                {ind}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filter}>
          <label
            htmlFor="architecture-project"
            className={styles.visuallyHidden}
          >
            Filter by CNCF project
          </label>
          <select
            id="architecture-project"
            value={filters.project}
            onChange={(event) => setProject(event.target.value)}
            className={styles.select}
          >
            <option value="">All projects</option>
            {options.projects.map((proj) => (
              <option key={proj} value={proj}>
                {proj}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={styles.resultsBar}>
        <p aria-live="polite">
          Showing <strong>{resultCount}</strong> of {totalCount} architectures
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
