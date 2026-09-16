/**
 * Active-content detection for generated Markdown that Docusaurus compiles as
 * MDX.
 *
 * Architecture documentation is imported verbatim from a third-party
 * repository, and Docusaurus treats `.md` as MDX, so raw HTML/JSX in an
 * imported body is rendered into the published site rather than escaped.  This
 * helper reports the constructs that can execute or load remote code so a
 * validator can fail the build before such a body ships.
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

    if (DANGEROUS_URL_PATTERN.test(line))
      findings.push({
        line: number,
        reason: 'script-capable URL scheme',
        snippet,
      });
    DANGEROUS_URL_PATTERN.lastIndex = 0;

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
