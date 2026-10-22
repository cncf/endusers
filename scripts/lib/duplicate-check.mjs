/**
 * Shared duplicate-value check for validation scripts.
 *
 * Kept apart from scripts/lib/validate-utils.mjs, whose
 * checkDuplicateOrMissingId() also reports a missing value: several
 * validators already run a separate presence check on the same field
 * (checkNonEmptyString() or an inline check) before deduping, so folding
 * missing-value detection in here too would double-report a single missing
 * entry as both "missing" and "duplicate".
 */

/**
 * Push a "duplicate" error when `value` is already in `seen`, then record
 * `value` in `seen` regardless. Never inspects `value` for presence — call
 * it only for entries whose presence is already validated elsewhere, or
 * guard the call site the way the caller's existing presence check does.
 *
 * validate-architectures.mjs, validate-community-groups.mjs,
 * validate-members.mjs, and validate-projects-born.mjs each carried an
 * independent copy of this per-entry dedup check, varying only in whether
 * the caller already guards the call site against a falsy value.
 *
 * @param {Array<Object>} errors - Array to accumulate errors.
 * @param {string} path - File path or identifier used as the error's path.
 * @param {unknown} value - Candidate value to dedup (e.g. an id, slug, or name).
 * @param {Set<unknown>} seen - Set of values already encountered; mutated.
 * @param {string} [message] - Error message; defaults to the generic form.
 * @returns {boolean} Whether `value` passed the check.
 */
export function checkDuplicateValue(
  errors,
  path,
  value,
  seen,
  message = 'duplicate value',
) {
  const ok = !seen.has(value);
  if (!ok) {
    errors.push({
      path,
      severity: 'error',
      message,
    });
  }
  seen.add(value);
  return ok;
}
