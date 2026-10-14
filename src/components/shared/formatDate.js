/**
 * Format an ISO timestamp as a long-form US date, or `null` if it does not
 * parse (e.g. missing or malformed source data). Shared by freshness notes
 * across the site (`PeopleFreshness`, `MemberDirectory`, `GroupLinkStatus`,
 * `MirrorSyncStatus`) so the invalid-date
 * handling and locale formatting stay in one place.
 *
 * @param {string} isoDate
 * @returns {string|null}
 */
export function formatDate(isoDate) {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
