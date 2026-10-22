// Direct contract tests for the URI classifier both content gates share.
//
// `scripts/lib/uri-safety.mjs` exists so the SVG scanner and the MDX scanner
// answer "is this scheme allowed?" identically -- its own header calls a
// divergence "a bypass of whichever gate is more permissive". Until now every
// assertion about it was made through `findActiveContent`/`findRemoteReferences`
// on a whole SVG or Markdown document, so the predicate's own boundaries were
// only ever reached incidentally, through whichever values those documents
// happened to carry.
//
// These tests exercise the exported API directly. `remoteTarget`'s positive
// cases are covered through the SVG gate in tests/svg-active-content.test.mjs
// and tests/svg-remote-subresources.test.mjs; what is asserted here is only
// what those documents cannot reach -- that its two authority patterns are
// anchored, so a value carrying `http:` or `https://` further along a relative
// path is not reported as a fetch.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeEntities,
  disallowedScheme,
  describeTarget,
  normalizeUri,
  remoteTarget,
} from '../scripts/lib/uri-safety.mjs';

test('decodeEntities resolves hexadecimal references with or without the semicolon', () => {
  assert.equal(decodeEntities('&#x3a;'), ':');
  assert.equal(decodeEntities('&#x3A'), ':');
  assert.equal(decodeEntities('&#X3a;'), ':');
});

test('decodeEntities resolves decimal references with or without the semicolon', () => {
  assert.equal(decodeEntities('&#58;'), ':');
  assert.equal(decodeEntities('&#58'), ':');
});

// A code point past the Unicode maximum would throw out of String.fromCodePoint,
// so the match is handed back unchanged rather than decoded.
test('decodeEntities leaves an out-of-range code point as written', () => {
  assert.equal(decodeEntities('&#x110000;'), '&#x110000;');
  assert.equal(decodeEntities('&#1114112;'), '&#1114112;');
});

test('decodeEntities resolves the named references the scanner cares about', () => {
  assert.equal(decodeEntities('&colon;'), ':');
  assert.equal(decodeEntities('&TAB;'), '\t');
  assert.equal(decodeEntities('&newline;'), '\n');
  assert.equal(decodeEntities('&lf;'), '\n');
  assert.equal(decodeEntities('&cr;'), '\r');
  assert.equal(decodeEntities('&sol;'), '/');
  assert.equal(decodeEntities('&amp;'), '&');
});

test('decodeEntities leaves an unrecognised name as written', () => {
  assert.equal(decodeEntities('&nope;'), '&nope;');
});

// The upper bound is inclusive: U+10FFFF is a real code point, and the
// comparison that lets it through is the only thing separating it from the
// out-of-range values above.
test('decodeEntities resolves the highest valid code point', () => {
  const max = String.fromCodePoint(0x10ffff);
  assert.equal(decodeEntities('&#x10ffff;'), max);
  assert.equal(decodeEntities('&#1114111;'), max);
});

// Browsers resolve a named reference whose semicolon is missing, so the
// scanner has to as well: `&colon` hides a scheme just as `&colon;` does.
test('decodeEntities resolves a named reference without its semicolon', () => {
  assert.equal(decodeEntities('&colon'), ':');
  assert.equal(decodeEntities('&sol'), '/');
  assert.equal(
    normalizeUri('java&#115;cript&colon alert(1)'),
    'javascript:alert(1)',
  );
});

// The reason the module decodes twice: one pass turns `&amp;#58;` into
// `&#58;`, and only the second pass reaches the colon.
test('normalizeUri resolves a double-encoded reference', () => {
  assert.equal(decodeEntities('&amp;#58;'), '&#58;');
  assert.equal(normalizeUri('&amp;#58;'), ':');
});

test('normalizeUri strips whitespace and control characters and lowercases', () => {
  assert.equal(normalizeUri('JAVA\tSCRIPT\u0000 :x'), 'javascript:x');
  assert.equal(normalizeUri('\u007f/a'), '/a');
});

test('normalizeUri coerces a non-string value', () => {
  assert.equal(normalizeUri(58), '58');
});

// Rows are [value, result without raster data, result with it]. Anything that
// is neither schemeless nor on the allowlist is named, including schemes no
// one has thought of yet.
const SCHEMES = [
  ['/img/architectures/acme/diagram.svg', null, null],
  ['#anchor', null, null],
  ['./a:b', null, null],
  ['https://www.cncf.io/', null, null],
  ['HTTP://example.com/', null, null],
  ['mailto:a@example.com', null, null],
  ['javascript:alert(1)', 'javascript:', 'javascript:'],
  ['&#106;avascript:alert(1)', 'javascript:', 'javascript:'],
  ['java&amp;#115;cript:alert(1)', 'javascript:', 'javascript:'],
  ['jav\u0000ascript:alert(1)', 'javascript:', 'javascript:'],
  ['x-unheard-of+scheme:1', 'x-unheard-of+scheme:', 'x-unheard-of+scheme:'],
  ['data:image/png;base64,AA', 'data:image/png', null],
  ['DATA:IMAGE/WEBP,AA', 'data:image/webp', null],
  ['data:image/svg+xml,<svg/>', 'data:image/svg+xml', 'data:image/svg+xml'],
  ['data:text/html,<b>', 'data:text/html', 'data:text/html'],
  ['data:,hello', 'data:', 'data:'],
];

test('disallowedScheme names every scheme outside the allowlist', () => {
  for (const [value, plain, raster] of SCHEMES) {
    assert.equal(disallowedScheme(value), plain, JSON.stringify(value));
    assert.equal(
      disallowedScheme(value, { rasterData: true }),
      raster,
      JSON.stringify(value),
    );
  }
});

test('describeTarget passes a value at the limit through unchanged', () => {
  const target = `https://evil.test/${'a'.repeat(102)}`;
  assert.equal(target.length, 120);
  assert.equal(describeTarget(target), target);
});

test('describeTarget truncates a longer value to the same 120 characters', () => {
  const target = `https://evil.test/${'a'.repeat(103)}`;
  assert.equal(target.length, 121);
  const described = describeTarget(target);
  assert.equal(described.length, 120);
  assert.equal(described, `${target.slice(0, 117)}...`);
});

// Both authority patterns in remoteTarget are anchored to the start of the
// normalized value. Without the anchors a relative reference that merely
// *contains* `http:` or `https://` further along its path is reported as a
// fetch to another host -- a false finding against a local asset, which the
// SVG and MDX gates turn into a build failure the author cannot act on. Every
// remote case the suite has is absolute, so nothing else reaches past the
// anchors.
test('remoteTarget ignores http: further along a relative path', () => {
  assert.equal(remoteTarget('/img/http:logo.png'), null);
  assert.equal(remoteTarget('./notes/http:1.svg'), null);
});

test('remoteTarget ignores an absolute-looking authority mid-path', () => {
  assert.equal(remoteTarget('/img/https://evil.example/a.png'), null);
  assert.equal(remoteTarget('./a/http://evil.example/a.png'), null);
});
