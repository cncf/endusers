/**
 * Single source of truth for which asset extensions are safe to mirror from
 * an upstream source (cncf/architecture, cncf/artwork, cncf/landscape) or
 * accept as a committed image, and to publish verbatim at the site origin.
 *
 * static/ is served by Docusaurus without any further processing, so a file
 * the browser would execute as markup or script (.html, .xhtml, .js, .svgz)
 * must never be mirrored or accepted here: it would run in the site's own
 * origin. This list was previously five independent copies (one per
 * importer/validator) kept in sync only by convention and a cross-reference
 * comment; see endusers#1431. Any change to it affects every mirror and
 * validation gate below, so review it as a security boundary.
 */
export const MIRRORABLE_ASSET_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);
