import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mirrorArtworkUrls } from '../scripts/lib/architecture-content.mjs';
import {
  artworkMirrorPath,
  artworkPath,
} from '../scripts/lib/project-assets.mjs';

const PNG_URL =
  'https://raw.githubusercontent.com/cncf/artwork/main/projects/envoy/icon/color/envoy-icon-color.png';
const SVG_URL =
  'https://raw.githubusercontent.com/cncf/artwork/main/projects/helm/icon/color/helm-icon-color.svg';

const INERT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';

function withStubbedFetch(body, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  });
  try {
    return run();
  } finally {
    globalThis.fetch = original;
  }
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'mirror-artwork-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// writeFileSync() follows a symlink at the destination, so without a guard the
// fetched third-party bytes land on the link target instead of under
// static/img/cncf-projects -- outside the tree validate-architecture-assets.mjs
// scans, so the post-hoc asset gate never sees them. mirrorLandscapeLogo()
// already refuses this; these pin that mirrorArtworkUrls() does too.
for (const [label, url, body] of [
  ['a non-SVG asset', PNG_URL, 'ATTACKER-CONTROLLED-BYTES'],
  ['an SVG asset', SVG_URL, INERT_SVG],
]) {
  test(`mirrorArtworkUrls refuses to write ${label} through a symlinked destination`, async () => {
    const { root, cleanup } = sandbox();
    try {
      const relativeDestination = artworkMirrorPath(artworkPath(url));
      const destination = join(root, relativeDestination);
      mkdirSync(join(destination, '..'), { recursive: true });

      const outside = join(root, 'outside-target');
      writeFileSync(outside, 'protected');
      symlinkSync(outside, destination);

      await withStubbedFetch(body, () => mirrorArtworkUrls(root, [url]));

      assert.equal(
        readFileSync(outside, 'utf8'),
        'protected',
        'the symlink target must not be overwritten',
      );
      assert.ok(
        lstatSync(destination).isSymbolicLink(),
        'the destination must be left untouched',
      );
    } finally {
      cleanup();
    }
  });
}

test('mirrorArtworkUrls still writes a regular-file destination', async () => {
  const { root, cleanup } = sandbox();
  try {
    const relativeDestination = artworkMirrorPath(artworkPath(PNG_URL));
    await withStubbedFetch('mirrored-bytes', () =>
      mirrorArtworkUrls(root, [PNG_URL]),
    );
    assert.equal(
      readFileSync(join(root, relativeDestination), 'utf8'),
      'mirrored-bytes',
    );
  } finally {
    cleanup();
  }
});
