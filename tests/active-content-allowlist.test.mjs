// Property tests for the SVG and MDX allowlist gates, plus the historical
// bypasses of the denylists they replaced, kept as named rows.
//
// The generators draw element, attribute, namespace and URL-scheme names from
// a mix of allowlisted, known-dangerous and arbitrary strings. The oracle is a
// separate walk of the gate's output with the same parser the gate uses, so a
// name or scheme the allowlist never mentions has to be removed or reported
// for the property to hold. Seed and run count are fixed so CI is
// deterministic.
import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import sax from 'sax';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxjs } from 'micromark-extension-mdxjs';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import * as svgGate from '../scripts/lib/svg-active-content.mjs';
import * as mdxGate from '../scripts/lib/mdx-active-content.mjs';
import { escapeMdx } from '../scripts/lib/mdx-escape.mjs';
import { eachNode } from '../scripts/lib/mdast-walk.mjs';
import { isUnwrappedCodeBlock } from '../scripts/lib/mdx-code-blocks.mjs';
import { disallowedScheme } from '../scripts/lib/uri-safety.mjs';

const RUNS = { seed: 1718, numRuns: 300 };

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

const pick = (...values) => fc.constantFrom(...values);
const word = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{0,7}$/);
const scheme = fc.oneof(
  pick('javascript', 'vbscript', 'data', 'blob', 'ftp', 'http', 'mailto'),
  fc.stringMatching(/^[a-z][a-z0-9+.-]{0,6}$/),
);
const url = fc.oneof(
  scheme.map((name) => `${name}:x`),
  // A parenthesis inside an unquoted url() makes the CSS token malformed.
  scheme.map((name) => `${name}:x(1)`),
  word.map((type) => `data:image/${type},x`),
  {
    arbitrary: pick(
      '#a',
      '/img/a.png',
      'data:image/png;base64,AA',
      'https://h/x',
    ),
    weight: 3,
  },
);
const xmlEscape = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// --- SVG -------------------------------------------------------------------

const svgName = fc.oneof(
  { arbitrary: pick(...svgGate.SVG_ELEMENTS), weight: 6 },
  pick('script', 'set', 'animate', 'feImage', 'iframe', 'object', 'p:script'),
  word,
);
const svgAttribute = fc.tuple(
  fc.oneof(
    {
      arbitrary: pick(...svgGate.SVG_ATTRIBUTES, 'xlink:href', 'xml:space'),
      weight: 6,
    },
    pick('xml:base', 'p:href'),
    pick('onload', 'src', 'srcset', 'action', 'formaction', 'cursor'),
    pick('datasrc', 'data-x', 'dataformatas'),
    word,
  ),
  fc.oneof(
    url,
    url.map((value) => `url(${value})`),
    url.map((value) => `fill:url('${value}')`),
  ),
);
const svgNamespace = pick(
  SVG_NS,
  SVG_NS,
  XHTML_NS,
  'http://www.inkscape.org/namespaces/inkscape',
  'http://evil.example/ns',
  '',
);
const { svgTree } = fc.letrec((tie) => ({
  svgTree: fc
    .record({
      name: svgName,
      namespace: fc.option(svgNamespace, { nil: undefined }),
      attributes: fc.uniqueArray(svgAttribute, {
        maxLength: 3,
        selector: ([name]) => name,
      }),
      style: fc.option(url, { nil: undefined }),
      children: fc.oneof(
        { maxDepth: 3 },
        fc.constant([]),
        fc.array(tie('svgTree'), { maxLength: 3 }),
      ),
    })
    .map(({ name, namespace, attributes, style, children }) => {
      const declared = namespace === undefined ? '' : ` xmlns="${namespace}"`;
      const attrs = attributes
        .map(([key, value]) => ` ${key}="${xmlEscape(value)}"`)
        .join('');
      const css = style
        ? `<style>a{fill:url("${xmlEscape(style)}")}</style>`
        : '';
      return `<${name}${declared}${attrs}>${css}${children.join('')}</${name}>`;
    }),
}));

const SVG_OPEN = `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">`;
// Declares the `p:` prefix the generators use, which is itself off the list.
const SVG_OPEN_P = `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" xmlns:p="http://evil.example/p">`;

