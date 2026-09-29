import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { escapeMdx, unescapeMdx } from '../scripts/lib/mdx-escape.mjs';

// Pages under docs/ compile as MDX (@docusaurus/core 3 defaults
// markdown.format to 'mdx' and docusaurus.config.js sets no override), so
// prose taken from a submission form reaches a JavaScript compiler. These
// tests pin which constructs escapeMdx() must neutralize and, just as
// importantly, which ones it must leave alone.

test('neutralizes a brace expression', () => {
  assert.equal(escapeMdx('Prose. {2 + 2}'), 'Prose. &#123;2 + 2&#125;');
});

test('neutralizes a JSX element carrying an event handler', () => {
  assert.equal(
    escapeMdx('<span onClick={() => alert(1)}>click</span>'),
    '&lt;span onClick=&#123;() => alert(1)&#125;>click&lt;/span>',
  );
});

test('neutralizes an MDX comment', () => {
  assert.equal(escapeMdx('{/* hi */}'), '&#123;/* hi */&#125;');
});

test('neutralizes a block-initial export statement', () => {
  assert.equal(
    escapeMdx('para\n\nexport const pwn = 1;\n\npara'),
    'para\n\n&#101;xport const pwn = 1;\n\npara',
  );
});

test('neutralizes a block-initial import statement', () => {
  assert.equal(
    escapeMdx('para\n\nimport fs from "node:fs";'),
    'para\n\n&#105;mport fs from "node:fs";',
  );
});

test('neutralizes an import indented less than a code block', () => {
  assert.equal(
    escapeMdx('   import fs from "x";'),
    '   &#105;mport fs from "x";',
  );
});

test('leaves an import indented into a code block alone', () => {
  // Four spaces is an indented code block, which MDX does not evaluate.
  assert.equal(escapeMdx('    import fs from "x";'), '    import fs from "x";');
});

test('does not escape import/export as an ordinary word mid-line', () => {
  assert.equal(
    escapeMdx('We export metrics and import traces.'),
    'We export metrics and import traces.',
  );
});

test('leaves braces inside a fenced code block verbatim', () => {
  const source = 'intro\n\n```js\nconst a = { b: 1 };\n```\n\noutro';
  assert.equal(escapeMdx(source), source);
});

test('leaves braces inside a tilde-fenced block verbatim', () => {
  const source = '~~~yaml\nresources: { limits: {} }\n~~~';
  assert.equal(escapeMdx(source), source);
});

test('leaves a longer closing fence working and resumes escaping after it', () => {
  assert.equal(
    escapeMdx('````\n{a}\n````\n{b}'),
    '````\n{a}\n````\n&#123;b&#125;',
  );
});

test('does not let a shorter inner fence close an outer fence', () => {
  const source = '````\n```\n{a}\n```\n````';
  assert.equal(escapeMdx(source), source);
});

test('treats an unterminated fence as code through the end of the text', () => {
  const source = 'intro\n\n```js\nconst a = {b: 1};\nexport const c = 2;';
  assert.equal(escapeMdx(source), source);
});

test('leaves braces inside an inline code span verbatim', () => {
  assert.equal(
    escapeMdx('set `{"a": 1}` then {bad}'),
    'set `{"a": 1}` then &#123;bad&#125;',
  );
});

test('matches inline code spans by backtick run length', () => {
  assert.equal(escapeMdx('``a ` {b}`` {c}'), '``a ` {b}`` &#123;c&#125;');
});

test('escapes an unmatched backtick run as ordinary text', () => {
  assert.equal(escapeMdx('`unclosed {a}'), '`unclosed &#123;a&#125;');
});

test('preserves an http autolink', () => {
  assert.equal(
    escapeMdx('See <https://example.com/a?b=1> for more'),
    'See <https://example.com/a?b=1> for more',
  );
});

test('preserves an email autolink', () => {
  assert.equal(escapeMdx('<team@example.com>'), '<team@example.com>');
});

test('escapes a less-than that is not an autolink', () => {
  assert.equal(escapeMdx('latency < 5ms'), 'latency &lt; 5ms');
});

test('escapes the empty JSX fragment', () => {
  assert.equal(escapeMdx('<></>'), '&lt;>&lt;/>');
});

test('leaves ordinary Markdown untouched', () => {
  const source =
    '## Heading\n\nSome **bold** text with a [link](https://example.com) and\nan image ![alt](https://example.com/a.png).\n\n- one\n- two';
  assert.equal(escapeMdx(source), source);
});

test('returns an empty string for non-string or empty input', () => {
  assert.equal(escapeMdx(undefined), '');
  assert.equal(escapeMdx(null), '');
  assert.equal(escapeMdx(''), '');
  assert.equal(escapeMdx(42), '');
});

test('unescapeMdx round-trips every character reference escapeMdx adds', () => {
  const source = 'a {b} <c> export import latency < 5';
  assert.equal(unescapeMdx(escapeMdx(source)), source);
});

test('unescapeMdx leaves unrelated text alone', () => {
  assert.equal(unescapeMdx('plain &amp; simple'), 'plain &amp; simple');
  assert.equal(unescapeMdx(undefined), '');
});

// unescapeMdx() reverses the escaping by scanning for a fixed alternation of
// character references and looking each one up in the ESCAPES table. The two
// lists are written out separately, so they can drift: an alternative added to
// the regex without a matching table entry makes unescapeMdx() fall through and
// emit the raw reference, which then shows through literally wherever the
// unescaped text is rendered as a plain text node. Nothing in the behavioural
// tests above can see that drift, because a reference with no table entry is
// one escapeMdx() never produces. Pin the two lists against each other
// directly, against the source rather than the exports, since neither list is
// reachable from outside the module.
const mdxEscapeSource = readFileSync(
  new URL('../scripts/lib/mdx-escape.mjs', import.meta.url),
  'utf8',
);

function escapeTableKeys() {
  const table = mdxEscapeSource.match(
    /const ESCAPES = new Map\(\[(?<body>[\s\S]*?)\]\);/u,
  );
  assert.ok(table, 'expected an ESCAPES Map literal in mdx-escape.mjs');
  return [...table.groups.body.matchAll(/\[\s*'(?<entity>[^']+)'\s*,/gu)].map(
    (entry) => entry.groups.entity,
  );
}

function unescapeRegexAlternatives() {
  const call = mdxEscapeSource.match(
    /return text\.replace\(\s*\/(?<pattern>[^/\n]+)\/g,/u,
  );
  assert.ok(
    call,
    'expected a text.replace() with a literal regex in unescapeMdx',
  );
  return call.groups.pattern.split('|');
}

test('every character reference unescapeMdx matches has an ESCAPES entry', () => {
  const keys = escapeTableKeys();
  assert.ok(keys.length > 0, 'expected a non-empty ESCAPES table');
  assert.deepEqual(
    unescapeRegexAlternatives().filter((alt) => !keys.includes(alt)),
    [],
    'unescapeMdx matches a character reference that ESCAPES cannot decode',
  );
});

test('every ESCAPES entry is reachable from the unescapeMdx regex', () => {
  const alternatives = unescapeRegexAlternatives();
  assert.deepEqual(
    escapeTableKeys().filter((key) => !alternatives.includes(key)),
    [],
    'ESCAPES decodes a character reference unescapeMdx never matches',
  );
});

test('unescapeMdx decodes every entry in the ESCAPES table', () => {
  for (const entity of escapeTableKeys()) {
    assert.notEqual(
      unescapeMdx(`before ${entity} after`),
      `before ${entity} after`,
      `unescapeMdx left ${entity} undecoded`,
    );
  }
});
