/**
 * Resolution of upstream project-card artwork to locally mirrored assets.
 *
 * Imported architecture Markdown comes from cncf/architecture and can reference
 * an image on any host. Cards must never hot-link a third party, so every image
 * that reaches the published site is mirrored from a cncf/artwork branch at
 * import time and referenced by a local `/img/cncf-projects/...` path. Anything
 * that cannot be resolved to such a path fails closed and is dropped.
 */

// Mirrors ALLOWED_ASSET_EXTENSIONS in scripts/validate-architecture-assets.mjs.
// Mirrored artwork is published verbatim from static/, so any extension the
// browser would execute as markup or script must fail closed here: the URL is
// never mirrored and the card renders its fallback badge instead.
const MIRRORABLE_ARTWORK_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);

/**
 * Refs accepted in an artwork URL.
 *
 * The repository in the URL does not by itself establish provenance:
 * raw.githubusercontent.com serves a commit from anywhere in a repository's
 * fork network through the *upstream* path, so
 * `raw.githubusercontent.com/cncf/artwork/<sha>/...` returns content that was
 * never in cncf/artwork whenever `<sha>` came from a fork or a fork's pull
 * request. A wildcard ref therefore lets anyone who can push to any fork of
 * cncf/artwork — that is, anyone — choose the bytes that get mirrored into
 * static/ and published at the site origin.
 *
 * A branch name does not cross that boundary: it is resolved against the
 * repository named in the path, so a fork's branch is unreachable through the
 * upstream path. Only the two upstream branch names are accepted, and a
 * commit SHA is refused outright, because nothing here can tell an upstream
 * SHA from a fork's without a network round trip.
 */
const ARTWORK_REF = '(?:main|master)';

/**
 * Only TLS-protected artwork URLs are mirrored.
 *
 * mirrorArtworkUrls() fetches the URL matched here verbatim and writes the
 * response body into static/, where it is published at the site origin. Over
 * cleartext that content is whatever an on-path network position between the
 * import runner and the origin chose to return: answering the plaintext
 * request directly means the usual redirect to https never happens. The URL
 * itself comes from third-party Markdown imported unattended, so the scheme
 * cannot be assumed. Every sibling gate in this repository requires https for
 * the same reason (see project-card-links.mjs and profile-image.mjs).
 */
const ARTWORK_URL_PATTERNS = [
  new RegExp(
    `^https://raw\\.githubusercontent\\.com/cncf/artwork/${ARTWORK_REF}/(.+)$`,
  ),
  new RegExp(`^https://github\\.com/cncf/artwork/raw/${ARTWORK_REF}/(.+)$`),
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
  const extension = file.slice(file.lastIndexOf('.')).toLowerCase();
  if (!file.includes('.') || !MIRRORABLE_ARTWORK_EXTENSIONS.has(extension)) {
    return null;
  }
  if (!name || file === name) return file;
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
