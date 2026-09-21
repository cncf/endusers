import React, { useMemo, useState } from 'react';
import membersData from '@site/data/members.json';
import { useFilterOptions } from './hooks';
import { MemberCard } from './MemberCard';
import styles from './styles.module.css';

export default function MemberDirectory() {
  const { members } = membersData;
  const { industries, projects } = useFilterOptions(members);

  const [query, setQuery] = useState('');
  const [industry, setIndustry] = useState('');
  const [project, setProject] = useState('');
  const [hasArchitecture, setHasArchitecture] = useState(false);
  const [hasAward, setHasAward] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return members.filter((member) => {
      if (
        normalizedQuery &&
        !member.name.toLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }
      if (industry && !member.industries.includes(industry)) {
        return false;
      }
      if (project && !member.projects.includes(project)) {
        return false;
      }
      if (hasArchitecture && member.architectures.length === 0) {
        return false;
      }
      if (hasAward && member.awards.length === 0) {
        return false;
      }
      return true;
    });
  }, [members, normalizedQuery, industry, project, hasArchitecture, hasAward]);

  const clearFilters = () => {
    setQuery('');
    setIndustry('');
    setProject('');
    setHasArchitecture(false);
    setHasAward(false);
  };

  const activeFiltersCount = [
    normalizedQuery,
    industry,
    project,
    hasArchitecture,
    hasAward,
  ].filter(Boolean).length;

  return (
    <section aria-label="End User Community member directory">
      <div className={styles.toolbar}>
        <div className={styles.searchRow}>
          <label htmlFor="member-search" className={styles.visuallyHidden}>
            Search members by name
          </label>
          <input
            id="member-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search members by name"
            className={styles.searchInput}
          />
        </div>
        <div className={styles.filtersRow}>
          <div className={styles.filter}>
            <label htmlFor="member-industry" className={styles.visuallyHidden}>
              Filter by industry
            </label>
            <select
              id="member-industry"
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
              className={styles.select}
            >
              <option value="">All industries</option>
              {industries.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filter}>
            <label htmlFor="member-project" className={styles.visuallyHidden}>
              Filter by CNCF project
            </label>
            <select
              id="member-project"
              value={project}
              onChange={(event) => setProject(event.target.value)}
              className={styles.select}
            >
              <option value="">All projects</option>
              {projects.map((proj) => (
                <option key={proj} value={proj}>
                  {proj}
                </option>
              ))}
            </select>
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={hasArchitecture}
              onChange={(event) => setHasArchitecture(event.target.checked)}
            />
            <span>Has architecture</span>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={hasAward}
              onChange={(event) => setHasAward(event.target.checked)}
            />
            <span>Has award</span>
          </label>
        </div>
        <div className={styles.resultsBar}>
          <p aria-live="polite">
            Showing <strong>{filtered.length}</strong> of {members.length}{' '}
            members
          </p>
          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className={styles.clearButton}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No members match</h3>
          <p>
            Try clearing filters or searching for a different organization name.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className={styles.clearButton}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ul className={styles.grid}>
          {filtered.map((member) => (
            <li key={member.id} className={styles.listItem}>
              <MemberCard member={member} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
