/**
 * Allowlist gate for generated Markdown that Docusaurus compiles as MDX.
 *
 * Architecture documentation is imported verbatim from a third-party
 * repository, and Docusaurus treats `.md` as MDX, so raw HTML/JSX in an
 * imported body is rendered into the published site rather than escaped. This
 * helper reports everything in a body that is not on its allowlist so a
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
 * Three allowlists decide what a page may contain, so a node kind, element,
 * attribute or URL scheme nobody has reviewed is rejected by default:
 *
 * - node types: {@link MARKDOWN_NODE_TYPES}, plus JSX elements and ESM, each
 *   checked further. MDX evaluates a braced expression as JavaScript, and an
 *   expression node is not on the list.
 * - JSX: the inert elements in {@link ALLOWED_ELEMENTS}, with no attributes,
 *   and the one component the importer emits with its
 *   {@link COMPONENT_ATTRIBUTES}, each a string literal. The only ESM allowed
 *   is that component's import.
 * - URL schemes: every link, image and definition destination, and every
 *   URL-valued component attribute, must carry a scheme on the allowlist in
 *   `./uri-safety.mjs` (http, https, mailto, or none).
 *
 * A fenced code block is allowed because MDX evaluates nothing inside one --
 * except for ```mdx-code-block, which Docusaurus unwraps into live MDX before
 * the compiler runs (see ./mdx-code-blocks.mjs). That fence is not a code
 * block at all, so it is a finding.
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
import { eachNode } from './mdast-walk.mjs';
import { isUnwrappedCodeBlock } from './mdx-code-blocks.mjs';
import {
  describeTarget,
  disallowedScheme,
  remoteTarget,
} from './uri-safety.mjs';

/**
 * mdast node types of CommonMark and GFM. Each compiles to inert HTML, and
 * none of them is an MDX construct. Shared with ./mdx-escape.mjs, whose output
 * must consist of nothing else.
 */
export const MARKDOWN_NODE_TYPES = new Set([
  'blockquote',
  'break',
  'code',
  'definition',
  'delete',
  'emphasis',
  'footnoteDefinition',
  'footnoteReference',
  'heading',
  'image',
  'imageReference',
  'inlineCode',
  'link',
  'linkReference',
  'list',
  'listItem',
  'paragraph',
  'root',
  'strong',
  'table',
  'tableCell',
  'tableRow',
  'text',
  'thematicBreak',
]);

/** MDX node types a page may contain, each checked further below. */
export const MDX_NODE_TYPES = new Set([
  'mdxJsxFlowElement',
  'mdxJsxTextElement',
  'mdxjsEsm',
]);

/**
 * Inert inline elements that carry no script, network or layout capability.
 * They take no attributes.
 */
