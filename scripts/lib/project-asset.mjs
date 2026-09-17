// Maps an upstream project image URL to its mirrored local path.
//
// Only the `cncf/artwork` `.../icon/color/<file>` shape is mirrored by
// mirrorProjectAssets() in scripts/import-architectures.mjs, so this must
// fail closed: any URL that does not resolve to a local /img/... asset
// returns null rather than the remote URL. Callers must never render a
// remote URL as `logo=`, since that hot-links third-party hosts on every
// page view (see issue #248).
export function projectAsset(url) {
  if (url.startsWith('/img/')) return url;
  const match = url.match(/projects\/([^/]+)\/icon\/color\/([^/]+)$/);
  return match ? `/img/cncf-projects/${match[1]}-${match[2]}` : null;
}
