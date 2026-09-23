// Link validation for imported CNCF project cards.
//
// Card link targets come from Markdown in https://github.com/cncf/architecture,
// which is cloned and imported unattended by the daily import workflow.  A
// substring test such as `link.includes('cncf.io/projects/')` is satisfied by
// any host that merely mentions that text in a path, query or fragment, so the
// destination must be decided by parsing the URL rather than by matching text.

/**
 * True only for an https URL whose host is cncf.io (or a subdomain of it) and
 * whose path is under /projects/.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isCncfProjectHref(value) {
  if (typeof value !== 'string') return false;

  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  // Userinfo lets "https://www.cncf.io@evil.example/projects/x" read as CNCF.
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  if (host !== 'cncf.io' && !host.endsWith('.cncf.io')) return false;

  return url.pathname === '/projects' || url.pathname.startsWith('/projects/');
}
