/**
 * Shared utilities for validation scripts.
 *
 * Provides a consistent pattern for collecting errors, formatting output,
 * and exiting with proper status codes across all validator scripts.
 *
 * checkUrl() and isSafeUrl() live in scripts/lib/url-safety.mjs, the fs-free
 * half of this module that the browser bundle can also import (see
 * src/lib/profile-links.mjs); they are re-exported here so existing
 * validator imports keep working unchanged.
 */

import fs from 'node:fs';

import { publishableCncfUrl, CNCF_HOST_SUFFIXES } from './url-safety.mjs';

export {
  checkUrl,
  isSafeUrl,
  publishableCncfUrl,
  CNCF_HOST_SUFFIXES,
} from './url-safety.mjs';

/**
 * Write text to stderr without going through console.
 *
 * console.error() is asynchronous when stderr is a pipe (Node, "A note on
 * process I/O": pipes and sockets are asynchronous on POSIX) and
 * process.exit() does not wait for pending writes, so the tail of a long
 * report can be dropped before the parent reads it. Writing to the file
 * descriptor is synchronous whatever stderr is connected to.
 *
 * @param {string} text - Text to write verbatim.
 */
function writeStderrSync(text) {
  const buffer = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < buffer.length) {
    try {
      offset += fs.writeSync(process.stderr.fd, buffer, offset);
    } catch (error) {
      // A non-blocking stderr can refuse a write that a later retry accepts.
      if (error.code !== 'EAGAIN') throw error;
    }
  }
}

/**
 * Collect and format a validation error.
 * @param {Array<Object>} errors - Array to accumulate errors
 * @param {string} path - File path or identifier
 * @param {string} severity - Error severity: 'error' or 'warn'
 * @param {string} message - Error message
 */
export function collectError(errors, path, severity, message) {
  errors.push({ path, severity, message });
}

/**
 * Push a "<field> must be a non-empty array" error when `value` is not an
 * array or has no elements.
 *
 * validate-awards.mjs, validate-case-studies.mjs,
 * validate-community-groups.mjs, validate-members.mjs,
 * validate-projects-born.mjs and validate-radar-reports.mjs each carried an
 * independent copy of this check with no two spelled identically
 * (`!x.length` vs `x.length === 0`, inline `errors.push` vs `collectError`).
 * Centralizing it here means the next data file only has to call it.
 *
 * @param {Array<Object>} errors - Array to accumulate errors.
 * @param {string} path - File path or identifier used as the error's path.
 * @param {string} field - Name used in the error message.
 * @param {unknown} value - Candidate array.
 * @returns {boolean} Whether `value` is a non-empty array.
 */
export function checkNonEmptyArray(errors, path, field, value) {
  const ok = Array.isArray(value) && value.length > 0;
  if (!ok) {
    errors.push({
      path,
      severity: 'error',
      message: `${field} must be a non-empty array`,
    });
  }
  return ok;
}

/** Strict ISO 8601 UTC form (no plain `Date.parse` laxity; see checkIsoTimestamp). */
const ISO_8601_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/;

/**
 * Resolve a strict ISO 8601 UTC string to its epoch time, or NaN.
 *
 * The shape test alone is not enough: `\d{2}` matches `13` as a month and
 * `45` as a day, and a value the shape accepts but the calendar does not —
 * `2026-13-45T99:61:61Z` — yields an Invalid Date whose `getTime()` is NaN.
 * `NaN > limit` is false, so a caller's future-skew comparison silently
 * passes such a value instead of rejecting it, and the loose
 * `Number.isNaN(Date.parse(value))` gates this helper replaced would have
 * caught it. Round-tripping the captured components through `Date.UTC` also
 * rejects the forms `Date.parse` normalizes rather than refuses, such as
 * `2026-02-31T00:00:00Z` (rolls into March) and `2026-06-15T24:00:00Z`
 * (rolls into the next day).
 *
 * @param {unknown} value - Candidate timestamp.
 * @returns {number} Epoch milliseconds, or NaN when `value` is not a real
 *   strict ISO 8601 UTC instant.
 */
