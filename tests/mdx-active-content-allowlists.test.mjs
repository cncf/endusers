// Behavioural pins for the allowlists and bookkeeping in
// scripts/lib/mdx-active-content.mjs: every exported allowlist entry admits
// the construct it names, each inert-expression rule is checked at its
// boundary, and findings are mapped, trimmed and ordered exactly.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxjs } from 'micromark-extension-mdxjs';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { eachNode } from '../scripts/lib/mdast-walk.mjs';
import {
  ALLOWED_COMPONENT,
  ALLOWED_ELEMENTS,
  COMPONENT_ATTRIBUTES,
  MARKDOWN_NODE_TYPES,
  findActiveContent,
} from '../scripts/lib/mdx-active-content.mjs';

const GRAMMAR = {
  extensions: [mdxjs(), gfm()],
  mdastExtensions: [mdxFromMarkdown(), gfmFromMarkdown()],
};

const reasons = (markdown) => findActiveContent(markdown).map((f) => f.reason);

const nodeTypes = (markdown) => {
  const types = new Set();
  eachNode(fromMarkdown(markdown, GRAMMAR), (node) => types.add(node.type));
  return types;
};

// One inert document per Markdown node type. Each is parsed to prove it
// really produces the node it stands for, then scanned: an entry missing from
// MARKDOWN_NODE_TYPES would surface here as `disallowed node type <type>`.
const FOOTNOTE = 'Text[^1]\n\n[^1]: A note.';
const TABLE = '| a |\n| - |\n| b |';
const INERT_DOCUMENTS = {
  blockquote: '> quoted',
  break: 'line one  \nline two',
  code: '```\nkubectl get pods\n```',
  definition: '[d]: /docs/x',
  delete: '~~struck~~',
  emphasis: '*emphasis*',
  footnoteDefinition: FOOTNOTE,
  footnoteReference: FOOTNOTE,
  heading: '# Heading',
  image: '![alt](/img/x.png)',
  imageReference: '![alt][d]\n\n[d]: /img/x.png',
  inlineCode: '`code`',
  link: '[text](/docs/x)',
  linkReference: '[text][d]\n\n[d]: /docs/x',
  list: '- item',
  listItem: '- item',
  paragraph: 'text',
  root: 'text',
  strong: '**strong**',
  table: TABLE,
  tableCell: TABLE,
  tableRow: TABLE,
  text: 'text',
  thematicBreak: '---',
};

test('the inert-document table covers every Markdown node type on the allowlist', () => {
  assert.deepEqual(
    Object.keys(INERT_DOCUMENTS).sort(),
    [...MARKDOWN_NODE_TYPES].sort(),
  );
});

for (const [type, document] of Object.entries(INERT_DOCUMENTS)) {
  test(`accepts a document whose only construct is a ${type} node`, () => {
    assert.ok(nodeTypes(document).has(type), `${type} not produced`);
    assert.deepEqual(findActiveContent(document), []);
  });
}

for (const name of ALLOWED_ELEMENTS) {
  test(`accepts the inert element <${name}> with no attributes`, () => {
    assert.deepEqual(findActiveContent(`<${name}></${name}>`), []);
  });
}

for (const attribute of COMPONENT_ATTRIBUTES) {
  test(`accepts the ${attribute} attribute on <${ALLOWED_COMPONENT}>`, () => {
    const card = `<${ALLOWED_COMPONENT} ${attribute}="x" />`;
    assert.deepEqual(findActiveContent(card), []);
  });
}

test('accepts a string-literal attribute expression padded with whitespace', () => {
  // MDX hands the gate the raw text between the braces, spaces included.
  assert.deepEqual(reasons('<CNCFProjectCard name={ "K" } />'), []);
  assert.deepEqual(reasons('<CNCFProjectCard name={\t"K"\t} />'), []);
});

test('rejects a JSON literal that is not a string, even though it parses', () => {
  // Only a string literal is inert by construction; the literal test has to
  // run before JSON.parse so a number or array does not slip through as a
  // "value" the attribute checks then ignore.
  for (const expression of ['{1}', '{true}', '{["a"]}', '{{"a":1}}']) {
    assert.deepEqual(
      reasons(`<CNCFProjectCard name=${expression} />`),
      ['MDX expression'],
      expression,
    );
  }
});

