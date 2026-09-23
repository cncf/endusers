import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findActiveContent,
  stripActiveContent,
} from '../scripts/lib/svg-active-content.mjs';

const INERT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><a href="https://example.com/docs"><rect width="10" height="10" fill="#fff"/></a></svg>';

test('reports nothing for an inert SVG', () => {
  assert.deepEqual(findActiveContent(INERT), []);
  assert.deepEqual(stripActiveContent(INERT), { source: INERT, removed: [] });
});

test('leaves ordinary http links and styling attributes alone', () => {
  const { source } = stripActiveContent(INERT);
  assert.match(source, /href="https:\/\/example\.com\/docs"/);
  assert.match(source, /fill="#fff"/);
});

test('detects and removes script elements with their contents', () => {
  const svg = INERT.replace('<rect', '<script>alert(1)</script><rect');
  assert.deepEqual(findActiveContent(svg), ['contains a <script> element']);

  const { source, removed } = stripActiveContent(svg);
  assert.doesNotMatch(source, /script/i);
  assert.doesNotMatch(source, /alert\(1\)/);
  assert.ok(removed.includes('<script> element'));
  assert.deepEqual(findActiveContent(source), []);
});

test('detects and removes event handler attributes', () => {
  const svg = INERT.replace('<rect ', '<rect onload="alert(1)" onclick="x()" ');
  assert.deepEqual(findActiveContent(svg), [
    'contains event handler attribute(s): onclick, onload',
  ]);

  const { source } = stripActiveContent(svg);
  assert.doesNotMatch(source, /onload|onclick/i);
  assert.match(source, /<rect /);
});

test('sees through entity and control-character obfuscation of javascript:', () => {
  for (const payload of [
    'javascript:alert(1)',
    'java&#115;cript:alert(1)',
    'javascript&#58;alert(1)',
    'java\tscript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
  ]) {
    const svg = INERT.replace('https://example.com/docs', payload);
    assert.deepEqual(
      findActiveContent(svg),
      ['contains a script URI in href="javascript:..."'],
      `expected detection for ${JSON.stringify(payload)}`,
    );
    assert.deepEqual(findActiveContent(stripActiveContent(svg).source), []);
  }
});

// decodeEntities has two numeric-entity branches. The test above reaches only
// the decimal one (`&#115;`), which is also the form the module header uses as
// its example, so the hex callback had no coverage at all -- even though hex is
// the more usual way to hide a scheme. The last payload is double-encoded and
// only resolves because decodeEntities is deliberately applied twice.
test('sees through hex numeric-entity obfuscation of javascript:', () => {
  for (const payload of [
    'java&#x73;cript:alert(1)',
    'java&#X73;cript:alert(1)',
    'javascript&#x3a;alert(1)',
    'javascript&amp;#x3a;alert(1)',
  ]) {
    const svg = INERT.replace('https://example.com/docs', payload);
    assert.deepEqual(
      findActiveContent(svg),
      ['contains a script URI in href="javascript:..."'],
      `expected detection for ${JSON.stringify(payload)}`,
    );
    assert.deepEqual(findActiveContent(stripActiveContent(svg).source), []);
  }
});

// The hex callback guards `code <= 0x10ffff` before calling String.fromCodePoint
// and returns the literal match when the codepoint is out of range. Pinning the
// guard keeps it from being "simplified" into a throw, and confirms the literal
// entity that survives does not itself read as a scheme.
test('leaves an out-of-range hex entity literal rather than forming a scheme', () => {
  const svg = INERT.replace(
    'https://example.com/docs',
    'java&#x110000;cript:alert(1)',
  );
  assert.deepEqual(findActiveContent(svg), []);
  assert.deepEqual(stripActiveContent(svg), { source: svg, removed: [] });
});

// ATTRIBUTE_PATTERN only matches an attribute that carries a value, so a
// handler written without one slips past the scanner. findActiveContent has an
// explicit fallback for that case, but every handler in the tests above is
// valued and therefore caught by the scanner, leaving the fallback unreached.
test('falls back to on* for a handler the attribute scanner cannot see', () => {
  for (const svg of [
    '<svg onload=></svg>',
    '<svg onload= ></svg>',
    '<svg onload=`alert(1)`></svg>',
  ]) {
    assert.deepEqual(
      findActiveContent(svg),
      ['contains event handler attribute(s): on*'],
      `expected the on* fallback for ${JSON.stringify(svg)}`,
    );
  }
});

