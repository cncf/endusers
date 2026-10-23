// Premises that keep ten mutants in mdx-active-content.mjs equivalent.
//
// Each of those ten sits on a test the module makes that nothing can currently
// falsify: a bound that is never reached, a guard a caller already satisfied,
// an arm an earlier branch always takes first. The mutation report prints them
// as survivors, and they are annotated in the source as equivalent — but an
// equivalence claim is only as durable as the property it rests on. Every one
// here rests on a property of a *different* function: `literalValue()`'s
// `JSON.parse`, the dispatch order in `scanSource()`, the dedupe at the end of
// `findActiveContent()`, the pure-deletion contract of `unwrapMdxCodeBlocks()`.
//
// Nothing pins those properties today. Change one and the corresponding
// annotation silently becomes a lie: the mutant stops being equivalent, the
// gate stays green because the mutator is disabled on that line, and the
// behaviour it was covering for is gone. These tests make that change fail
// here instead, where the annotation can be removed and the mutant killed
// properly. Each test names the annotation it holds up.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findActiveContent } from '../scripts/lib/mdx-active-content.mjs';

const IMPORT =
  "import CNCFProjectCard from '@site/src/components/CNCFProjectCard';";

const card = (attributes) => `${IMPORT}\n\n<CNCFProjectCard ${attributes} />\n`;

const reasons = (markdown) =>
  findActiveContent(markdown).map((finding) => finding.reason);

// --- literalValue()'s JSON.parse backstops the anchors on
// --- STRING_LITERAL_EXPRESSION (the two Regex annotations on that constant).
//
// Dropping either anchor lets the pattern match a string literal *inside* a
// larger expression. That does not admit the expression, because
// `literalValue()` then runs `JSON.parse` over the whole trimmed text, which
// rejects anything that is not exactly one JSON string. The anchors and the
// `JSON.parse` are two guards on the same property, and these cases pin the
// second one: if `literalValue()` ever stops parsing the full expression, the
// anchors become the only thing standing between a braced expression and the
// allowlist.
const NOT_A_LONE_STRING_LITERAL = {
  'a string literal added to an identifier': 'name={foo + "bar"}',
  'a string literal with a method call on it': 'name={"x".toUpperCase()}',
  'a string literal as a call argument': 'name={alert("x")}',
  'a string literal in a member access': 'name={obj["x"]}',
  'two string literals added together': 'name={"a" + "b"}',
  'an object whose values are string literals': 'name={{"a":"b"}}',
  'an array holding a string literal': 'name={["a"]}',
  'a URL literal concatenated with an identifier':
    'logo={"https://evil.test/a.png" + x}',
  'a template literal rather than a string literal':
    'logo={`https://evil.test/a.png`}',
};

for (const [shape, attribute] of Object.entries(NOT_A_LONE_STRING_LITERAL)) {
  test(`${shape} is reported, not treated as an inert literal`, () => {
    assert.deepEqual(reasons(card(attribute)), ['MDX expression']);
  });
}

test('an expression that is exactly one string literal is still allowed', () => {
  assert.deepEqual(findActiveContent(card('name={"plain"}')), []);
  assert.deepEqual(findActiveContent(card('name={"a\\"b"}')), []);
});

// --- An mdxjsEsm node is dispatched before the MDX_NODE_TYPES arm (the
// --- StringLiteral annotation on `'mdxjsEsm'` in that set).
//
// The set lists `mdxjsEsm`, but `scanSource()` tests `node.type ===
// 'mdxjsEsm'` in an earlier arm, so the entry is never the reason an ESM node
// is walked. Emptying it changes nothing only while that earlier arm keeps
// taking the node first. The reason strings below are what tells the two arms
// apart: the ESM arm says "unexpected ESM statement", the element arm would
// report a disallowed element or node type instead.
test('a disallowed ESM statement is reported by the ESM arm', () => {
  assert.deepEqual(reasons("import x from 'y';\n"), [
    'unexpected ESM statement',
  ]);
  assert.deepEqual(reasons('export const x = 1;\n'), [
    'unexpected ESM statement',
  ]);
});

