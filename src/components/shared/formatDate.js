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

const UTC_MONTH = { timeZone: 'UTC', month: 'long' };

/**
 * Format two ISO calendar dates as one range in the same UTC-pinned, long-form
 * US style as formatDate(): a single day collapses to that day, a range
 * within one month shares the month and year ("November 9–12, 2026"), a
 * range within one year shares the year ("March 30 – April 2, 2026"), and
 * anything else spells both ends out. `null` if either end does not parse.
 *
 * @param {string} start
 * @param {string} end
 * @returns {string|null}
 */
export function formatDateRange(start, end) {
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (from.getTime() === to.getTime()) return formatDate(start);
  const year = from.getUTCFullYear();
  if (year !== to.getUTCFullYear()) {
    return `${formatDate(start)} – ${formatDate(end)}`;
  }
  const fromMonth = from.toLocaleDateString('en-US', UTC_MONTH);
  if (from.getUTCMonth() === to.getUTCMonth()) {
    return `${fromMonth} ${from.getUTCDate()}–${to.getUTCDate()}, ${year}`;
  }
  const toMonth = to.toLocaleDateString('en-US', UTC_MONTH);
  return `${fromMonth} ${from.getUTCDate()} – ${toMonth} ${to.getUTCDate()}, ${year}`;
}