export const ALLOWED_ELEMENTS = new Set([
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
export const ALLOWED_COMPONENT = 'CNCFProjectCard';

/** The attributes the importer writes on {@link ALLOWED_COMPONENT}. */
export const COMPONENT_ATTRIBUTES = new Set([
  'description',
  'href',
  'logo',
  'name',
  'since',
  'version',
]);

/**
 * Component attributes that hold a URL. `logo` reaches an `<img src>` through
 * `useBaseUrl()`, which returns a value carrying a protocol unchanged, so an
 * absolute URL there is loaded off-origin exactly as a Markdown image
 * destination is. `href` on the same card is remote by contract
 * (`https://www.cncf.io/projects/...`) and is followed only on a click.
 */
const URL_ATTRIBUTES = new Set(['href', 'logo']);
const REMOTE_IMAGE_ATTRIBUTES = new Set(['logo']);

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

/**
 * Scans a Markdown/MDX body for anything outside the allowlists, and for
 * images loaded from another host.
 *
 * @param {string} markdown - Document body to scan.
 * @param {{ mdastExtensions?: Array<object> }} [options] - Extra mdast
 *   extensions to parse with. A node kind they introduce is not on the
 *   allowlist, so it is reported rather than walked past.
 * @returns {Array<{ line: number, reason: string, snippet: string }>} One entry
 *   per finding, ordered by line.
 */
export function findActiveContent(markdown, { mdastExtensions = [] } = {}) {
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
    tree = fromMarkdown(text, {
      ...parserOptions,
      mdastExtensions: [...parserOptions.mdastExtensions, ...mdastExtensions],
    });
  } catch (error) {
    report(error.line ?? 1, `MDX parse error (${error.reason})`);
    return findings;
  }

  // Collected before the scan: a definition may be written after the
  // reference that uses it, and an `imageReference` carries only an
  // identifier. The definition node itself is never reported as remote --
  // `linkReference` resolves through the same map, and an imported page
  // legitimately carries remote link definitions.
  //
  // The FIRST definition of a repeated label wins, because that is the one the
  // published page uses: CommonMark specifies it, and mdast-util-to-hast --
  // which @mdx-js/mdx runs to compile the page -- fills its own map under
  // `if (!map.has(id))` to mimic it. Overwriting instead would make this scan
  // vouch for a destination the renderer discards, so a document carrying a
  // remote first definition and an inert second one would publish the remote
  // one unreported. A later duplicate is dead text the renderer ignores.
  const definitions = new Map();
  eachNode(tree, (node) => {
    if (node.type === 'definition' && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  });

  // Every caller passes a string: an image node's `url`, a definition `url`
  // resolved from the map, or an attribute value already narrowed to a string.
  const reportRemoteImage = (line, url) => {
    const target = remoteTarget(url);
    if (target)
      report(line, `remote image destination ${describeTarget(target)}`);
  };

  const reportScheme = (line, url) => {
    const scheme = disallowedScheme(url);
    if (scheme) report(line, `disallowed URL scheme ${scheme}`);
  };

  // Matched case-sensitively. MDX reads a lowercase tag name as an HTML
  // element and any other casing as a *component* reference, so `<B>` is not
  // the inert `<b>` the allowlist names -- it compiles to a lookup of a
  // component named `B`, which no provider defines, and Docusaurus throws
  // "Expected component `B` to be defined" while prerendering the page.
  const reportElement = (line, node) => {
    const name = node.name ?? '';
    const attributes =
      name === ALLOWED_COMPONENT
        ? COMPONENT_ATTRIBUTES
        : ALLOWED_ELEMENTS.has(name)
          ? new Set()
          : null;
    if (!attributes) {
      report(line, `disallowed element <${name}>`);
      return;
    }
    for (const attribute of node.attributes) {
      if (attribute.type === 'mdxJsxExpressionAttribute') {
        report(line, 'MDX expression');
        continue;
      }
      if (!attributes.has(attribute.name)) {
        report(line, `disallowed attribute ${attribute.name} on <${name}>`);
        continue;
      }
      let value = attribute.value;
      if (value && typeof value === 'object') {
        value = literalValue(value.value);
        if (value === null) report(line, 'MDX expression');
      }
      if (typeof value === 'string' && URL_ATTRIBUTES.has(attribute.name)) {
        reportScheme(line, value);
        if (REMOTE_IMAGE_ATTRIBUTES.has(attribute.name)) {
          reportRemoteImage(line, value);
        }
      }
    }
  };

  eachNode(tree, (node) => {
    const line = node.position.start.line;

    if (MARKDOWN_NODE_TYPES.has(node.type)) {
      if (node.type === 'imageReference') {
        const url = definitions.get(node.identifier);
        // An unresolved reference renders as literal text and loads nothing.
        if (url !== undefined) reportRemoteImage(line, url);
      } else if (node.type === 'code' && isUnwrappedCodeBlock(text, node)) {
        report(
          line,
          'mdx-code-block fence, whose body Docusaurus compiles as MDX rather than displaying as code',
        );
      } else if (URL_NODES.has(node.type)) {
        reportScheme(line, node.url);
        if (node.type === 'image') reportRemoteImage(line, node.url);
      }
    } else if (node.type === 'mdxjsEsm') {
      if (node.value.trim() !== ALLOWED_IMPORT) {
        report(line, 'unexpected ESM statement');
      }
    } else if (MDX_NODE_TYPES.has(node.type)) {
      reportElement(line, node);
    } else {
      report(
        line,
        node.type.startsWith('mdx') && node.type.endsWith('Expression')
          ? 'MDX expression'
          : `disallowed node type ${node.type}`,
      );
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
