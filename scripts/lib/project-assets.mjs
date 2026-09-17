/**
 * Resolution of upstream project-card artwork to locally mirrored assets.
 *
 * Imported architecture Markdown comes from cncf/architecture and can reference
 * an image on any host. Cards must never hot-link a third party, so every image
 * that reaches the published site is mirrored from cncf/artwork at import time
 * and referenced by a local `/img/cncf-projects/...` path. Anything that cannot
 * be resolved to such a path fails closed and is dropped.
 */

const ARTWORK_URL_PATTERNS = [
  /^https?:\/\/raw\.githubusercontent\.com\/cncf\/artwork\/[^/]+\/(.+)$/,
  /^https?:\/\/github\.com\/cncf\/artwork\/raw\/[^/]+\/(.+)$/,
];

const MIRROR_DIR = 'static/img/cncf-projects';
const MIRROR_URL_PREFIX = '/img/cncf-projects';

/**
 * Extracts the repository-relative path of a cncf/artwork image URL.
 * Returns null for any URL that is not hosted in cncf/artwork.
 */
export function artworkPath(url) {
  if (typeof url !== 'string') return null;
  for (const pattern of ARTWORK_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      const path = match[1].split(/[?#]/)[0];
      // Reject traversal and empty segments; artwork paths are plain and flat.
      if (!path || path.split('/').some((part) => !part || part === '..')) {
        return null;
      }
      return path;
    }
  }
  return null;
}

/**
 * Derives the mirrored filename for a cncf/artwork path.
 *
 * Artwork paths look like `projects/<name>/<variant>/<theme>/<file>` or
 * `other/<name>/...`. The mirrored name keeps the historical
 * `<name>-<file>` shape so previously mirrored assets keep their filenames.
 */
export function artworkMirrorName(path) {
  const segments = path.split('/');
  if (segments.length < 2) return null;
  const name = segments[1];
  const file = segments[segments.length - 1];
  if (!name || !file || file === name) return file || null;
  return `${name}-${file}`;
}

/** Repository-relative destination for a mirrored artwork path. */
export function artworkMirrorPath(path) {
  const name = artworkMirrorName(path);
  return name ? `${MIRROR_DIR}/${name}` : null;
}

/**
 * Maps an upstream image URL to its mirrored local site path.
 *
 * Returns null when the image is not mirrored. It never returns a remote URL:
 * a card that cannot be resolved locally renders its fallback badge instead of
 * beaconing the visitor to a third-party host.
 */
export function projectAsset(url) {
  if (typeof url !== 'string' || !url) return null;
  if (url.startsWith(`${MIRROR_URL_PREFIX}/`)) return url;
  const path = artworkPath(url);
  if (!path) return null;
  const name = artworkMirrorName(path);
  return name ? `${MIRROR_URL_PREFIX}/${name}` : null;
}

/** Collects every distinct cncf/artwork image URL referenced in Markdown. */
export function artworkUrls(body) {
  const urls = new Set();
  for (const [, url] of String(body).matchAll(
    /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g,
  )) {
    if (artworkPath(url)) urls.add(url);
  }
  for (const [, url] of String(body).matchAll(
    /\]\((https?:\/\/[^)\s]+\.(?:svg|png))\)/gi,
  )) {
    if (artworkPath(url)) urls.add(url);
  }
  return [...urls];
}
