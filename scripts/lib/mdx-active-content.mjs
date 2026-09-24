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

/**
 * Replaces fenced code blocks and inline code spans with blank padding.  MDX
 * does not evaluate either, and keeping the line count stable lets findings
 * report accurate line numbers.
 *
 * @param {string} markdown
 * @returns {string}
 */
function blankCodeSpans(markdown) {
  const blanked = markdown.replace(
    /^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\2[^\n]*$|$)/gm,
    (block) => block.replace(/[^\n]/g, ' '),
  );
  return blanked.replace(/`+[^`\n]*`+/g, (span) => ' '.repeat(span.length));
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
