/**
 * Active-content detection for generated Markdown that Docusaurus compiles as
 * MDX.
 *
 * Architecture documentation is imported verbatim from a third-party
 * repository, and Docusaurus treats `.md` as MDX, so raw HTML/JSX in an
 * imported body is rendered into the published site rather than escaped.  This
 * helper reports the constructs that can execute or load remote code so a
 * validator can fail the build before such a body ships.
 *
 * MDX evaluates a braced expression as JavaScript, so `{fetch(...)}` in an
 * imported body is live code and not prose; every `{` is therefore a finding
 * unless it is one of the inert string-literal attributes the importer emits
 * itself.  The check is deliberately fail-closed: literal braces in upstream
 * prose are reported rather than assumed harmless.
 *
 * Scheme detection normalizes each line before testing it, because CommonMark
 * decodes character references in a link destination: `java&#115;cript:` is a
 * live `javascript:` href by the time the page renders.
 */

/** Inert inline elements that carry no script, network or layout capability. */
const ALLOWED_ELEMENTS = new Set([
  'b',
  'br',
  'code',
  'em',
  'hr',
  'i',
  'kbd',
  'p',
  'small',
  'strong',
  'sub',
  'sup',
  'u',
]);

/** The component the importer itself renders into every architecture page. */
const ALLOWED_COMPONENT = 'CNCFProjectCard';

const ALLOWED_IMPORT =
  "import CNCFProjectCard from '@site/src/components/CNCFProjectCard';";

/**
 * The one expression form the importer itself emits: an attribute whose value
 * is a single JSON string literal, as produced by `jsxAttribute`
 * (`scripts/lib/jsx-attributes.mjs`).  The pattern requires the closing brace
 * to follow the closing quote immediately, so the braces can enclose nothing
 * but the literal -- `{"a" + fetch(x)}` does not match.  An expression whose
 * entire body is a string literal evaluates to that string and has no call,
 * member access or identifier reference available to it, so it is inert
 * wherever it appears.
 */
const ALLOWED_ATTRIBUTE_EXPRESSION =
  /(?<=\s)[A-Za-z_$][A-Za-z0-9_$-]*=\{"(?:[^"\\]|\\.)*"\}/g;

/**
 * Any remaining `{` opens an MDX expression, which is evaluated JavaScript.
 */
const EXPRESSION_PATTERN = /\{/;

const ELEMENT_PATTERN = /<\/?([A-Za-z][A-Za-z0-9._-]*)/g;
const EVENT_HANDLER_PATTERN = /\bon[a-z]{3,}\s*=/gi;
const DANGEROUS_URL_PATTERN = /(?:javascript|vbscript):|data:text\/html/gi;
const ESM_PATTERN = /^\s*(?:import|export)\s/;

/** The character references a scheme can hide a character behind by name. */
const NAMED_ENTITIES = {
  colon: ':',
  tab: '\t',
  newline: '\n',
  lf: '\n',
  sol: '/',
  amp: '&',
};

/**
 * Decode the HTML character references a scheme may hide behind.  MDX is
 * CommonMark, which decodes references in a link destination, so
 * `[x](java&#115;cript:alert(1))` is a live `javascript:` href by the time it
 * renders and a raw substring test never sees it.
 *
 * @param {string} value
 * @returns {string}
 */
function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (match, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    })
    .replace(/&#(\d+);?/g, (match, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    })
    .replace(
      /&([a-z]+);?/gi,
      (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
    );
}

/**
 * Collapse a line to the form a browser's URL parser sees.  Control characters
 * (tab included) go because a URL parser ignores them; the space character is
 * deliberately kept, since a browser does not read `java script:` as a scheme
 * and removing it would flag ordinary prose.
 *
 * @param {string} line
 * @returns {string}
 */
function normalizeSchemes(line) {
  // Decode twice: some generators emit double-encoded references (&amp;#58;).
  // eslint-disable-next-line no-control-regex
  return decodeEntities(decodeEntities(line)).replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]+/g,
    '',
  );
}

/**
 * Replaces fenced code blocks and inline code spans with blank padding.  MDX
 * does not evaluate either, and keeping the line count and line lengths
 * stable lets findings report accurate line numbers.
 *
 * Both passes are written to agree with the CommonMark/MDX parser Docusaurus
 * actually compiles the body with, rather than approximating it with a
 * single regular expression -- see #611 for the exploit a mismatch allowed.
 *
 * @param {string} markdown
 * @returns {string}
 */
function blankCodeSpans(markdown) {
  return blankInlineSpans(blankFences(markdown));
}

/**
 * Blank fenced code blocks by walking lines and tracking fence state, rather
 * than matching the whole block with one lazy regex. A closing fence must use
 * the same character as the opener, be at least as long, and carry nothing
 * but trailing whitespace after it; a fence that is never closed runs to EOF.
 *
 * @param {string} markdown
 * @returns {string}
 */
