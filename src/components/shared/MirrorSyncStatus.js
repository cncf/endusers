import { formatDate } from './formatDate';

/**
 * Provenance line for a data file mirrored from cncf.io ("Mirrored from
 * cncf.io/<index> on <date>."). Shared by the WordPress-backed listings
 * (`CaseStudies`, `RadarReports`) so the attribution link hygiene and the
 * missing/invalid `generatedAt` handling stay in one place.
 *
 * Renders nothing when `generatedAt` is absent, `null` or does not parse, so
 * an incomplete mirror never ships an "Invalid Date" -- or the epoch, which
 * is what `new Date(null)` would otherwise format to.
 */
export default function MirrorSyncStatus({
  generatedAt,
  sourceUrl,
  label,
  className,
}) {
  if (!generatedAt) return null;
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
