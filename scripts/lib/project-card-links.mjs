/**
 * Validation for links used to populate CNCFProjectCard `href` attributes.
 *
 * Imported architecture Markdown is upstream-controlled content, so links
 * pulled out of it must be validated with real URL parsing rather than a
 * bare substring match before they are trusted as CNCF project links.
 */

/**
 * True only for https URLs on cncf.io (or a subdomain) under /projects/.
 * @param {string} value - Candidate URL string.
 * @returns {boolean}
 */
export function isCncfProjectHref(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host !== 'cncf.io' && !host.endsWith('.cncf.io')) return false;
  return url.pathname === '/projects' || url.pathname.startsWith('/projects/');
}
