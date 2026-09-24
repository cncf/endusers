import React, { useMemo, useState } from 'react';
import data from '@site/data/case-studies.json';
import styles from './styles.module.css';

function useCaseStudyFilterOptions(caseStudies) {
  return useMemo(() => {
    const projects = new Set();
    const industries = new Set();
    const countries = new Set();
    for (const study of caseStudies) {
      study.projects.forEach((p) => projects.add(p));
      study.industries.forEach((i) => industries.add(i));
      study.countries.forEach((c) => countries.add(c));
    }
    return {
      projects: Array.from(projects).sort(),
      industries: Array.from(industries).sort(),
      countries: Array.from(countries).sort(),
    };
  }, [caseStudies]);
}

function sortByPublishedAtDesc(caseStudies) {
  return [...caseStudies].sort((a, b) =>
    (b.publishedAt || '').localeCompare(a.publishedAt || ''),
  );
}

function filterCaseStudies(caseStudies, { query, project, industry, country }) {
  const normalizedQuery = query.trim().toLowerCase();
  return caseStudies.filter((study) => {
    if (
      normalizedQuery &&
      !study.organization.toLowerCase().includes(normalizedQuery)
    ) {
      return false;
    }
    if (project && !study.projects.includes(project)) return false;
    if (industry && !study.industries.includes(industry)) return false;
    if (country && !study.countries.includes(country)) return false;
    return true;
  });
}

function SyncStatus() {
  if (!data.generatedAt) return null;
  const syncDate = new Date(data.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return (
    <p className={styles.syncStatus}>
      Mirrored from{' '}
      <a href={data.sourceUrl} target="_blank" rel="noreferrer">
        cncf.io/case-studies
      </a>{' '}
      on {syncDate}.
    </p>
  );
}

export default function CaseStudies() {
  const caseStudies = data.caseStudies || [];
  const options = useCaseStudyFilterOptions(caseStudies);
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('');
  const [industry, setIndustry] = useState('');
  const [country, setCountry] = useState('');

  const filters = { query, project, industry, country };
  const filtered = useMemo(
    () => filterCaseStudies(sortByPublishedAtDesc(caseStudies), filters),
    [caseStudies, query, project, industry, country],
  );
  const activeCount = [query.trim(), project, industry, country].filter(
    Boolean,
  ).length;
  const clearFilters = () => {
    setQuery('');
    setProject('');
    setIndustry('');
    setCountry('');
  };

  return (
    <section aria-label="CNCF case studies">
      <SyncStatus />
      <div className={styles.toolbar}>
        <label htmlFor="case-study-search" className={styles.visuallyHidden}>
          Search case studies by organization
        </label>
        <input
          id="case-study-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by organization"
          className={styles.searchInput}
        />
        <div className={styles.filtersRow}>
          <div className={styles.filter}>
            <label
              htmlFor="case-study-project"
              className={styles.visuallyHidden}
            >
              Filter by CNCF project
            </label>
            <select
              id="case-study-project"
              value={project}
              onChange={(event) => setProject(event.target.value)}
              className={styles.select}
            >
              <option value="">All projects</option>
              {options.projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filter}>
            <label
              htmlFor="case-study-industry"
              className={styles.visuallyHidden}
            >
              Filter by industry
            </label>
            <select
              id="case-study-industry"
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
              className={styles.select}
            >
              <option value="">All industries</option>
              {options.industries.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filter}>
            <label
              htmlFor="case-study-country"
              className={styles.visuallyHidden}
            >
              Filter by country
            </label>
            <select
              id="case-study-country"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              className={styles.select}
            >
              <option value="">All countries</option>
              {options.countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.resultsBar}>
          <p aria-live="polite">
            Showing <strong>{filtered.length}</strong> of {caseStudies.length}{' '}
            case studies
          </p>
          {activeCount > 0 && (
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
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Organization</th>
              <th scope="col">Date</th>
              <th scope="col">Projects</th>
              <th scope="col">Industry</th>
              <th scope="col">Country</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((study) => (
              <tr key={study.id}>
                <th scope="row" className={styles.title}>
                  <a href={study.url} target="_blank" rel="noreferrer">
                    {study.title}
                  </a>
                </th>
                <td>{study.organization}</td>
                <td>
                  {study.publishedAt &&
                    new Date(study.publishedAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                </td>
                <td>{study.projects.join(', ')}</td>
                <td>{study.industries.join(', ')}</td>
                <td>{study.countries.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <p className={styles.emptyState}>
            No case studies match those filters.
          </p>
        )}
      </div>
    </section>
  );
}
