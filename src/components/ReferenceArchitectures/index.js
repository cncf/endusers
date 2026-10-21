import React from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import catalog from '@site/data/architectures/catalog.json';
import ArchitectureFilters, {
  useArchitectureFilters,
} from '@site/src/components/ArchitectureFilters';
import { initials } from '../shared/initials';
import EmptyFilterState from '../shared/EmptyFilterState';
import styles from './styles.module.css';

function ArchitectureCard({ architecture }) {
  const { organization, title, summary, industries, projects, id } =
    architecture;
  const logoAsset = architecture.assets?.find((asset) =>
    /logo|wordmark/i.test(asset),
  );
  const logoUrl = useBaseUrl(logoAsset || '');
  return (
    <Link to={`/architectures/${id}`} className={styles.card}>
      <div className={styles.logoWrapper} aria-hidden="true">
        {logoAsset ? (
          <img src={logoUrl} alt="" className={styles.logo} />
        ) : (
          <span className={styles.initials}>{initials(organization)}</span>
        )}
      </div>
      <div className={styles.cardContent}>
        <p className={styles.eyebrow}>
          {industries.join(' · ') || 'Reference architecture'}
        </p>
        <h2 className={styles.orgName}>{organization}</h2>
        <p className={styles.title}>{title}</p>
        <p className={styles.summary}>{summary}</p>
        <div className={styles.projectsList}>
          {projects.slice(0, 4).map((project) => (
            <span key={project} className={styles.projectTag}>
              {project}
            </span>
          ))}
        </div>
        <span className={styles.link}>View architecture →</span>
      </div>
    </Link>
  );
}

export default function ReferenceArchitectures() {
  const {
    options,
    filters,
    setQuery,
    setIndustry,
    setProject,
    setOrganization,
    filtered,
    clearFilters,
    activeCount,
  } = useArchitectureFilters(catalog);

  return (
    <section aria-label="Reference architecture catalog">
      <p className={styles.catalogMeta}>
        {catalog.length} real-world architecture reports from CNCF end users.
      </p>
      <ArchitectureFilters
        options={options}
        filters={filters}
        setQuery={setQuery}
        setIndustry={setIndustry}
        setProject={setProject}
        setOrganization={setOrganization}
        activeCount={activeCount}
        onClear={clearFilters}
        resultCount={filtered.length}
        totalCount={catalog.length}
      />
      {filtered.length === 0 ? (
        <EmptyFilterState
          heading="No architectures match"
          onClear={clearFilters}
        >
          Try clearing filters or searching for a different organization or
          title.
        </EmptyFilterState>
      ) : (
        <div className={styles.grid}>
          {filtered.map((architecture) => (
            <ArchitectureCard
              key={architecture.id}
              architecture={architecture}
            />
          ))}
        </div>
      )}
    </section>
  );
}
