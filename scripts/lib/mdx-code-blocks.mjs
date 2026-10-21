/**
 * The one fenced code block Docusaurus does not publish as code.
 *
 * Both MDX gates in this directory rest on the same premise: MDX evaluates
 * nothing inside a fenced code block, so a span the parser calls `code` can be
 * handed through verbatim (scripts/lib/mdx-escape.mjs) and needs no scan
 * (scripts/lib/mdx-active-content.mjs). That premise is about MDX, and
 * Docusaurus does not hand the file to MDX unchanged.
 *
 * `preprocessContent()` in @docusaurus/mdx-loader calls
 * `unwrapMdxCodeBlocks()` on every page, unconditionally — there is no
 * configuration that turns it off. It deletes the opening and closing fences
 * of a ```mdx-code-block block and leaves the body in their place, so the body
 * reaches the MDX compiler as ordinary flow content. A fence that reads as an
 * inert snippet in a pull-request diff therefore publishes as live JSX, a live
 * `{...}` expression, or a remote `<img>`.
 *
 * The test below asks Docusaurus's own function rather than restating its
 * regular expressions. Those accept three or four backticks, optional
 * indentation and optional spaces before the info string, and nothing else;
 * restating that here would be one more thing to keep in sync with an upstream
 * upgrade, and every place it drifted would be a hole. Asking the function
 * cannot drift: whatever Docusaurus unwraps in a given installed version is
 * exactly what this reports.
 */

import { unwrapMdxCodeBlocks } from '@docusaurus/utils';

/**
 * Whether Docusaurus will strip this code block's fences and compile its body
 * as MDX.
 *
 * The node's own source range is passed to `unwrapMdxCodeBlocks()`: the range
 * begins at the opening fence and ends at the closing one, which is exactly
 * the `^`/`$` anchoring its patterns allow, so the answer for the slice is the
 * answer for the block in the whole document.
 *
 * @param {string} source Full document text.
 * @param {{ position?: { start?: { offset?: number }, end?: { offset?: number } } }} node
 *   An mdast `code` node from a parse of `source`.
 * @returns {boolean}
 */
export function isUnwrappedCodeBlock(source, node) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (start === undefined || end === undefined) return false;
  const block = source.slice(start, end);
  return unwrapMdxCodeBlocks(block) !== block;
}

export { unwrapMdxCodeBlocks };