test('the one allowed import is accepted, wherever it sits', () => {
  assert.deepEqual(findActiveContent(`${IMPORT}\n`), []);
  assert.deepEqual(findActiveContent(`text\n\n${IMPORT}\n`), []);
});

// --- A component attribute value is a string or it is null (the
// --- ConditionalExpression annotation on `typeof value === 'string'`).
//
// `typeof value === 'string'` guards the URL checks, and the mutant drops it
// so that a non-string reaches them. It changes nothing because there is no
// third kind of value: an attribute written with no value at all leaves it
// null, and an expression attribute is replaced by `literalValue()`, which
// returns a string or null and has already reported the null case. These pin
// both ways a URL attribute can arrive without a string.
test('a URL attribute written with no value loads nothing', () => {
  assert.deepEqual(findActiveContent(card('logo')), []);
  assert.deepEqual(findActiveContent(card('href')), []);
});

test('a URL attribute whose expression is not a literal is reported once', () => {
  assert.deepEqual(reasons(card('logo={x + "y"}')), ['MDX expression']);
  assert.deepEqual(reasons(card('logo={null}')), ['MDX expression']);
  assert.deepEqual(reasons(card('logo={123}')), ['MDX expression']);
});

test('a URL attribute holding a literal is still checked', () => {
  assert.deepEqual(reasons(card('logo="https://evil.test/a.png"')), [
    'remote image destination https://evil.test/a.png',
  ]);
  assert.deepEqual(reasons(card('href="javascript:alert(1)"')), [
    'disallowed URL scheme javascript:',
  ]);
});

test('a non-URL attribute that merely looks like a URL is left alone', () => {
  // The guard the mutant widens would start reporting these. They render as
  // text and fetch nothing, so reporting them would be a false finding.
  assert.deepEqual(findActiveContent(card('name="javascript:alert(1)"')), []);
  assert.deepEqual(
    findActiveContent(card('description="data:text/html,x"')),
    [],
  );
  assert.deepEqual(
    findActiveContent(card('version="https://evil.test/v"')),
    [],
  );
});

// --- An unresolved image reference resolves to undefined (the
// --- ConditionalExpression annotation on `url !== undefined`).
//
// The guard exists because `definitions.get()` misses for a reference with no
// definition. Dropping it passes `undefined` to `reportRemoteImage()`, which
// finds no host in it — so the guard reads as intent rather than as a
// decision, and stays that way only while an unresolved reference keeps
// rendering as literal text and loading nothing.
test('an image reference with no definition is not a remote image', () => {
  assert.deepEqual(findActiveContent('![alt][missing]\n'), []);
  assert.deepEqual(
    findActiveContent('![alt][missing]\n\n[a]: https://evil.test/a.png\n'),
    [],
  );
});

test('an image reference with a definition is still followed', () => {
  assert.deepEqual(reasons('![alt][a]\n\n[a]: https://evil.test/a.png\n'), [
    'remote image destination https://evil.test/a.png',
  ]);
  assert.deepEqual(reasons('![a]\n\n[a]: https://evil.test/a.png\n'), [
    'remote image destination https://evil.test/a.png',
  ]);
});

// --- Only URL nodes carry a `url` (the ConditionalExpression annotation on
// --- `URL_NODES.has(node.type)`).
//
// Widening that arm to every allowed Markdown node sends `node.url` —
// undefined for all of them — through the scheme check, which reports nothing
// for it. The property that keeps this true is that ordinary prose has no
// destination at all, so a scan of it is empty.
test('allowed Markdown with no destination produces no finding', () => {
  assert.deepEqual(
    findActiveContent('Just a paragraph with **bold** and `code`.\n'),
    [],
  );
  assert.deepEqual(
    findActiveContent('# Title\n\n- one\n- two\n\n> quote\n'),
    [],
  );
  assert.deepEqual(findActiveContent('| a | b |\n| - | - |\n| 1 | 2 |\n'), []);
  assert.deepEqual(findActiveContent('text[^1]\n\n[^1]: note\n'), []);
  assert.deepEqual(findActiveContent('```js\nalert(1)\n```\n'), []);
});

