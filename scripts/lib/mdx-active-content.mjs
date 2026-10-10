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
 *
 * The scan answers the second of the two questions `uri-safety.mjs` states
 * both gates must answer -- does the value make a visitor's browser contact
 * another host -- only for destinations the browser fetches with no user
 * action, which on this surface means images. An imported page is written
 * verbatim from a repository this project does not control, so a remote `<img>`
 * in one is a third-party beacon that sees every visitor's IP, User-Agent and
 * Referer on page load. `rewriteImages()` already demotes such a destination at
 * import time, but that is a gate on what is *imported*; this is the gate on
 * what is *published*, and it has to hold when a page reaches `docs/` without
 * passing the importer.
 *
 * Ordinary links are deliberately left alone. A link is followed only when a
 * reader clicks it, and `rewriteImages()` demotes a remote image *to* a remote
 * link, so rejecting them would reject every imported page.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxjs } from 'micromark-extension-mdxjs';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { activeScheme, describeTarget, remoteTarget } from './uri-safety.mjs';

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

/**
 * The only attribute of the only allowed component that reaches an `<img src>`.
 *
 * `CNCFProjectCard` renders `logo` through `useBaseUrl()`, which returns a
 * value carrying a protocol unchanged, so an absolute URL there is loaded
 * off-origin exactly as a Markdown image destination is. `href` on the same
 * card is remote by contract (`https://www.cncf.io/projects/...`) and is
 * followed only on a click, so attributes are checked by name rather than as a
 * class.
 */
const REMOTE_IMAGE_ATTRIBUTES = new Set(['logo']);

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

  // Collected before the scan: a definition may be written after the
  // reference that uses it, and an `imageReference` carries only an
  // identifier. The definition node itself is never reported as remote --
  // `linkReference` resolves through the same map, and an imported page
  // legitimately carries remote link definitions.
  const definitions = new Map();
  eachNode(tree, (node) => {
    if (node.type === 'definition') definitions.set(node.identifier, node.url);
  });

  // Every caller passes a string: an image node's `url`, a definition `url`
  // resolved from the map, or an attribute value already narrowed to a string.
  const reportRemoteImage = (line, url) => {
    const target = remoteTarget(url);
    if (target)
      report(line, `remote image destination ${describeTarget(target)}`);
  };

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
        if (typeof value === 'string') {
          if (activeScheme(value)) {
            report(line, 'script-capable URL scheme');
          }
          if (REMOTE_IMAGE_ATTRIBUTES.has(attribute.name)) {
            reportRemoteImage(line, value);
          }
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
    } else if (node.type === 'imageReference') {
      const url = definitions.get(node.identifier);
      // An unresolved reference renders as literal text and loads nothing.
      if (url !== undefined) reportRemoteImage(line, url);
    } else if (URL_NODES.has(node.type)) {
      if (activeScheme(node.url)) report(line, 'script-capable URL scheme');
      if (node.type === 'image') reportRemoteImage(line, node.url);
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