// Known defect, tracked in #540: the on* fallback exists only in
// findActiveContent. stripActiveContent rewrites solely through
// ATTRIBUTE_PATTERN, which cannot see a value-less handler, so these inputs are
// reported as active but never cleaned -- and `removed` stays empty, so a
// caller cannot tell the difference between "nothing to remove" and "could not
// remove it". Re-detecting on the stripped output is the invariant: stripping
// must leave an SVG that findActiveContent considers inert. The fix is a
// removal pass in scripts/lib/svg-active-content.mjs, which is production code.
test(
  'stripActiveContent removes a handler the attribute scanner cannot see',
  { todo: true },
  () => {
    for (const svg of [
      '<svg onload=></svg>',
      '<svg onload=`alert(1)`></svg>',
    ]) {
      const { source, removed } = stripActiveContent(svg);
      assert.doesNotMatch(
        source,
        /onload/i,
        `onload survived stripping of ${JSON.stringify(svg)}`,
      );
      assert.notDeepEqual(
        removed,
        [],
        `stripping ${JSON.stringify(svg)} reported no removal`,
      );
      assert.deepEqual(findActiveContent(source), []);
    }
  },
);

test('detects script URIs in animation targets, not just href', () => {
  const svg = INERT.replace(
    '<rect',
    '<set attributeName="xlink:href" to="javascript:alert(1)"/><rect',
  );
  assert.deepEqual(findActiveContent(svg), [
    'contains a script URI in to="javascript:..."',
    'contains a <set> element that animates href (can install a script URI at runtime)',
  ]);
  assert.deepEqual(findActiveContent(stripActiveContent(svg).source), []);
});

test('detects markup-bearing data: URIs', () => {
  const svg = INERT.replace(
    'https://example.com/docs',
    'data:text/html;base64,PHNjcmlwdD4=',
  );
  assert.deepEqual(findActiveContent(svg), [
    'contains a script URI in href="data:text/html..."',
  ]);
});

test('does not flag inert data: URIs such as raster images', () => {
  const svg = INERT.replace(
    'https://example.com/docs',
    'data:image/png;base64,iVBOR',
  );
  assert.deepEqual(findActiveContent(svg), []);
});

test('detects active content nested inside foreignObject', () => {
  const svg = INERT.replace(
    '<rect',
    '<foreignObject><img src="x" onerror="alert(1)"/></foreignObject><rect',
  );
  assert.deepEqual(findActiveContent(svg), [
    'contains event handler attribute(s): onerror',
  ]);
  assert.deepEqual(findActiveContent(stripActiveContent(svg).source), []);
});

test('strips every finding from a heavily obfuscated payload', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<script type="text/ecmascript">alert(1)</script>' +
    '<a xlink:href="java&#115;cript&#58;alert(2)"><rect onmouseover="alert(3)"/></a>' +
    '</svg>';
  assert.equal(findActiveContent(svg).length, 3);

  const { source, removed } = stripActiveContent(svg);
  assert.ok(removed.length >= 3);
  assert.deepEqual(findActiveContent(source), []);
  assert.match(source, /viewBox="0 0 10 10"/);
});

test('flags an <animate> element that installs an href at runtime', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<a><animate attributeName="href" to="javascript:alert(1)" begin="0s"/><rect/></a>' +
    '</svg>';
  assert.ok(
    findActiveContent(svg).includes(
      'contains a <animate> element that animates href (can install a script URI at runtime)',
    ),
  );
  assert.deepEqual(findActiveContent(stripActiveContent(svg).source), []);
});

test('flags a paired <set> element animating xlink:href and leaves no orphan tag', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<a><set attributeName="xlink:href" to="javascript:alert(1)"></set><rect/></a>' +
    '</svg>';
  assert.ok(
    findActiveContent(svg).some((finding) => finding.includes('animates href')),
  );
  const { source } = stripActiveContent(svg);
  assert.doesNotMatch(source, /<\s*\/?\s*set\b/i);
  assert.match(source, /<rect\/>/);
  assert.deepEqual(findActiveContent(source), []);
});

test('leaves an ordinary animation of a presentation attribute alone', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<rect><animate attributeName="opacity" to="0.5"/></rect>' +
    '</svg>';
  assert.deepEqual(findActiveContent(svg), []);
  assert.equal(stripActiveContent(svg).source, svg);
});
