import React from 'react';
import { formatDate } from './formatDate';

/**
 * Provenance line for a data file mirrored from cncf.io ("Mirrored from
 * cncf.io/<index> on <date>."). Shared by the WordPress-backed listings
 * (`CaseStudies`, `RadarReports`) so the attribution link hygiene and the
 * missing/invalid `generatedAt` handling stay in one place.
 *
 * Renders nothing when `generatedAt` is absent or does not parse, so an
 * incomplete mirror never ships an "Invalid Date".
 */
export default function MirrorSyncStatus({
  generatedAt,
  sourceUrl,
  label,
  className,
}) {
  const syncDate = formatDate(generatedAt);
  if (!syncDate) return null;
  return (
    <p className={className}>
      Mirrored from{' '}
      <a href={sourceUrl} target="_blank" rel="noreferrer">
        {label}
      </a>{' '}
      on {syncDate}.
    </p>
  );
}
