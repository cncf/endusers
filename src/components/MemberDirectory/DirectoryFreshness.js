import React from 'react';
import metrics from '@site/data/metrics.json';
import awardsData from '@site/data/awards.json';
import { formatDate } from './utils';
import styles from './styles.module.css';

// Member profiles are compiled from reference architecture submissions and
// award announcements (see scripts/generate-members.mjs); data/members.json
// itself has no generatedAt of its own, so its freshness note reuses the
// real sync/verification dates of those two upstream sources instead of
// inventing a new timestamp.
export function DirectoryFreshness() {
  const architectures = metrics?.sources?.architectures;
  const architecturesDate = formatDate(metrics?.generatedAt);
  const awardsDate = formatDate(awardsData?.verifiedAt);
  if (!architecturesDate && !awardsDate) return null;
  return (
    <p className={styles.freshnessNote}>
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
      {awardsDate && <> Award data last verified on {awardsDate}.</>}
    </p>
  );
}
