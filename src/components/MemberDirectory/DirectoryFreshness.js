import React from 'react';
import metrics from '@site/data/metrics.json';
import awardsData from '@site/data/awards.json';
import membersData from '@site/data/members.json';
import { formatDate } from './utils';
import styles from './styles.module.css';

// Member profiles are compiled from the pinned landscape snapshot, reference
// architecture submissions, and award announcements (see
// scripts/generate-members.mjs). The landscape timestamp comes from the
// committed snapshot; architecture and award dates retain their existing
// source-specific freshness signals.
export function DirectoryFreshness() {
  const architectures = metrics?.sources?.architectures;
  const landscape = membersData?.sources?.landscape;
  const architecturesDate = formatDate(metrics?.generatedAt);
  const landscapeDate = formatDate(landscape?.collectedAt);
  const awardsDate = formatDate(awardsData?.verifiedAt);
  if (!landscapeDate && !architecturesDate && !awardsDate) return null;
  return (
    <p className={styles.freshnessNote}>
      {landscapeDate && (
        <>
          Directory membership data last synced from{' '}
          {landscape?.sourceUrl ? (
            <a href={landscape.sourceUrl} target="_blank" rel="noreferrer">
              cncf/landscape
            </a>
          ) : (
            'cncf/landscape'
          )}{' '}
          on {landscapeDate}.
        </>
      )}
      {landscapeDate && architecturesDate && ' '}
      {architecturesDate && (
        <>
          Architecture-derived profiles last synced from{' '}
          {architectures?.repository ? (
            <a href={architectures.repository} target="_blank" rel="noreferrer">
              cncf/architecture
            </a>
          ) : (
            'cncf/architecture'
          )}{' '}
          on {architecturesDate}.
        </>
      )}
      {(landscapeDate || architecturesDate) && awardsDate && ' '}
      {awardsDate && <>Award data last verified on {awardsDate}.</>}
    </p>
  );
}
