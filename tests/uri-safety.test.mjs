// Direct contract tests for the URI classifier both content gates share.
//
// `scripts/lib/uri-safety.mjs` exists so the SVG scanner and the MDX scanner
// answer "does this run script?" identically -- its own header calls a
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
  activeScheme,
  decodeEntities,
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

test('activeScheme names every script-executing scheme', () => {
  assert.equal(activeScheme('javascript:alert(1)'), 'javascript:');
  assert.equal(activeScheme('VBScript:alert(1)'), 'vbscript:');
  assert.equal(activeScheme('livescript:alert(1)'), 'livescript:');
  assert.equal(activeScheme('mocha:alert(1)'), 'mocha:');
});

test('activeScheme sees through character references and interleaved control characters', () => {
  assert.equal(activeScheme('&#106;avascript:alert(1)'), 'javascript:');
  assert.equal(activeScheme('java&amp;#115;cript:alert(1)'), 'javascript:');
  assert.equal(activeScheme('jav\u0000ascript:alert(1)'), 'javascript:');
});

// The scheme must start at the value, or follow a character that cannot be part
// of a scheme name. A longer scheme that merely ends in `javascript` is a
// different scheme and is not this gate's business.
test('activeScheme requires a scheme boundary before the match', () => {
  assert.equal(activeScheme('xjavascript:alert(1)'), null);
  assert.equal(activeScheme('not-javascript:alert(1)'), null);
  assert.equal(activeScheme('x.javascript:alert(1)'), null);
  assert.equal(activeScheme('x+javascript:alert(1)'), null);
});

// The boundary a CSS value actually supplies: `url(` before the scheme.
test('activeScheme matches after a non-scheme character', () => {
  assert.equal(activeScheme('url(javascript:alert(1))'), 'javascript:');
});

// normalizeUri removes the space first, which joins `foo` to the scheme and
// leaves no boundary -- the value no longer names a scheme a browser would run.
test('activeScheme does not match a scheme that separating whitespace joins to a word', () => {
  assert.equal(activeScheme('foo javascript:alert(1)'), null);
});

test('activeScheme names a data: media type a browser parses as a document', () => {
  assert.equal(activeScheme('data:text/html,<b>'), 'data:text/html');
  assert.equal(activeScheme('data:text/xml,x'), 'data:text/xml');
  assert.equal(activeScheme('data:application/xml,x'), 'data:application/xml');
  assert.equal(activeScheme('data:text/xsl,x'), 'data:text/xsl');
  assert.equal(
    activeScheme('data:text/javascript,alert(1)'),
    'data:text/javascript',
  );
  assert.equal(
    activeScheme('data:application/javascript,alert(1)'),
    'data:application/javascript',
  );
  assert.equal(
    activeScheme('data:application/x-javascript,alert(1)'),
    'data:application/x-javascript',
  );
  assert.equal(
    activeScheme('data:text/ecmascript,alert(1)'),
    'data:text/ecmascript',
  );
  assert.equal(
    activeScheme('data:application/ecmascript,alert(1)'),
    'data:application/ecmascript',
  );
});

// Any `+xml` type is a document type, so the suffix is matched rather than
// enumerated -- including ones no allowlist names.
test('activeScheme names any +xml media type', () => {
  assert.equal(
    activeScheme('data:image/svg+xml;base64,AA'),
    'data:image/svg+xml',
  );
  assert.equal(
    activeScheme('data:application/xhtml+xml,x'),
    'data:application/xhtml+xml',
  );
});

test('activeScheme leaves an inert data: URI alone', () => {
  assert.equal(activeScheme('data:image/png;base64,AA'), null);
  assert.equal(activeScheme('data:font/woff2;base64,AA'), null);
  assert.equal(activeScheme('data:,hello'), null);
});

test('activeScheme requires a scheme boundary before data: too', () => {
  assert.equal(activeScheme('xdata:text/html,<b>'), null);
});

test('activeScheme leaves ordinary references alone', () => {
  assert.equal(activeScheme('/img/architectures/acme/diagram.svg'), null);
  assert.equal(activeScheme('https://www.cncf.io/'), null);
  assert.equal(activeScheme('#anchor'), null);
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
