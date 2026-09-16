/**
 * Shared utilities for validation scripts.
 *
 * Provides a consistent pattern for collecting errors, formatting output,
 * and exiting with proper status codes across all validator scripts.
 */

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
 * Report collected errors and exit if any errors exist.
 * @param {Array<Object>} errors - Array of error objects with { path, severity, message }
 * @param {string} contextLabel - Label for output context (e.g., "architecture assets")
 */
export function reportAndExit(errors, contextLabel) {
  const warnings = errors.filter((e) => e.severity === 'warn');
  const failureErrors = errors.filter((e) => e.severity === 'error');

  if (warnings.length) {
    console.warn(`\n${warnings.length} warning(s) in ${contextLabel}:`);
    for (const { path, message } of warnings) {
      console.warn(`  [warn] ${path}: ${message}`);
    }
  }

  if (failureErrors.length) {
    console.error(`\n${failureErrors.length} error(s) in ${contextLabel}:`);
    for (const { path, message } of failureErrors) {
      console.error(`  [error] ${path}: ${message}`);
    }
    process.exit(1);
  }
}
