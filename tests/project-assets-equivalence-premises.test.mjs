/**
 * Premises that make three mutants in scripts/lib/project-assets.mjs
 * equivalent.
 *
 * Each mutant is annotated at its site with a `// Stryker disable next-line`
 * directive naming the premise it rests on. A premise that stops holding turns
 * one of those annotations into a silent suppression of a real gap, so the
 * premises are asserted here rather than left to the comment alone. These are
 * behavioural assertions on the module's public surface: they do not read the
 * source as text, so they run unchanged under Stryker's instrumented copy.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  artworkMirrorName,
  artworkPath,
  artworkUrls,
} from '../scripts/lib/project-assets.mjs';
import { MIRRORABLE_ASSET_EXTENSIONS } from '../scripts/lib/asset-extensions.mjs';

// Premise for the two `https?` harvest patterns in artworkUrls(). Widening
// them to the cleartext scheme is what the surviving Regex mutants undo, and
// it changes nothing because every URL they harvest is then handed to
// artworkPath(), whose patterns are anchored at `https://`. The harvest step
// cannot admit an http URL that the resolution step would keep.
test('an http artwork URL resolves to no artwork path', () => {
  for (const url of [
    'http://raw.githubusercontent.com/cncf/artwork/main/projects/argo/icon/color/argo-icon-color.svg',
    'http://github.com/cncf/artwork/raw/master/projects/argo/icon/color/argo-icon-color.png',
  ]) {
    assert.equal(artworkPath(url), null, url);
  }
});

test('artworkUrls collects no http URL from either harvest pattern', () => {
  const image =
    '![logo](http://raw.githubusercontent.com/cncf/artwork/main/projects/argo/icon/color/argo-icon-color.svg)';
  const link =
    '[logo](http://raw.githubusercontent.com/cncf/artwork/main/projects/argo/icon/color/argo-icon-color.png)';

  assert.deepEqual(artworkUrls(image), []);
  assert.deepEqual(artworkUrls(link), []);

  // The same references over https are collected, so the empty results above
  // are the scheme being refused and not the patterns failing to match.
  assert.deepEqual(artworkUrls(image.replace('http://', 'https://')), [
    'https://raw.githubusercontent.com/cncf/artwork/main/projects/argo/icon/color/argo-icon-color.svg',
  ]);
  assert.deepEqual(artworkUrls(link.replace('http://', 'https://')), [
    'https://raw.githubusercontent.com/cncf/artwork/main/projects/argo/icon/color/argo-icon-color.png',
  ]);
});

// Premise for the `file.includes('.')` guard in artworkMirrorName(). Emptying
// that string literal makes the guard vacuously true, leaving the extension
// check alone to reject a dotless filename. It still does, because
// `file.slice(file.lastIndexOf('.'))` falls back to the final character when
// there is no dot, and no mirrorable extension is a single character: every
// entry carries the leading dot.
test('every mirrorable asset extension starts with a dot', () => {
  for (const extension of MIRRORABLE_ASSET_EXTENSIONS) {
    assert.equal(extension[0], '.', extension);
    assert.ok(extension.length > 1, extension);
  }
});

test('artworkMirrorName rejects a dotless filename on the extension check', () => {
  for (const path of [
    'projects/argo/icon/color/argo-icon-color',
    // A trailing character that spells a mirrorable extension without its dot
    // is the case the dot guard would otherwise be carrying on its own.
    'projects/argo/icon/color/svg',
    'projects/argo/icon/color/g',
  ]) {
    assert.equal(artworkMirrorName(path), null, path);
  }
});
