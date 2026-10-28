/**
 * Single source of truth for the 2 MB member-logo asset size ceiling,
 * mirroring how MIRRORABLE_ASSET_EXTENSIONS in asset-extensions.mjs
 * consolidated a previously-duplicated allow-list (endusers#1431).
 *
 * This limit gates the same class of asset — a committed or mirrored file
 * under static/img/end-user-members/ — across three independent call sites
 * that must agree or the publish pipeline can silently diverge: the
 * collector refuses an oversized upstream logo at mirror time
 * (enduser-collector.mjs), a committed override must fit under the same
 * ceiling (validate-enduser-members.mjs), and the published asset is
 * re-checked against it at validation time (validate-architecture-assets.mjs).
 * Before this was centralized, each file redefined the literal with a
 * cross-reference comment pointing at the others, kept in sync only by
 * convention.
 */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
