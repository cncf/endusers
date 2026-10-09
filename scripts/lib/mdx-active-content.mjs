/**
 * Active-content detection for generated Markdown that Docusaurus compiles as
 * MDX.
 *
 * Architecture documentation is imported verbatim from a third-party
 * repository, and Docusaurus treats `.md` as MDX, so raw HTML/JSX in an
 * imported body is rendered into the published site rather than escaped. This
 * helper reports the constructs that can execute or load remote code so a
 * validator can fail the build before such a body ships.
 *
 * The body is parsed with the grammar Docusaurus compiles pages with (MDX plus
 * GFM) and the resulting tree is inspected, rather than the text being
 * pattern-matched. What counts as code, which backticks pair, where a JSX tag
 * ends and how a link destination is decoded are therefore decided by the same
 * parser the site uses, not by an approximation of it. Text the parser rejects
 * is a finding: Docusaurus cannot compile it either, and a scan that cannot
 * read a document cannot vouch for it.
 *
 * MDX evaluates a braced expression as JavaScript, so any expression node is a
 * finding unless it is one of the inert string-literal attributes the importer
 * emits itself.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxjs } from 'micromark-extension-mdxjs';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { activeScheme } from './uri-safety.mjs';

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
 * (`scripts/lib/jsx-attributes.mjs`). An expression whose entire body is a
 * string literal evaluates to that string and has no call, member access or
 * identifier reference available to it, so it is inert wherever it appears.
 */
const STRING_LITERAL_EXPRESSION = /^"(?:[^"\\\n]|\\.)*"$/;

const EVENT_HANDLER_ATTRIBUTE = /^on[a-z]+$/i;

/** Link-like nodes whose `url` a browser navigates to or loads. */
const URL_NODES = new Set(['link', 'definition', 'image']);

const parserOptions = {
  extensions: [mdxjs(), gfm()],
  mdastExtensions: [mdxFromMarkdown(), gfmFromMarkdown()],
};

/**
 * The value an inert string-literal expression evaluates to, or null when the
 * expression is anything else.
 *
 * @param {string} expression
 * @returns {string | null}
 */
function literalValue(expression) {
  const trimmed = expression.trim();
  if (!STRING_LITERAL_EXPRESSION.test(trimmed)) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function eachNode(node, visitor) {
  visitor(node);
  for (const child of node.children ?? []) eachNode(child, visitor);
}

/**
 * Scans a Markdown/MDX body for content that executes or loads remote code.
 *
 * @param {string} markdown - Document body to scan.
 * @returns {Array<{ line: number, reason: string, snippet: string }>} One entry
 *   per finding, ordered by line.
 */
export function findActiveContent(markdown) {
  const text = String(markdown ?? '');
  const lines = text.split('\n');
  const findings = [];
  const report = (line, reason) =>
    findings.push({
      line,
      reason,
      snippet: lines[line - 1].trim().slice(0, 120),
    });

  let tree;
  try {
    tree = fromMarkdown(text, parserOptions);
  } catch (error) {
    report(error.line ?? 1, `MDX parse error (${error.reason})`);
    return findings;
  }

  eachNode(tree, (node) => {
    const line = node.position.start.line;

    if (
      node.type === 'mdxJsxFlowElement' ||
      node.type === 'mdxJsxTextElement'
    ) {
      const name = node.name ?? '';
      const allowed =
        name === ALLOWED_COMPONENT || ALLOWED_ELEMENTS.has(name.toLowerCase());
      if (!allowed) report(line, `disallowed element <${name}>`);

      for (const attribute of node.attributes) {
        if (attribute.type === 'mdxJsxExpressionAttribute') {
          report(line, 'MDX expression');
          continue;
        }
        if (EVENT_HANDLER_ATTRIBUTE.test(attribute.name)) {
          report(line, 'event handler attribute');
        }
        let value = attribute.value;
        if (value && typeof value === 'object') {
          value = literalValue(value.value);
          if (value === null) report(line, 'MDX expression');
        }
        if (typeof value === 'string' && activeScheme(value)) {
          report(line, 'script-capable URL scheme');
        }
      }
    } else if (
      node.type === 'mdxFlowExpression' ||
      node.type === 'mdxTextExpression'
    ) {
      report(line, 'MDX expression');
    } else if (node.type === 'mdxjsEsm') {
      if (node.value.trim() !== ALLOWED_IMPORT) {
        report(line, 'unexpected ESM statement');
      }
    } else if (URL_NODES.has(node.type) && activeScheme(node.url)) {
      report(line, 'script-capable URL scheme');
    }
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
