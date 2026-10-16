import React from 'react';
import membersData from '@site/data/members.json';
import { useFilterOptions } from './hooks';
import { matchesMembership } from './utils';
import { MemberCard } from './MemberCard';
import { DirectoryFreshness } from './DirectoryFreshness';
import { useFilterToolbar } from '../shared/useFilterToolbar';
import styles from './styles.module.css';

const DEFAULT_FILTERS = {
  query: '',
  industry: '',
  project: '',
  membership: '',
  hasArchitecture: false,
  hasAward: false,
};

function filterMembers(members, filters) {
  const { query, industry, project, membership, hasArchitecture, hasAward } =
    filters;
  const normalizedQuery = query.trim().toLowerCase();
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
    if (!matchesMembership(member.membershipStatus, membership)) {
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
}

export default function MemberDirectory() {
  const { members } = membersData;
  const { industries, projects, membershipStatuses } =
    useFilterOptions(members);

  const { filters, setFilter, filtered, clearFilters, activeCount } =
    useFilterToolbar(members, DEFAULT_FILTERS, filterMembers);
  const { query, industry, project, membership, hasArchitecture, hasAward } =
    filters;
  const activeFiltersCount = activeCount;

  return (
    <section aria-label="End User Community organization directory">
      <DirectoryFreshness />
      <div className={styles.toolbar}>
        <div className={styles.searchRow}>
          <label htmlFor="member-search" className={styles.visuallyHidden}>
            Search organizations by name
          </label>
          <input
            id="member-search"
            type="search"
            value={query}
            onChange={(event) => setFilter('query', event.target.value)}
            placeholder="Search organizations by name"
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
              onChange={(event) => setFilter('industry', event.target.value)}
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
            <label
              htmlFor="member-membership"
              className={styles.visuallyHidden}
            >
              Filter by membership status
            </label>
            <select
              id="member-membership"
              value={membership}
              onChange={(event) => setFilter('membership', event.target.value)}
              className={styles.select}
            >
              <option value="">All organizations</option>
              {membershipStatuses.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
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
              onChange={(event) => setFilter('project', event.target.value)}
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
              onChange={(event) =>
                setFilter('hasArchitecture', event.target.checked)
              }
            />
            <span>Has architecture</span>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={hasAward}
              onChange={(event) => setFilter('hasAward', event.target.checked)}
            />
            <span>Has award</span>
          </label>
        </div>
        <div className={styles.resultsBar}>
          <p aria-live="polite">
            Showing <strong>{filtered.length}</strong> of {members.length}{' '}
            organizations
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
          <h3>No organizations match</h3>
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
