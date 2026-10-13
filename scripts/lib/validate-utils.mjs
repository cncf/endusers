/**
 * Shared utilities for validation scripts.
 *
 * Provides a consistent pattern for collecting errors, formatting output,
 * and exiting with proper status codes across all validator scripts.
 */

import fs from 'node:fs';

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
 * Validate that `value` is an absolute URL using an allowed protocol, with no
 * userinfo component disguising the real host ("https://cncf.io@evil.example"
 * parses with hostname evil.example while reading as cncf.io to a reviewer),
 * optionally restricted to an allowed set of host suffixes.
 *
 * Five validator scripts carried independent copies of this check with small
 * drifts already visible between them -- a host allowlist in
 * scripts/validate-metrics.mjs with none in the others, scripts/validate-
 * awards.mjs and scripts/validate-launch-metrics.mjs disagreeing on whether an
 * unparseable value echoes it back. Centralizing it means the next hardening
 * (or the next new field) only has to happen once.
 *
 * @param {Array<Object>} errors - Array to accumulate errors.
 * @param {string} path - File path or identifier.
 * @param {string} field - Field name used in error messages.
 * @param {unknown} value - Candidate URL.
 * @param {Object} [options]
 * @param {boolean} [options.allowEmpty] - Treat null/undefined/'' as valid.
 * @param {boolean} [options.requireNonEmptyString] - Push a dedicated
 *   "must be a non-empty string" error instead of the parse-failure message
 *   when `value` is not a usable string.
 * @param {string[]} [options.protocols] - Allowed protocols. Defaults to
 *   `['https:']`.
 * @param {string} [options.unparsedMessage] - Message used when `value`
 *   cannot be parsed as a URL. Defaults to "<field> must be an absolute
 *   https URL".
 * @param {string[]} [options.allowedHostSuffixes] - When set, `value`'s
 *   hostname must equal, or be a subdomain of, one of these suffixes.
 */
export function checkUrl(errors, path, field, value, options = {}) {
  const {
    allowEmpty = false,
    requireNonEmptyString = false,
    protocols = ['https:'],
    unparsedMessage = `${field} must be an absolute https URL`,
    allowedHostSuffixes,
  } = options;

  if (allowEmpty && (value === undefined || value === null || value === '')) {
    return;
  }

  if (requireNonEmptyString && (typeof value !== 'string' || !value.trim())) {
    errors.push({
      path,
      severity: 'error',
      message: `${field} must be a non-empty string`,
    });
    return;
  }

  let parsed;
  try {
    parsed = new URL(
      requireNonEmptyString && typeof value === 'string' ? value.trim() : value,
    );
  } catch {
    errors.push({ path, severity: 'error', message: unparsedMessage });
    return;
  }

  if (!protocols.includes(parsed.protocol)) {
    errors.push({
      path,
      severity: 'error',
      message: `${field} must use ${protocols
        .map((protocol) => protocol.replace(/:$/, ''))
        .join(' or ')}, got ${parsed.protocol}`,
    });
    return;
  }

  if (parsed.username || parsed.password) {
    errors.push({
      path,
      severity: 'error',
      message: `${field} must not carry a userinfo component, which only disguises the real host (${parsed.hostname})`,
    });
    return;
  }

  if (allowedHostSuffixes) {
    const host = parsed.hostname.toLowerCase();
    const allowed = allowedHostSuffixes.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
    if (!allowed) {
      errors.push({
        path,
        severity: 'error',
        message: `${field} must be on ${allowedHostSuffixes.join(' or ')}, got ${parsed.hostname}`,
      });
    }
  }
}

/**
 * Boolean/predicate form of checkUrl(), for the call sites that filter or
 * branch on a URL's safety rather than collecting an error report (a `find()`
 * predicate, or a validator whose message names other fields too and so
 * cannot just forward checkUrl()'s own message).
 *
 * Delegates to checkUrl() against a throwaway errors array so the protocol/
 * userinfo/host-suffix rules live in exactly one place; re-parses on success
 * to hand back the URL object (callers such as isCncfProjectHref() need
 * `.pathname`), which is only reachable once checkUrl() has already found the
 * value parseable.
 *
 * @param {unknown} value - Candidate URL.
 * @param {Object} [options] - Same options as checkUrl() (`protocols`,
 *   `allowedHostSuffixes`), other than the message-related ones.
 * @returns {URL|null} the parsed URL when it passes every check, else null.
 */
export function isSafeUrl(value, options = {}) {
  const errors = [];
  checkUrl(errors, '', '', value, options);
  if (errors.length) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
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