function blankFences(markdown) {
  const lines = markdown.split('\n');
  const output = [];
  let fenceChar = null;
  let fenceLength = 0;

  for (const line of lines) {
    if (fenceChar) {
      output.push(' '.repeat(line.length));
      const closer = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
      if (
        closer &&
        closer[1][0] === fenceChar &&
        closer[1].length >= fenceLength
      ) {
        fenceChar = null;
        fenceLength = 0;
      }
      continue;
    }

    const opener = line.match(/^[ \t]*(`{3,}|~{3,})([^\n]*)$/);
    // A backtick fence's info string may not contain a backtick (CommonMark);
    // a line like "```<script>x</script>`" therefore opens no fence at all --
    // it is a paragraph, and the element in it is live. Treating it as a
    // fence would blank it (and everything after it) unscanned, which is a
    // bypass, not a false positive. A tilde fence has no such restriction.
    if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) {
      fenceChar = opener[1][0];
      fenceLength = opener[1].length;
      output.push(' '.repeat(line.length));
      continue;
    }

    output.push(line);
  }

  return output.join('\n');
}

/**
 * Blank inline code spans by scanning for a backtick run and searching the
 * rest of its line for a closing run of *exactly* the same length -- the
 * CommonMark rule a single `` `+...`+ `` regex cannot express, because it
 * accepts mismatched run lengths and forms a span that does not exist. The
 * search is deliberately bounded to the current line: a code span that wraps
 * a newline is left scannable, which errs toward reporting rather than
 * hiding content.
 *
 * @param {string} text
 * @returns {string}
 */
function blankInlineSpans(text) {
  let result = '';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch !== '`') {
      result += ch;
      i += 1;
      continue;
    }

    let openEnd = i;
    while (text[openEnd] === '`') openEnd += 1;
    const openLength = openEnd - i;

    let k = openEnd;
    let closeStart = -1;
    let closeEnd = -1;
    while (k < text.length && text[k] !== '\n') {
      if (text[k] === '`') {
        let runEnd = k;
        while (text[runEnd] === '`') runEnd += 1;
        if (runEnd - k === openLength) {
          closeStart = k;
          closeEnd = runEnd;
          break;
        }
        k = runEnd;
        continue;
      }
      k += 1;
    }

    if (closeStart === -1) {
      // No closing run of matching length on this line: not a code span, so
      // emit the opening backticks as literal text and keep scanning from
      // just past them.
      result += text.slice(i, openEnd);
      i = openEnd;
      continue;
    }

    result += ' '.repeat(closeEnd - i);
    i = closeEnd;
  }

  return result;
}

/**
 * Neutralize the braces of the importer's own attribute expressions so the
 * expression scan does not flag generated markup.  Only the `{` and `}`
 * characters are replaced, by a space each: the quoted value between them is
 * left in place so the scheme, handler and element scans still read it, and
 * the line keeps its length so findings keep accurate line numbers.
 *
 * @param {string} text
 * @returns {string}
 */
function blankAllowedExpressions(text) {
  return text.replace(ALLOWED_ATTRIBUTE_EXPRESSION, (match) =>
    match.replace(/[{}]/g, ' '),
  );
}

/**
 * Scans a Markdown/MDX body for content that executes or loads remote code.
 *
 * @param {string} markdown - Document body to scan.
 * @returns {Array<{ line: number, reason: string, snippet: string }>} One entry
 *   per finding, ordered by line.
 */
export function findActiveContent(markdown) {
  const findings = [];
  const scannable = blankAllowedExpressions(
    blankCodeSpans(String(markdown ?? '')),
  );
  const lines = scannable.split('\n');

  lines.forEach((line, index) => {
    const number = index + 1;
    const snippet = line.trim().slice(0, 120);

    for (const match of line.matchAll(ELEMENT_PATTERN)) {
      const name = match[1];
      const isAllowed =
        name === ALLOWED_COMPONENT || ALLOWED_ELEMENTS.has(name.toLowerCase());
      if (!isAllowed)
        findings.push({
          line: number,
          reason: `disallowed element <${name}>`,
          snippet,
        });
    }

    if (EVENT_HANDLER_PATTERN.test(line))
      findings.push({
        line: number,
        reason: 'event handler attribute',
        snippet,
      });
    EVENT_HANDLER_PATTERN.lastIndex = 0;

    const dangerous = [line, normalizeSchemes(line)].some((candidate) => {
      DANGEROUS_URL_PATTERN.lastIndex = 0;
      return DANGEROUS_URL_PATTERN.test(candidate);
    });
    DANGEROUS_URL_PATTERN.lastIndex = 0;
    if (dangerous)
      findings.push({
        line: number,
        reason: 'script-capable URL scheme',
        snippet,
      });

    if (ESM_PATTERN.test(line) && line.trim() !== ALLOWED_IMPORT)
      findings.push({
        line: number,
        reason: 'unexpected ESM statement',
        snippet,
      });

    if (EXPRESSION_PATTERN.test(line))
      findings.push({
        line: number,
        reason: 'MDX expression',
        snippet,
      });
  });

  const seen = new Set();
  return findings
    .filter((finding) => {
      const key = `${finding.line}:${finding.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.line - b.line);
}
