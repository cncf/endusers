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
 * MDX does not evaluate anything inside a fenced code block or an inline code
 * span, so those are passed through untouched: an architecture description
 * that shows a YAML or JSON snippet must keep its braces verbatim.
 *
 * Everything escaped here is replaced by a character reference that renders
 * as the original character, so escaped prose displays exactly as written.
 */

/** A fence opener/closer: up to three spaces, then three or more ` or ~. */
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/**
 * An autolink — `<https://example.com>` or `<user@example.com>`. These are
 * plain CommonMark rather than JSX, and their body cannot contain `<`, `>` or
 * whitespace, so they can be recognized and preserved rather than escaped.
 */
const AUTOLINK =
  /<[A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*>|<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>/;

const ESCAPES = new Map([
  ['&#123;', '{'],
  ['&#125;', '}'],
  ['&lt;', '<'],
  ['&#105;', 'i'],
  ['&#101;', 'e'],
]);

/**
 * Splits text into fenced-code and non-code segments.
 *
 * An unterminated fence runs to the end of the text, which is both what
 * CommonMark does and the safe reading: the remainder is code, so it is
 * inert and left alone.
 */
function splitFences(text) {
  const segments = [];
  let buffer = [];
  let fence = null;
  const flush = (code) => {
    if (buffer.length) segments.push({ code, text: buffer.join('\n') });
    buffer = [];
  };
  for (const line of text.split('\n')) {
    if (fence) {
      buffer.push(line);
      const closer = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
      if (
        closer &&
        closer[1][0] === fence[0] &&
        closer[1].length >= fence.length
      ) {
        flush(true);
        fence = null;
      }
      continue;
    }
    const opener = line.match(FENCE);
    if (opener) {
      flush(false);
      fence = opener[1];
      buffer.push(line);
      continue;
    }
    buffer.push(line);
  }
  flush(fence !== null);
  return segments;
}

/**
 * Splits a non-fenced segment into inline code spans and plain text. A
 * backtick run with no matching closer of the same length is not a code span
 * and stays plain.
 */
function splitCodeSpans(text) {
  const parts = [];
  let plain = '';
  let index = 0;
  const flushPlain = () => {
    if (plain) parts.push({ code: false, text: plain });
    plain = '';
  };
  const runLength = (at) => {
    let length = 0;
    while (text[at + length] === '`') length += 1;
    return length;
  };
  while (index < text.length) {
    if (text[index] !== '`') {
      plain += text[index];
      index += 1;
      continue;
    }
    const opener = runLength(index);
    let cursor = index + opener;
    let close = -1;
    while (cursor < text.length) {
      if (text[cursor] !== '`') {
        cursor += 1;
        continue;
      }
      const run = runLength(cursor);
      if (run === opener) {
        close = cursor;
        break;
      }
      cursor += run;
    }
    if (close === -1) {
      plain += text.slice(index, index + opener);
      index += opener;
      continue;
    }
    flushPlain();
    parts.push({ code: true, text: text.slice(index, close + opener) });
    index = close + opener;
  }
  flushPlain();
  return parts;
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
    .replace(new RegExp(`${AUTOLINK.source}|<`, 'g'), (match) =>
      match === '<' ? '&lt;' : match,
    )
    .replace(
      /^([ \t]{0,3})(import|export)\b/gm,
      (_, indent, word) => `${indent}&#${word.charCodeAt(0)};${word.slice(1)}`,
    );
}

/**
 * Escapes MDX-active syntax in third-party prose, leaving fenced code blocks
 * and inline code spans verbatim.
 *
 * @param {string} text Untrusted Markdown prose.
 * @returns {string} Prose that the MDX compiler renders as text.
 */
export function escapeMdx(text) {
  if (typeof text !== 'string' || !text) return '';
  return splitFences(text)
    .map((segment) =>
      segment.code
        ? segment.text
        : splitCodeSpans(segment.text)
            .map((part) => (part.code ? part.text : escapePlain(part.text)))
            .join(''),
    )
    .join('\n');
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
  return text.replace(
    /&#123;|&#125;|&lt;|&#105;|&#101;/g,
    (entity) => ESCAPES.get(entity) ?? entity,
  );
}
