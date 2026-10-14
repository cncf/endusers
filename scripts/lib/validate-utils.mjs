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
