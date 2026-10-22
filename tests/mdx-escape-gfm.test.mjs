import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxjs } from 'micromark-extension-mdxjs';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { escapeMdx } from '../scripts/lib/mdx-escape.mjs';

// @docusaurus/mdx-loader compiles pages with remark-gfm enabled alongside MDX,
// so GFM is part of the grammar that decides what the site publishes. These
// tests pin escapeMdx() to that grammar: anything it hands back verbatim as
// "code" must still be inert once GFM has had its say.
//
// The case that matters is a table row. Under GFM a `|` is a cell delimiter
// and splits an inline code span, so ``| `x | <div /> ` |`` holds one code
// span to a non-GFM parser and a live element to the compiler. Classifying it
// with the non-GFM view published live JSX from submitted prose.

const ACTIVE_MDX_TYPES = new Set([
  'mdxjsEsm',
  'mdxFlowExpression',
  'mdxTextExpression',
  'mdxJsxFlowElement',
  'mdxJsxTextElement',
]);

function walk(node, visitor) {
  visitor(node);
  for (const child of node.children ?? []) walk(child, visitor);
}

/** Parses the way the site compiles: MDX plus GFM. */
function parseAsSiteDoes(source) {
  return fromMarkdown(source, {
    extensions: [mdxjs(), gfm()],
    mdastExtensions: [mdxFromMarkdown(), gfmFromMarkdown()],
  });
}

function activeNodesUnderGfm(source) {
  const active = [];
  walk(parseAsSiteDoes(source), (node) => {
    if (ACTIVE_MDX_TYPES.has(node.type)) active.push(node.type);
  });
  return active;
}

const TABLE_HEAD = '| a | b |\n| - | - |\n';

test('a table cell that splits a code span is live MDX before escaping', () => {
  const source = `${TABLE_HEAD}| \`x | <div onClick={alert(1)}>PWNED</div>\` |\n`;
  assert.deepEqual(
    activeNodesUnderGfm(source),
    ['mdxJsxTextElement'],
    'fixture no longer reproduces the GFM/MDX disagreement',
  );
});

test('escapeMdx neutralizes a JSX element hidden in a split table code span', () => {
  const escaped = escapeMdx(
    `${TABLE_HEAD}| \`x | <div onClick={alert(1)}>PWNED</div>\` |\n`,
  );
  assert.deepEqual(activeNodesUnderGfm(escaped), []);
  assert.ok(!escaped.includes('<div'), 'element start tag survived escaping');
  assert.ok(!escaped.includes('{alert(1)}'), 'expression survived escaping');
});

test('escapeMdx neutralizes an expression hidden in a split table code span', () => {
  // An MDX expression is evaluated during prerender, so this arm is what keeps
  // the build environment out of the published HTML.
  const escaped = escapeMdx(
    `${TABLE_HEAD}| \`x | <div>{process.env.SECRET}</div>\` |\n`,
  );
  assert.deepEqual(activeNodesUnderGfm(escaped), []);
  assert.ok(!escaped.includes('{process.env.SECRET}'));
});

test('a genuine fenced code block is still preserved verbatim', () => {
  const source = 'Intro\n\n```yaml\nkey: {a: 1}\n```\n';
  const escaped = escapeMdx(source);
  assert.equal(escaped, source);
  assert.deepEqual(activeNodesUnderGfm(escaped), []);
});

test('a genuine inline code span is still preserved verbatim', () => {
  const source = 'Use `{ a: 1 }` here.\n';
  const escaped = escapeMdx(source);
  assert.equal(escaped, source);
  assert.deepEqual(activeNodesUnderGfm(escaped), []);
});

test('an ordinary GFM table is left untouched', () => {
  const source = `${TABLE_HEAD}| 1 | 2 |\n`;
  assert.equal(escapeMdx(source), source);
});

// Each case below is a text whose code spans differ between the GFM and
// non-GFM views, chosen so that the preserved result is inert under every
// grammar: the verification pass therefore cannot paper over a wrong code
// decision, and the exact output pins which grammar made it.
const GRAMMAR_CASES = [
  {
    name: 'a split code span is escaped even when a genuine span precedes it',
    // Both views agree on `{a}`; only the non-GFM view also calls the table
    // cell content one code span, and it must not win the intersection.
    source: `\`{a}\`\n\n${TABLE_HEAD}| \`x | {y}\` |\n`,
    expected: `\`{a}\`\n\n${TABLE_HEAD}| \`x | &#123;y&#125;\` |\n`,
  },
  {
    name: 'a code span that only the GFM cell split creates is not preserved',
    // GFM sees the middle cell "b` } `c" as text around a code span holding
    // the brace; the non-GFM view sees two other spans. Neither view alone
    // decides, so the brace is escaped.
    source: '| h | i | j |\n| - | - | - |\n| `a | b` } `c | d` |\n',
    expected: '| h | i | j |\n| - | - | - |\n| `a | b` &#125; `c | d` |\n',
  },
  {
    name: 'the GFM fallback grammar still splits table cells',
    // The unclosed brace makes every MDX grammar throw, so code ranges come
    // from the fallback grammars, and the GFM one must still see a table
    // rather than a paragraph holding one code span.
    source: `{\n\n${TABLE_HEAD}| \`x | } y\` |\n`,
    expected: `&#123;\n\n${TABLE_HEAD}| \`x | &#125; y\` |\n`,
  },
];

for (const { name, source, expected } of GRAMMAR_CASES) {
  test(name, () => {
    const escaped = escapeMdx(source);
    assert.equal(escaped, expected);
    assert.deepEqual(activeNodesUnderGfm(escaped), []);
  });
}

// When code ranges come from the fallback grammars, an indented block is code
// to both of them and is handed through verbatim. The verification pass is
// what catches an element hiding inside it, and it has to look with both
// grammars: inside a list item the indented lines are a table to MDX+GFM, so
// the cell split exposes `<b>` that the non-GFM view hides in a code span, and
// the reverse layout hides `<b>` in a GFM-only span that only the non-GFM view
// sees as an element.
const INDENTED_TABLE_CASES = [
  {
    name: 're-escapes an indented table row whose cell split exposes an element',
    rows: ['| h | i |', '| - | - |', '| `x | <b>y</b>` |'],
    expectedRow: '| `x | &lt;b>y&lt;/b>` |',
  },
  {
    name: 're-escapes an indented table row whose element is live without GFM',
    rows: ['| h | i | j |', '| - | - | - |', '| `a | b` <b>x</b> `c | d` |'],
    expectedRow: '| `a | b` &lt;b>x&lt;/b> `c | d` |',
  },
];

for (const { name, rows, expectedRow } of INDENTED_TABLE_CASES) {
  test(name, () => {
    const indent = (row) => `      ${row}`;
    const source = ['{', '', '- x', '', ...rows.map(indent), ''].join('\n');
    const escaped = escapeMdx(source);
    assert.equal(
      escaped,
      [
        '&#123;',
        '',
        '- x',
        '',
        ...rows.slice(0, -1).map(indent),
        indent(expectedRow),
        '',
      ].join('\n'),
    );
    assert.deepEqual(activeNodesUnderGfm(escaped), []);
  });
}