test('checks the URL scheme only on attributes rendered as URLs', () => {
  // name and description are rendered as text, so a scheme in either is a
  // string, not a navigation, and must not be reported.
  assert.deepEqual(
    reasons(
      '<CNCFProjectCard name="javascript:alert(1)" description="https://evil.example/x.png" />',
    ),
    [],
  );
  assert.deepEqual(
    reasons('<CNCFProjectCard name="K" href="javascript:alert(1)" />'),
    ['disallowed URL scheme javascript:'],
  );
});

test('accepts the generated import with trailing whitespace on its line', () => {
  // mdast keeps trailing spaces in the ESM node's value; the comparison has
  // to trim them or every editor that pads a line end fails the gate.
  assert.deepEqual(
    reasons(
      "import CNCFProjectCard from '@site/src/components/CNCFProjectCard';   ",
    ),
    [],
  );
});

test('names an expression node by its type shape, not by a fixed list', () => {
  // The fallback report distinguishes an `mdx*Expression` node from any other
  // unknown kind. Both halves of that test matter: a type carrying only one
  // half is a disallowed node type, not an expression.
  const retype = (type) => ({
    transforms: [
      (tree) => {
        tree.children[0].type = type;
      },
    ],
  });
  const reported = (type) =>
    findActiveContent('x', { mdastExtensions: [retype(type)] }).map(
      ({ reason }) => reason,
    );
  assert.deepEqual(reported('mdxFlowExpression'), ['MDX expression']);
  assert.deepEqual(reported('mdxFoo'), ['disallowed node type mdxFoo']);
  assert.deepEqual(reported('fooExpression'), [
    'disallowed node type fooExpression',
  ]);
});

test('quotes a trimmed snippet capped at 120 characters', () => {
  const payload = `<script>${'a'.repeat(200)}</script>`;
  assert.deepEqual(findActiveContent(`   ${payload}`), [
    {
      line: 1,
      reason: 'disallowed element <script>',
      snippet: payload.slice(0, 120),
    },
  ]);
});

test('quotes a trimmed, capped snippet for a finding from the unwrapped pass too', () => {
  const payload = `<iframe src="https://evil.test/${'a'.repeat(200)}"></iframe>`;
  const body = ['```mdx-code-block', `  ${payload}`, '````', '', '```'].join(
    '\n',
  );
  assert.deepEqual(findActiveContent(body), [
    {
      line: 2,
      reason: 'disallowed element <iframe>',
      snippet: payload.slice(0, 120),
    },
  ]);
});

test('maps two identical unwrapped lines to their own source lines', () => {
  // The line mapping walks the source forward from the previous match. Two
  // identical payload lines must land on lines 2 and 3, not both on line 2,
  // or the second finding is deduplicated away.
  const body = [
    '```mdx-code-block',
    '<iframe></iframe>',
    '<iframe></iframe>',
    '````',
    '',
    '```',
  ].join('\n');
  assert.deepEqual(
    findActiveContent(body).map(({ line }) => line),
    [2, 3],
  );
});

test('orders findings by line even when the unwrapped pass reports earlier lines', () => {
  // The first pass reports the fence (line 1) and the script (line 5); the
  // unwrapped pass then adds the iframe on line 2, so the union is out of
  // order until sorted.
  const body = [
    '```mdx-code-block',
    '<iframe></iframe>',
    '```',
    '',
    '<script></script>',
  ].join('\n');
  assert.deepEqual(
    findActiveContent(body).map(({ line, reason }) => [line, reason]),
    [
      [
        1,
        'mdx-code-block fence, whose body Docusaurus compiles as MDX rather than displaying as code',
      ],
      [2, 'disallowed element <iframe>'],
      [5, 'disallowed element <script>'],
    ],
  );
});

test('deduplicates a finding reported by both the source and unwrapped passes', () => {
  // A plain fence the unwrap leaves alone still produces a second scan pass
  // when another block is unwrapped; the same payload line reported twice
  // with the same reason is one finding.
  const body = [
    '```mdx-code-block',
    '<b>x</b>',
    '```',
    '',
    '<script></script>',
  ].join('\n');
  const script = findActiveContent(body).filter(
    ({ reason }) => reason === 'disallowed element <script>',
  );
  assert.equal(script.length, 1);
  assert.equal(script[0].line, 5);
});