function isoUtcTime(value) {
  const match = ISO_8601_PATTERN.exec(value ?? '');
  if (!match) return NaN;

  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;

  return roundTrips ? Date.parse(value) : NaN;
}

/**
 * Validate that `value` is a strict ISO 8601 UTC timestamp, optionally also
 * rejecting one dated beyond a future clock-skew allowance.
 *
 * validate-community-groups.mjs, validate-enduser-members.mjs and
 * validate-launch-metrics.mjs each gated a "must be ISO 8601" field with a
 * plain `Number.isNaN(Date.parse(value))` test, which also accepts loose,
 * locale-dependent strings such as "March 1, 2026" — exactly the gap
 * validate-community-people.mjs's own strict regex was written to close, but
 * its copy stayed local. A value that passes the loose check while failing
 * the strict one silently defeats any staleness/future check layered on top,
 * which is the failure mode validate-community-groups.mjs's `generatedAt`
 * grace-window check actually depends on being closed.
 *
 * Shape is checked by isoUtcTime(), which also requires the captured
 * components to be a real UTC instant, so a calendar-impossible value cannot
 * reach the future-skew comparison as a NaN that compares false.
 *
 * @param {Array<Object>} errors - Array to accumulate errors.
 * @param {string} path - File path or identifier used as the error's path.
 * @param {string} field - Field name used in the default error messages.
 * @param {unknown} value - Candidate timestamp.
 * @param {Object} [options]
 * @param {string} [options.message] - Message used when `value` is not
 *   strict ISO 8601. Defaults to "<field> must be ISO 8601".
 * @param {number} [options.futureToleranceMs] - When set, `value` must not
 *   be later than `Date.now() + futureToleranceMs`.
 * @param {string} [options.futureMessage] - Message used when `value` is
 *   too far in the future. Defaults to "<field> cannot be in the future".
 * @returns {boolean} Whether `value` passed every check performed.
 */
export function checkIsoTimestamp(errors, path, field, value, options = {}) {
  const {
    message = `${field} must be ISO 8601`,
    futureToleranceMs,
    futureMessage = `${field} cannot be in the future`,
  } = options;

  const time = isoUtcTime(value);

  if (!Number.isFinite(time)) {
    errors.push({ path, severity: 'error', message });
    return false;
  }

  if (
    futureToleranceMs !== undefined &&
    time > Date.now() + futureToleranceMs
  ) {
    errors.push({ path, severity: 'error', message: futureMessage });
    return false;
  }

  return true;
}

/**
 * Push a "<field> must be a parseable date[ <suffix>]" error when `value` is
 * not a string `Date.parse` can resolve.
 *
 * validate-case-studies.mjs, validate-radar-reports.mjs and
 * validate-awards.mjs each carried an independent
 * `Number.isNaN(Date.parse(value))` copy with a near-identical message — the
 * same centralize-after-drift precedent already applied here to
 * checkNonEmptyArray() and checkUrl(). This is the loose `Date.parse` check;
 * it is distinct from the strict ISO 8601 check some other validators apply
 * to their own timestamp fields.
 *
 * @param {Array<Object>} errors - Array to accumulate errors.
 * @param {string} path - File path or identifier used as the error's path.
 * @param {string} field - Name used in the error message.
 * @param {unknown} value - Candidate date string.
 * @param {string} [messageSuffix] - Extra context appended to the message.
 * @returns {boolean} Whether `value` parses as a date.
 */
export function checkParseableDate(errors, path, field, value, messageSuffix) {
  const ok = typeof value === 'string' && !Number.isNaN(Date.parse(value));
  if (!ok) {
    errors.push({
      path,
      severity: 'error',
      message: messageSuffix
        ? `${field} must be a parseable date ${messageSuffix}`
        : `${field} must be a parseable date`,
    });
  }
  return ok;
}

