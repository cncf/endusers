// Link validation for imported CNCF project cards.
//
// Card link targets come from Markdown in https://github.com/cncf/architecture,
// which is cloned and imported unattended by the daily import workflow.  A
// substring test such as `link.includes('cncf.io/projects/')` is satisfied by
// any host that merely mentions that text in a path, query or fragment, so the
// destination must be decided by parsing the URL rather than by matching text.

import { CNCF_HOST_SUFFIXES, isSafeUrl } from './validate-utils.mjs';

/**
 * True only for an https URL whose host is cncf.io (or a subdomain of it) and
 * whose path is under /projects/.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isCncfProjectHref(value) {
  // isSafeUrl() in ./validate-utils.mjs holds the scheme/userinfo/host checks
  // in one place; the /projects/ path-prefix requirement is specific to this
  // call site. Userinfo would otherwise let
  // "https://www.cncf.io@evil.example/projects/x" read as CNCF.
  const url = isSafeUrl(value, { allowedHostSuffixes: CNCF_HOST_SUFFIXES });
  if (!url) return false;

  return url.pathname === '/projects' || url.pathname.startsWith('/projects/');
}
