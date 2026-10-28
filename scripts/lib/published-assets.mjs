/**
 * Where a site-absolute asset URL comes from in the repository.
 *
 * Most assets are served from static/ at the same path. Reference-architecture
 * images are the exception: each lives beside its page in
 * docs/architectures/<id>/images/, and endusersArchitectureImages in
 * docusaurus.config.js copies it to /img/architectures/<id>/ at build time, so
 * the URL in a page, catalog record or member entry names a file that is not
 * under static/.
 */

import { join } from 'node:path';

export const ARCHITECTURE_IMAGE_PREFIX = '/img/architectures/';

/**
 * The repository file a site-absolute URL is published from. The URL is not
 * decoded or normalised; callers that accept untrusted input check for `..`
 * and containment themselves.
 * @param {string} repoRoot
 * @param {string} url - Site-absolute path, e.g. `/img/logo.svg`.
 * @returns {string}
 */
export function publishedSourcePath(repoRoot, url) {
  if (url.startsWith(ARCHITECTURE_IMAGE_PREFIX)) {
    const [id, ...rest] = url
      .slice(ARCHITECTURE_IMAGE_PREFIX.length)
      .split('/');
    return join(repoRoot, 'docs/architectures', id, 'images', ...rest);
  }
  return join(repoRoot, 'static', url);
}
