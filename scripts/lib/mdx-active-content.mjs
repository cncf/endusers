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

const FENCE_OPEN_PATTERN = /^[ \t]*(`{3,}|~{3,})([^\n]*)$/;
const FENCE_CLOSE_PATTERN = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

/**
 * Replaces a line's content with spaces, preserving its length so findings keep
 * reporting accurate columns and the line count never shifts.
 *
 * @param {string} line
 * @returns {string}
 */
function blankLine(line) {
  return ' '.repeat(line.length);
}

/**
 * Blanks the inline code spans on a single line.
 *
 * CommonMark closes a code span only with a backtick run of exactly the same
 * length as the one that opened it, so `` ``x` `` is literal text — live JSX by
 * the time MDX renders it.  A pattern that accepts any closing run (`` `+ `` …
 * `` `+ ``) blanks that payload and hands the scanner an empty line, which is a
 * bypass rather than a false positive.  Backticks that open nothing are emitted
 * literally so the rest of the line stays scannable.
 *
 * The search is deliberately line-bounded.  A real code span may wrap a
 * newline; refusing to blank across one leaves such content scannable, which
 * errs toward reporting.
 *
 * @param {string} line
 * @returns {string}
 */
function blankInlineCode(line) {
  let result = '';
  let index = 0;

  while (index < line.length) {
    if (line[index] !== '`') {
      result += line[index];
      index += 1;
      continue;
    }

    const openStart = index;
    while (line[index] === '`') index += 1;
    const runLength = index - openStart;

    let cursor = index;
    let closeEnd = -1;
    while (cursor < line.length) {
      if (line[cursor] !== '`') {
        cursor += 1;
        continue;
      }
      const runStart = cursor;
      while (line[cursor] === '`') cursor += 1;
      if (cursor - runStart === runLength) {
        closeEnd = cursor;
        break;
      }
    }

    if (closeEnd === -1) {
      result += line.slice(openStart, index);
      continue;
    }

    result += ' '.repeat(closeEnd - openStart);
    index = closeEnd;
  }

  return result;
}

/**
 * Replaces fenced code blocks and inline code spans with blank padding.  MDX
 * does not evaluate either, and keeping the line count stable lets findings
 * report accurate line numbers.
 *
 * Fences are tracked line by line rather than matched by one expression: a lazy
 * `[\s\S]*?` closed by an alternation containing `$` under the `m` flag ends at
 * the first end-of-line it reaches, which blanks one line of a block instead of
 * all of it and reports the rest of an inert block as findings.
 *
 * @param {string} markdown
 * @returns {string}
 */
function blankCodeSpans(markdown) {
  let openMarker = null;

  return String(markdown)
    .split('\n')
    .map((line) => {
      if (openMarker) {
        const close = FENCE_CLOSE_PATTERN.exec(line);
        if (
          close &&
          close[1][0] === openMarker[0] &&
          close[1].length >= openMarker.length
        )
          openMarker = null;
        return blankLine(line);
      }

      const open = FENCE_OPEN_PATTERN.exec(line);
      // A backtick fence's info string may not contain a backtick, so
      // ```` ```<script>x</script>` ```` opens no block: it is a paragraph, and
      // the element in it is live. Treating it as a fence would blank the rest
      // of the document.
      if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
        openMarker = open[1];
        return blankLine(line);
      }

      return blankInlineCode(line);
    })
    .join('\n');
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
  const scannable = blankCodeSpans(String(markdown ?? ''));
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
