/**
 * Neutralizes MDX-active syntax in third-party prose.
 *
 * Pages under docs/ are compiled as MDX, not CommonMark: @docusaurus/core 3
 * defaults `markdown.format` to `mdx` and docusaurus.config.js does not
 * override it. Prose taken from a submission form therefore reaches a
 * JavaScript compiler, where `{...}` is an expression, `<Tag onClick={...}>`
 * is a live React element, and a block-initial `import`/`export` line is a
 * top-level ESM statement. All three run during the production build and in
 * the visitor's browser.
 *
 * MDX does not evaluate anything inside a code block or an inline code span,
 * so those are passed through untouched: an architecture description that
 * shows a YAML or JSON snippet must keep its braces verbatim.
 *
 * Which spans of the text are code is decided by parsing it with MDX's own
 * grammar, not by scanning lines here. A hand-rolled scanner has to
 * re-derive fence rules, tab stops and lazy continuation, and every place it
 * disagrees with the real parser is a hole: text this module hands back
 * unescaped as "code" is still compiled as live MDX whenever the compiler
 * disagreed that a code block was open.
 *
 * Everything escaped here is replaced by a character reference that renders
 * as the original character, so escaped prose displays exactly as written.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxjs } from 'micromark-extension-mdxjs';
import { mdxFromMarkdown } from 'mdast-util-mdx';

const ESCAPES = new Map([
  ['&#123;', '{'],
  ['&#125;', '}'],
  ['&lt;', '<'],
  ['&#105;', 'i'],
  ['&#101;', 'e'],
]);

/** The node types MDX compiles to live JavaScript rather than to text. */
const MDX_ACTIVE_TYPES = new Set([
  'mdxjsEsm',
  'mdxFlowExpression',
  'mdxTextExpression',
  'mdxJsxFlowElement',
  'mdxJsxTextElement',
]);

/** Parses with the extensions MDX itself enables, so the tree is MDX's view. */
function parseMdx(text) {
  return fromMarkdown(text, {
    extensions: [mdxjs()],
    mdastExtensions: [mdxFromMarkdown()],
  });
}

function eachNode(node, visitor) {
  visitor(node);
  for (const child of node.children ?? []) eachNode(child, visitor);
}

/**
 * Offset ranges of every code node in `text`, merged and in document order.
 *
 * Covers fenced code blocks, indented code blocks and inline code spans —
 * exactly the constructs MDX leaves uninterpreted. The ranges come from a
 * parser rather than from a line scan, so an unterminated fence, a
 * tab-indented fence, a fence whose info string disqualifies it and a fence
 * nested in a list item are classified the way a parser classifies them
 * rather than the way a re-derived fence rule guesses.
 *
 * MDX's own grammar is tried first because it is the grammar that decides
 * what the site compiles; it rejects malformed JSX outright, so plain
 * CommonMark is the fallback. Either way the result is only a proposal —
 * escapeMdx() verifies it before trusting it.
 */
function codeRanges(text) {
  let tree;
  try {
    tree = parseMdx(text);
  } catch {
    tree = fromMarkdown(text);
  }
  const ranges = [];
  eachNode(tree, (node) => {
    if (
      (node.type === 'code' || node.type === 'inlineCode') &&
      node.position?.start?.offset !== undefined
    ) {
      ranges.push([node.position.start.offset, node.position.end.offset]);
    }
  });
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/**
 * Whether `text` still carries anything MDX would execute.
 *
 * Text that cannot be parsed as MDX counts as live: the grammar rejected it,
 * so nothing here can claim to know what it compiles to.
 */
function hasActiveMdx(text) {
  let tree;
  try {
    tree = parseMdx(text);
  } catch {
    return true;
  }
  let active = false;
  eachNode(tree, (node) => {
    if (MDX_ACTIVE_TYPES.has(node.type)) active = true;
  });
  return active;
}

/**
 * Escapes the MDX-active constructs in a run of plain (non-code) text.
 *
 * `import`/`export` are only ESM when they begin a block, but a line that is
 * merely indented less than four spaces is escaped regardless: the character
 * reference renders as the original letter either way, so over-escaping costs
 * nothing and removes the need to track block boundaries.
 */
function escapePlain(text) {
  return text
    .replace(/[{}]/g, (brace) => (brace === '{' ? '&#123;' : '&#125;'))
    .replace(/</g, '&lt;')
    .replace(
      /^([ \t]{0,3})(import|export)\b/gm,
      (_, indent, word) => `${indent}&#${word.charCodeAt(0)};${word.slice(1)}`,
    );
}

/**
 * Escapes MDX-active syntax in third-party prose, leaving code blocks and
 * inline code spans verbatim.
 *
 * Preserving code verbatim depends on correctly telling code from prose, and
 * a wrong answer in the direction of "this is code" hands live JSX straight
 * through. So the result is verified rather than assumed: if anything MDX
 * would execute survives, the text is re-escaped in full. Escaping
 * everything removes every `<` and `{`, so no JSX element, expression or ESM
 * statement can form, at the cost of showing character references inside a
 * code block — the safe trade for input that reached that branch at all.
 *
 * @param {string} text Untrusted Markdown prose.
 * @returns {string} Prose that the MDX compiler renders as text.
 */
export function escapeMdx(text) {
  if (typeof text !== 'string' || !text) return '';
  const out = [];
  let cursor = 0;
  for (const [start, end] of codeRanges(text)) {
    if (start > cursor) out.push(escapePlain(text.slice(cursor, start)));
    out.push(text.slice(start, end));
    cursor = end;
  }
  out.push(escapePlain(text.slice(cursor)));
  const escaped = out.join('');
  return hasActiveMdx(escaped) ? escapePlain(text) : escaped;
}

/**
 * Reverses escapeMdx() for consumers that want the author's characters rather
 * than MDX-safe source — a catalog summary, for example, is stored as JSON and
 * rendered as a plain text node, where a character reference would show
 * through literally.
 *
 * @param {string} text
 * @returns {string}
 */
export function unescapeMdx(text) {
  if (typeof text !== 'string' || !text) return '';
  return text.replace(/&#123;|&#125;|&lt;|&#105;|&#101;/g, (entity) =>
    ESCAPES.get(entity),
  );
}
