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
// These tests exercise the exported API directly. `remoteTarget` is covered
// through the SVG gate in tests/svg-active-content.test.mjs and is deliberately
// left alone here.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeEntities,
  disallowedScheme,
  describeTarget,
  normalizeUri,
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
