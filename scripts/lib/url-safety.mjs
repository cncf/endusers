/**
 * URL safety checks shared between the validator scripts and the browser
 * bundle.
 *
 * This module is deliberately free of `node:*` imports: it reaches the
 * browser through src/lib/profile-links.mjs (bundled by
 * src/components/CommunityPeople), so adding a Node-only import here breaks
 * the client build. The error-reporting helpers that need `node:fs` live in
 * scripts/lib/validate-utils.mjs, which re-exports everything defined here.
 *
 * The check itself guards against a userinfo component disguising the real
 * host ("https://cncf.io@evil.example" parses with hostname evil.example
 * while reading as cncf.io to a reviewer). Before #1381 each validator
 * carried an independent copy with small drifts already visible between
 * them; #1388 tracks the stragglers. Centralizing it means the next
 * hardening (or the next new field) only has to happen once.
 */

// A value matching this pattern already carries a scheme and is parsed as
// given; anything else is treated as a bare host when options.defaultScheme
// is set.
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Base host allow-list for CNCF-sourced URLs, shared by every validator that
 * restricts a field to `checkUrl`'s `allowedHostSuffixes` option.
 * scripts/validate-case-studies.mjs and scripts/validate-radar-reports.mjs
 * use this list directly; scripts/validate-metrics.mjs extends it with
 * `github.com` for fields that legitimately point at a CNCF GitHub
 * repository. Before this export, each of the three carried its own copy
 * kept in sync only by a cross-reference comment.
 */
export const CNCF_HOST_SUFFIXES = ['cncf.io'];

/**
 * Prefix `value` with `defaultScheme` when it has no scheme of its own, so a
 * bare host such as "example.test" resolves against https instead of being
 * concatenated — concatenation lets a value such as
 * "trusted.example@attacker.example" produce a link whose visible prefix and
 * real authority disagree. Non-string values and values that already carry a
 * scheme are returned unchanged.
 */
function applyDefaultScheme(value, defaultScheme) {
  if (!defaultScheme || typeof value !== 'string') return value;
  return SCHEME_PATTERN.test(value) ? value : `${defaultScheme}//${value}`;
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
 * @param {string} [options.defaultScheme] - When set (e.g. `'https:'`), a
 *   value without a scheme of its own is parsed as
 *   `<defaultScheme>//<value>` instead of failing to parse. Schemeless
 *   values still have to survive the protocol and userinfo checks below.
 */
export function checkUrl(errors, path, field, value, options = {}) {
  const {
    allowEmpty = false,
    requireNonEmptyString = false,
    protocols = ['https:'],
    unparsedMessage = `${field} must be an absolute https URL`,
    allowedHostSuffixes,
    defaultScheme,
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
      applyDefaultScheme(
        requireNonEmptyString && typeof value === 'string'
          ? value.trim()
          : value,
        defaultScheme,
      ),
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
 *   `allowedHostSuffixes`, `defaultScheme`), other than the message-related
 *   ones.
 * @returns {URL|null} the parsed URL when it passes every check, else null.
 */
export function isSafeUrl(value, options = {}) {
  const errors = [];
  checkUrl(errors, '', '', value, options);
  return errors.length
    ? null
    : new URL(applyDefaultScheme(value, options.defaultScheme));
}
