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