test('a destination on a URL node is still checked', () => {
  assert.deepEqual(reasons('[text](javascript:alert(1))\n'), [
    'disallowed URL scheme javascript:',
  ]);
  assert.deepEqual(reasons('![alt](https://evil.test/a.png)\n'), [
    'remote image destination https://evil.test/a.png',
  ]);
  assert.deepEqual(reasons('[a]: javascript:alert(1)\n\n[use][a]\n'), [
    'disallowed URL scheme javascript:',
  ]);
});

// --- Findings are deduped by line and reason (the ConditionalExpression
// --- annotation on `form === text`).
//
// `continue` skips re-scanning a rewritten form that came back identical.
// Dropping it scans the same text twice, which is invisible only because the
// dedupe at the end of `findActiveContent()` collapses the pair. These pin the
// count, which is the only thing that would move if that dedupe went away.
test('a finding in a document with no fence is reported exactly once', () => {
  assert.deepEqual(findActiveContent('<script>alert(1)</script>\n'), [
    {
      line: 1,
      reason: 'disallowed element <script>',
      snippet: '<script>alert(1)</script>',
    },
  ]);
});

test('two findings in an unrewritten document stay two', () => {
  assert.deepEqual(reasons('<script>a</script>\n\n<iframe></iframe>\n'), [
    'disallowed element <script>',
    'disallowed element <iframe>',
  ]);
});

// --- unwrapMdxCodeBlocks() deletes lines and never adds one (the two
// --- annotations on the `cursor < sourceLines.length` bound).
//
// `mapUnwrappedLines()` walks the source forward looking for each unwrapped
// line. The bound is what stops that walk when a line is not found; it is
// unreachable while the unwrap is a pure deletion, because then every
// unwrapped line is a source line and they arrive in order. Remove the bound
// under that premise and nothing changes; remove the premise and the walk
// runs off the end of the array for ever. These pin the premise by checking
// that findings inside a fence still map to their own source line, including
// when the fence body repeats a line that also appears outside it.
test('a finding inside a fence maps to its source line', () => {
  assert.deepEqual(
    findActiveContent('a\n\n```mdx-code-block\n<script>b</script>\n```\n'),
    [
      {
        line: 3,
        reason:
          'mdx-code-block fence, whose body Docusaurus compiles as MDX rather than displaying as code',
        snippet: '```mdx-code-block',
      },
      {
        line: 4,
        reason: 'disallowed element <script>',
        snippet: '<script>b</script>',
      },
    ],
  );
});

test('a fence body that repeats a line outside it still maps forward', () => {
  assert.deepEqual(findActiveContent('a\n\n```mdx-code-block\na\n```\n\na\n'), [
    {
      line: 3,
      reason:
        'mdx-code-block fence, whose body Docusaurus compiles as MDX rather than displaying as code',
      snippet: '```mdx-code-block',
    },
  ]);
});

test('two fences each map their own body', () => {
  const findings = findActiveContent(
    '```mdx-code-block\n<script>a</script>\n```\n\ntext\n\n' +
      '```mdx-code-block\n<iframe></iframe>\n```\n',
  );
  assert.deepEqual(
    findings.map((finding) => finding.line),
    [1, 2, 7, 8],
  );
});

// --- A nullish body scans as the empty string (the StringLiteral annotation
// --- on the `?? ''` fallback).
//
// The seed only ever reaches the parser, and an empty document has no nodes.
// Replacing it with prose would also produce no findings, which is why the
// mutant survives; what matters is that a nullish body is answered for at all
// rather than throwing.
test('a nullish or empty body produces no findings', () => {
  assert.deepEqual(findActiveContent(null), []);
  assert.deepEqual(findActiveContent(undefined), []);
  assert.deepEqual(findActiveContent(''), []);
  assert.deepEqual(findActiveContent('\n\n\n'), []);
});
