/**
 * Format an ISO timestamp or calendar date as a long-form US date, or `null`
 * if it does not parse (e.g. missing or malformed source data). Shared by
 * every date the site renders from data/ so the invalid-date handling and
 * locale formatting stay in one place.
 *
 * Pinned to UTC: a date-only value such as `2026-09-30` parses as UTC
 * midnight, and the site is built once (in UTC) and hydrated in the visitor's
 * browser, so formatting in the local zone would render the previous day for
 * everyone west of UTC and mismatch the server-rendered text.
 *
 * @param {string} isoDate
 * @returns {string|null}
 */
export function formatDate(isoDate) {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
