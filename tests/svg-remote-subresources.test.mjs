// Remote-subresource detection in findRemoteReferences(), for the reference
// shapes that carry no `href` attribute and no `url(` token.
//
// These live outside tests/svg-active-content.test.mjs because they cover a
// detection gap rather than the branch coverage that file is organised around:
// each case below passed the scanner silently before the `src`, `<link>` and
// bare-string `@import` handling was added, so each one fails without it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { findRemoteReferences } from '../scripts/lib/svg-active-content.mjs';

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`;

test('reports a remote src on HTML embedded in a foreignObject', () => {
  // `foreignObject` is deliberately allowed (draw.io emits it for ordinary
  // text), so the HTML inside it reaches the site origin. `<img src>` fetches
  // from the host in the value the moment the SVG is opened directly.
  assert.deepEqual(
    findRemoteReferences(
      svg(
        '<foreignObject><img src="https://evil.example/beacon.png"/></foreignObject>',
      ),
    ),
    [
      'references a remote resource in <img> src: https://evil.example/beacon.png',
    ],
  );
});

test('reports a remote src regardless of the element carrying it', () => {
  // `src` is not an SVG attribute, so unlike `href` there is no element it
  // reads as navigation on and nothing to allow-list against.
  assert.deepEqual(
    findRemoteReferences(
      svg(
        '<foreignObject><video src="//evil.example/clip.mp4"></video></foreignObject>',
      ),
    ),
    ['references a remote resource in <video> src: //evil.example/clip.mp4'],
  );
});

test('leaves a relative or data src alone', () => {
  assert.deepEqual(
    findRemoteReferences(
      svg(
        '<foreignObject><img src="./local.png"/><img src="data:image/png;base64,AAAA"/></foreignObject>',
      ),
    ),
    [],
  );
});

test('reports a remote stylesheet href on a <link>', () => {
  assert.deepEqual(
    findRemoteReferences(
      svg(
        '<foreignObject><link rel="stylesheet" href="https://evil.example/x.css"/></foreignObject>',
      ),
    ),
    ['references a remote resource in <link> href: https://evil.example/x.css'],
  );
});

test('reports a bare-string @import in a <style> block', () => {
  // Valid CSS with no `url(` token for the url() scan to find.
  assert.deepEqual(
    findRemoteReferences(
      svg('<style>@import "https://evil.example/x.css";</style>'),
    ),
    [
      'references a remote resource in a <style> block: https://evil.example/x.css',
    ],
  );
});

test('reports a single-quoted bare-string @import', () => {
  assert.deepEqual(
    findRemoteReferences(
      svg("<style>@import   'https://evil.example/sq.css';</style>"),
    ),
    [
      'references a remote resource in a <style> block: https://evil.example/sq.css',
    ],
  );
});

test('reports an @import target once when it is also a url()', () => {
  // The url() form matches both patterns; the finding is still reported once.
  assert.deepEqual(
    findRemoteReferences(
      svg('<style>@import url("https://evil.example/both.css");</style>'),
    ),
    [
      'references a remote resource in a <style> block: https://evil.example/both.css',
    ],
  );
});

test('leaves a relative @import alone', () => {
  assert.deepEqual(
    findRemoteReferences(svg('<style>@import "theme.css";</style>')),
    [],
  );
});

test('still reports nothing for an inert SVG', () => {
  assert.deepEqual(
    findRemoteReferences(
      svg(
        '<a href="https://example.com/docs"><rect width="10" height="10"/></a>',
      ),
    ),
    [],
  );
});

test('reports a remote url() in a fill presentation attribute', () => {
  // `style="fill:url(...)"` was already a finding; the presentation-attribute
  // spelling of the identical paint reference was not, so moving the value one
  // attribute over walked past the gate.
  assert.deepEqual(
    findRemoteReferences(
      svg('<rect fill="url(https://evil.example/paint.svg#g)"/>'),
    ),
    [
      'references a remote resource in a fill presentation attribute: https://evil.example/paint.svg#g',
    ],
  );
});

test('reports a remote url() in filter, mask and clip-path attributes', () => {
  assert.deepEqual(
    findRemoteReferences(
      svg(
        '<rect filter="url(https://evil.example/f.svg#f)" mask="url(\'//evil.example/m.svg#m\')" clip-path="url(https://evil.example/c.svg#c)"/>',
      ),
    ),
    [
      'references a remote resource in a clip-path presentation attribute: https://evil.example/c.svg#c',
      'references a remote resource in a filter presentation attribute: https://evil.example/f.svg#f',
      'references a remote resource in a mask presentation attribute: //evil.example/m.svg#m',
    ],
  );
});

test('leaves a same-document url() reference in a presentation attribute alone', () => {
  // The overwhelmingly common case: a local paint server or filter defined in
  // the same file. Flagging it would fail the existing diagram corpus.
  assert.deepEqual(
    findRemoteReferences(
      svg(
        '<defs><linearGradient id="g"/></defs><rect fill="url(#g)" filter="url(#blur)"/>',
      ),
    ),
    [],
  );
});

test('still reports a style attribute with its own wording', () => {
  assert.deepEqual(
    findRemoteReferences(
      svg('<rect style="fill:url(https://evil.example/paint.svg#g)"/>'),
    ),
    [
      'references a remote resource in a style attribute: https://evil.example/paint.svg#g',
    ],
  );
});
