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
