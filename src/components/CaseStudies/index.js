import { useMemo } from 'react';
import data from '@site/data/case-studies.json';
import MirrorSyncStatus from '../shared/MirrorSyncStatus';
import { formatDate } from '../shared/formatDate';
import { useFilterToolbar } from '../shared/useFilterToolbar';
import FilterToolbar from '../shared/FilterToolbar';
import { compareLabels } from '../shared/compareLabels';
import styles from './styles.module.css';

const DEFAULT_FILTERS = { query: '', project: '', industry: '', country: '' };

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
      projects: Array.from(projects).sort(compareLabels),
      industries: Array.from(industries).sort(compareLabels),
      countries: Array.from(countries).sort(compareLabels),
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

export default function CaseStudies() {
  const caseStudies = data.caseStudies || [];
  const options = useCaseStudyFilterOptions(caseStudies);
  const { filters, setFilter, filtered, clearFilters, activeCount } =
    useFilterToolbar(caseStudies, DEFAULT_FILTERS, (studies, currentFilters) =>
      filterCaseStudies(sortByPublishedAtDesc(studies), currentFilters),
    );
  const { query, project, industry, country } = filters;

  return (
    <section aria-label="CNCF case studies">
      <MirrorSyncStatus
        generatedAt={data.generatedAt}
        sourceUrl={data.sourceUrl}
        label="cncf.io/case-studies"
        className={styles.syncStatus}
      />
      <FilterToolbar
        searchId="case-study-search"
        searchLabel="Search case studies by organization"
        searchValue={query}
        searchPlaceholder="Search by organization"
        onSearchChange={(value) => setFilter('query', value)}
        selects={[
          {
            id: 'case-study-project',
            label: 'Filter by CNCF project',
            value: project,
            onChange: (value) => setFilter('project', value),
            options: options.projects,
            allLabel: 'All projects',
          },
          {
            id: 'case-study-industry',
            label: 'Filter by industry',
            value: industry,
            onChange: (value) => setFilter('industry', value),
            options: options.industries,
            allLabel: 'All industries',
          },
          {
            id: 'case-study-country',
            label: 'Filter by country',
            value: country,
            onChange: (value) => setFilter('country', value),
            options: options.countries,
            allLabel: 'All countries',
          },
        ]}
        resultCount={filtered.length}
        totalCount={caseStudies.length}
        resultNoun="case studies"
        activeCount={activeCount}
        onClear={clearFilters}
      />
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
                <td>{study.publishedAt && formatDate(study.publishedAt)}</td>
                <td className={styles.projects}>{study.projects.join(', ')}</td>
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
