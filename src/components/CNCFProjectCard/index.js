import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './styles.module.css';

export default function CNCFProjectCard({
  name,
  logo,
  href,
  since,
  version,
  description,
}) {
  const logoUrl = useBaseUrl(logo || '');
  return (
    <a className={styles.card} href={href} target="_blank" rel="noreferrer">
      <div className={styles.header}>
        <span className={styles.logoBox}>
          {logo ? (
            <img src={logoUrl} alt="" />
          ) : (
            <span className={styles.fallback}>{name.slice(0, 1)}</span>
          )}
        </span>
        <span className={styles.name}>{name}</span>
        <span className={styles.arrow} aria-hidden="true">
          ↗
        </span>
      </div>
      {(since || version) && (
        <div className={styles.meta}>
          {since && <span>Since {since}</span>}
          {version && <span>{version}</span>}
        </div>
      )}
      {description && <p className={styles.description}>{description}</p>}
    </a>
  );
}
