import React from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import catalog from '@site/data/architectures/catalog.json';
import metrics from '@site/data/metrics.json';
import ArchitectureFilters, {
  useArchitectureFilters,
} from '@site/src/components/ArchitectureFilters';
import styles from './styles.module.css';

function SyncStatus() {
  const architectures = metrics?.sources?.architectures;
  if (!architectures?.revision) return null;
  const shortRevision = architectures.revision.slice(0, 7);
  const commitUrl = `${architectures.repository}/commit/${architectures.revision}`;
  const syncDate = metrics.generatedAt
    ? new Date(metrics.generatedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;
  return (
    <p className={styles.syncStatus}>
      Last synced from{' '}
      <a href={architectures.repository} target="_blank" rel="noreferrer">
        cncf/architecture
      </a>{' '}
      @{' '}
      <a href={commitUrl} target="_blank" rel="noreferrer">
        <code>{shortRevision}</code>
      </a>
      {syncDate ? ` on ${syncDate}` : ''}.
    </p>
  );
}

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

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
      <SyncStatus />
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
        <div className={styles.emptyState}>
          <h3>No architectures match</h3>
          <p>
            Try clearing filters or searching for a different organization or
            title.
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
