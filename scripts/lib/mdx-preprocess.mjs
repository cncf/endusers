/**
 * The rewrites Docusaurus applies to a page before the MDX compiler sees it.
 *
 * Both MDX gates in this directory rest on the premise that the text they scan
 * is the text that gets compiled. It is not: `preprocessContent()` in
 * @docusaurus/mdx-loader runs a chain of string rewrites over every page
 * first, and only their output reaches MDX. A construct that is inert on disk
 * and active after a rewrite is therefore invisible to a scan of the file
 * alone.
 *
 * `unwrapMdxCodeBlocks()` is one link in that chain and already has a module of
 * its own (./mdx-code-blocks.mjs). This one covers the rest of it, in the order
 * the loader applies them:
 *
 * 1. `escapeMarkdownHeadingIds()` backslash-escapes `{#id}` in an ATX heading.
 * 2. `admonitionTitleToDirectiveLabel()` turns the legacy `:::note Title`
 *    syntax into the container-directive form `:::note[Title]`.
 *
 * The second is the one that creates capability rather than removing it. It
 * inserts a `[` after the directive token and a `]` at end of line, and a
 * Markdown link needs exactly a `[` to its left and a `](url)` to its right --
 * so `:::note x](javascript:alert(1))`, which is literal text in the file, is
 * parsed as a link to `javascript:alert(1)` once the `[` is inserted. Neither
 * rewrite adds or removes a line, so a finding's line number in the rewritten
 * text is its line number in the text that went in.
 *
 * As with ./mdx-code-blocks.mjs, the upstream functions are called rather than
 * their patterns restated, so where a bracket lands, which quote and
 * indentation prefixes are accepted and how many colons open a directive
 * cannot drift from the installed version.
 *
 * The one thing deliberately not taken from upstream is the keyword list.
 * Docusaurus rewrites only the admonition names it knows, and a site may add
 * more through `markdown.admonitions`; those names live in
 * @docusaurus/mdx-loader, which is not a direct dependency and exports no entry
 * point for them. Passing a name pattern instead of a list means the rewrite is
 * applied to every directive name. That scans a form Docusaurus does not
 * produce for a name it does not know, which can only report a finding that
 * would not have shipped -- an over-rejection, never a miss -- and it holds if
 * the keyword list is ever extended upstream or by configuration.
 */

import {
  admonitionTitleToDirectiveLabel,
  escapeMarkdownHeadingIds,
} from '@docusaurus/utils';

/**
 * Stands in for the admonition keyword list, matching any directive name.
 *
 * `admonitionTitleToDirectiveLabel()` joins its keywords with `|` and drops
 * them into a capture group, so a pattern here is interpolated into the same
 * position a literal name would occupy.
 */
const ANY_DIRECTIVE_NAME = '[A-Za-z][A-Za-z0-9-]*';

/**
 * Apply the preprocessor rewrites that follow `unwrapMdxCodeBlocks()`.
 *
 * @param {string} unwrapped - A document, already unwrapped.
 * @returns {string} The text the MDX compiler is handed. Line count is
 *   unchanged, so line numbers carry over.
 */
export function rewriteAfterUnwrap(unwrapped) {
  return admonitionTitleToDirectiveLabel(escapeMarkdownHeadingIds(unwrapped), [
    ANY_DIRECTIVE_NAME,
  ]);
}