/**
 * Push a "<field> must be a non-empty string" error when `value` is not a
 * string or is empty/whitespace-only.
 *
 * validate-members.mjs (member records and membershipSources entries) and
 * validate-projects-born.mjs each looped their own required-text-fields list
 * through an identical `typeof value !== 'string' || !value.trim()` test and
 * an identically worded message. Centralizing it here means the next
 * required-field loop only has to call it.
 *
 * @param {Array<Object>} errors - Array to accumulate errors.
 * @param {string} path - File path or identifier used as the error's path.
 * @param {string} field - Name used in the error message.
 * @param {unknown} value - Candidate string.
 * @returns {boolean} Whether `value` is a non-empty string.
 */
export function checkNonEmptyString(errors, path, field, value) {
  const ok = typeof value === 'string' && value.trim() !== '';
  if (!ok) {
    errors.push({
      path,
      severity: 'error',
      message: `${field} must be a non-empty string`,
    });
  }
  return ok;
}

/**
 * Push a "sourceUrl must be an https URL..." error when `value` is not a
 * CNCF-hosted, userinfo-free https URL.
 *
 * validate-case-studies.mjs and validate-radar-reports.mjs each carried an
 * independent copy of this top-of-file `sourceUrl` gate with an identically
 * worded message — the same centralize-after-drift precedent already
 * applied here to checkNonEmptyArray() and checkParseableDate().
 *
 * @param {Array<Object>} errors - Array to accumulate errors.
 * @param {string} path - File path or identifier used as the error's path.
 * @param {unknown} value - Candidate sourceUrl.
 * @returns {boolean} Whether `value` passed the check.
 */
export function checkPublishableSourceUrl(errors, path, value) {
  const ok = Boolean(value) && Boolean(publishableCncfUrl(value));
  if (!ok) {
    errors.push({
      path,
      severity: 'error',
      message: `sourceUrl must be an https URL, with no userinfo, on ${CNCF_HOST_SUFFIXES.join(' or ')}`,
    });
  }
  return ok;
}

/**
 * Push a "duplicate or missing id" error when `id` is falsy or already in
 * `seen`, then record `id` in `seen` regardless.
 *
 * validate-case-studies.mjs and validate-radar-reports.mjs each carried an
 * independent copy of this per-entry id-dedup check, byte-identical apart
 * from the `errors`/`ids` variable names.
 *
 * @param {Array<Object>} errors - Array to accumulate errors.
 * @param {string} path - File path or identifier used as the error's path.
 * @param {unknown} id - Candidate entry id (entry.id, not a display fallback).
 * @param {Set<unknown>} seen - Set of ids already encountered; mutated.
 * @returns {boolean} Whether `id` passed the check.
 */
export function checkDuplicateOrMissingId(errors, path, id, seen) {
  const ok = Boolean(id) && !seen.has(id);
  if (!ok) {
    errors.push({
      path,
      severity: 'error',
      message: 'duplicate or missing id',
    });
  }
  seen.add(id);
  return ok;
}

/**
 * Report collected errors and exit if any errors exist.
 * @param {Array<Object>} errors - Array of error objects with { path, severity, message }
 * @param {string} contextLabel - Label for output context (e.g., "architecture assets")
 */
export function reportAndExit(errors, contextLabel) {
  const warnings = errors.filter((e) => e.severity === 'warn');
  const failureErrors = errors.filter((e) => e.severity === 'error');

  // Warnings share the synchronous path so that a report carrying both
  // severities cannot have its warning half dropped by the exit below, and so
  // the two halves cannot interleave.
  if (warnings.length) {
    const lines = [`\n${warnings.length} warning(s) in ${contextLabel}:`];
    for (const { path, message } of warnings) {
      lines.push(`  [warn] ${path}: ${message}`);
    }
    writeStderrSync(`${lines.join('\n')}\n`);
  }

  if (failureErrors.length) {
    const lines = [`\n${failureErrors.length} error(s) in ${contextLabel}:`];
    for (const { path, message } of failureErrors) {
      lines.push(`  [error] ${path}: ${message}`);
    }
    writeStderrSync(`${lines.join('\n')}\n`);
    process.exit(1);
  }
}