function attributeAllowed(element, { uri, local, value }) {
  if (uri === 'http://www.w3.org/2000/xmlns/') return true;
  if (uri === XLINK_NS) return svgGate.XLINK_ATTRIBUTES.has(local);
  if (uri === XML_NS) return svgGate.XML_ATTRIBUTES.has(local);
  if (uri) return svgGate.METADATA_NAMESPACES.has(uri);
  if (/^data-/.test(local)) return true;
  if (element.uri === SVG_NS) {
    return (
      svgGate.SVG_ATTRIBUTES.has(local) ||
      (element.local === 'svg' && svgGate.SVG_ROOT_ATTRIBUTES.has(local))
    );
  }
  if (element.uri === XHTML_NS) return svgGate.XHTML_ATTRIBUTES.has(local);
  return svgGate.METADATA_ATTRIBUTES.has(local) && value !== undefined;
}

/** Everything in `source` that is outside the SVG allowlists. */
function svgViolations(source) {
  const violations = [];
  const raster = { rasterData: true };
  const urlsIn = (value) =>
    [...value.matchAll(/url\(\s*['"]?([^'")]*)/gi)].map((match) => match[1]);
  const parser = sax.parser(true, { xmlns: true });
  parser.onopentag = (tag) => {
    const allowed =
      (tag.uri === SVG_NS && svgGate.SVG_ELEMENTS.has(tag.local)) ||
      (tag.uri === XHTML_NS && svgGate.XHTML_ELEMENTS.has(tag.local)) ||
      svgGate.METADATA_NAMESPACES.has(tag.uri);
    if (!allowed) violations.push(`<${tag.name}>`);
    for (const attribute of Object.values(tag.attributes)) {
      if (!attributeAllowed(tag, attribute)) violations.push(attribute.name);
      const urls = urlsIn(attribute.value);
      if (attribute.local === 'href') urls.push(attribute.value);
      for (const value of urls) {
        if (disallowedScheme(value, raster)) violations.push(value);
      }
    }
  };
  parser.ontext = (text) => {
    for (const value of urlsIn(text)) {
      if (disallowedScheme(value, raster)) violations.push(value);
    }
  };
  parser.write(source).close();
  return violations;
}

test('stripActiveContent output contains nothing outside the SVG allowlists', () => {
  fc.assert(
    fc.property(
      pick(SVG_OPEN, SVG_OPEN_P),
      fc.array(svgTree, { maxLength: 3 }),
      (open, children) => {
        const source = `${open}${children.join('')}</svg>`;
        let output;
        try {
          output = svgGate.stripActiveContent(source).source;
        } catch (error) {
          // Failing closed is an allowed outcome; publishing is not.
          assert.match(
            error.message,
            /^(Could not strip|Active content survived)/,
          );
          return;
        }
        assert.deepEqual(svgViolations(output), []);
        assert.deepEqual(svgGate.findActiveContent(output), []);
        // The detector and the stripper agree: a clean input is left untouched.
        if (svgGate.findActiveContent(source).length === 0) {
          assert.equal(output, source);
        }
      },
    ),
    RUNS,
  );
});

// --- MDX -------------------------------------------------------------------

const GRAMMAR = {
  extensions: [mdxjs(), gfm()],
  mdastExtensions: [mdxFromMarkdown(), gfmFromMarkdown()],
};
const IMPORT =
  "import CNCFProjectCard from '@site/src/components/CNCFProjectCard';";

const mdxName = fc.oneof(
  { arbitrary: pick(mdxGate.ALLOWED_COMPONENT), weight: 3 },
  pick(...mdxGate.ALLOWED_ELEMENTS),
  pick('script', 'img', 'iframe', 'B', 'div'),
  word,
);
const mdxAttribute = fc.tuple(
  fc.oneof(
    { arbitrary: pick(...mdxGate.COMPONENT_ATTRIBUTES), weight: 4 },
    pick('onClick', 'style'),
    word,
  ),
  fc.oneof(
    url.map((value) => `"${value}"`),
    url.map((value) => `{${JSON.stringify(value)}}`),
    pick('{x}', '{"a" + b}', '{`t`}'),
  ),
);
const mdxBlock = fc.oneof(
  {
    arbitrary: fc
      .tuple(mdxName, fc.array(mdxAttribute, { maxLength: 2 }))
      .map(([name, attributes]) => {
        const attrs = attributes
          .map(([key, value]) => ` ${key}=${value}`)
          .join('');
        return `<${name}${attrs}>x</${name}>`;
      }),
    weight: 5,
  },
  fc
    .tuple(pick('[x]', '![x]'), url)
    .map(([kind, value]) => `${kind}(${value})`),
  url.map((value) => `[d]: ${value}\n\n[d]`),
  fc
    .tuple(pick('mdx-code-block', 'js', '', 'mdx-code-blockish'), word)
    .map(([info, body]) => `\`\`\`${info}\n<${body}/>\n\`\`\``),
  pick(IMPORT, 'export const x = 1;', '{1 + 1}', '$x$', '<!-- c -->'),
  word,
);
const mdxBody = fc
  .tuple(fc.boolean(), fc.array(mdxBlock, { minLength: 1, maxLength: 4 }))
  .map(([imported, blocks]) =>
    (imported ? [IMPORT, ...blocks] : blocks).join('\n\n'),
  );

/** Everything in `body` that is outside the MDX allowlists. */
function mdxViolations(body) {
  const violations = [];
  const flagScheme = (value) => {
    if (typeof value === 'string' && disallowedScheme(value)) {
      violations.push(value);
    }
  };
  eachNode(fromMarkdown(body, GRAMMAR), (node) => {
    if (mdxGate.MARKDOWN_NODE_TYPES.has(node.type)) {
      if (node.type === 'code' && isUnwrappedCodeBlock(body, node)) {
        violations.push('mdx-code-block');
      }
      flagScheme(node.url);
    } else if (node.type === 'mdxjsEsm' && node.value.trim() === IMPORT) {
      // The one allowed statement.
    } else if (node.type.startsWith('mdxJsx')) {
      const allowed =
        node.name === mdxGate.ALLOWED_COMPONENT
          ? mdxGate.COMPONENT_ATTRIBUTES
          : mdxGate.ALLOWED_ELEMENTS.has(node.name)
            ? new Set()
            : null;
      if (!allowed) violations.push(`<${node.name}>`);
      for (const attribute of node.attributes) {
        if (!allowed?.has(attribute.name)) violations.push(attribute.name);
        let { value } = attribute;
        if (typeof value === 'object' && value) {
          try {
            value = JSON.parse(value.value);
          } catch {
            violations.push(value.value);
          }
        }
        // Only these two are rendered as URLs; the rest are text.
        if (['href', 'logo'].includes(attribute.name)) flagScheme(value);
      }
    } else {
      violations.push(node.type);
    }
  });
  return violations;
}

test('a body the publish-time MDX gate accepts is within the MDX allowlists', () => {
  fc.assert(
    fc.property(mdxBody, (body) => {
      if (mdxGate.findActiveContent(body).length === 0) {
        assert.deepEqual(mdxViolations(body), []);
      }
    }),
    RUNS,
  );
});

test('escapeMdx output contains only Markdown node types', () => {
  fc.assert(
    fc.property(fc.oneof(mdxBody, fc.string()), (text) => {
      const types = new Set();
      eachNode(fromMarkdown(escapeMdx(text), GRAMMAR), (node) =>
        types.add(node.type),
      );
      for (const type of types) {
        assert.ok(mdxGate.MARKDOWN_NODE_TYPES.has(type), type);
      }
    }),
    RUNS,
  );
});

// --- Historical bypasses of the denylists ----------------------------------

const svgRow = (body) => () => {
  const source = `${SVG_OPEN}${body}</svg>`;
  const findings = svgGate.findActiveContent(source);
  const output = svgGate.stripActiveContent(source).source;
  return { findings, clean: svgGate.findActiveContent(output) };
};
const mdxRow = (body) => () => ({
  findings: mdxGate.findActiveContent(body).map(({ reason }) => reason),
  clean: [],
});

const BYPASSES = [
  [
    'an SVG stripped to inert markup is rescanned before it is returned',
    svgRow('<g onload="x"><script>alert(1)</script></g>'),
    [
      'contains a disallowed attribute onload on <g>',
      'contains a disallowed element <script>',
    ],
  ],
  [
    'a repeated link label resolves to its first definition',
    mdxRow(
      '![p][d]\n\n[d]: https://evil.example/p.png\n[d]: /img/architectures/acme/p.png',
    ),
    ['remote image destination https://evil.example/p.png'],
  ],
  [
    'an mdx-code-block fence is live MDX, not code',
    mdxRow(
      '```mdx-code-block\n<img src="https://beacon.invalid/px.png" />\n```',
    ),
    [
      'mdx-code-block fence, whose body Docusaurus compiles as MDX rather than displaying as code',
    ],
  ],
  [
    'a form action or formaction override is not an allowed attribute',
    svgRow(
      `<foreignObject><div xmlns="${XHTML_NS}" action="https://e/" formaction="https://e/"/></foreignObject>`,
    ),
    [
      'contains a disallowed attribute action on <div>',
      'contains a disallowed attribute formaction on <div>',
    ],
  ],
];

for (const [label, run, expected] of BYPASSES) {
  test(`historical bypass: ${label}`, () => {
    const { findings, clean } = run();
    assert.deepEqual(findings, expected);
    assert.deepEqual(clean, []);
  });
}
