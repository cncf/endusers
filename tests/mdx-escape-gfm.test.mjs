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
