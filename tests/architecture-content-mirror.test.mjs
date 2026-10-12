import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
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

// The destination guard has two arms. The symlink arm is pinned above; this is
// the other one -- an entry that exists but is not a regular file. It needs no
// adversary: a directory on a mirror path is what an interrupted run, or an
// upstream asset renamed from `<name>` to `<name>/<name>`, leaves behind, and
// `.github/workflows/import-architectures.yml` reruns `npm run
// import:architectures` daily over whatever the last run left. Without the
// guard, writeFileSync() would throw EISDIR and abort the whole import instead
// of skipping the one asset it cannot mirror.
test('mirrorArtworkUrls skips a destination that is not a regular file', async () => {
  const { root, cleanup } = sandbox();
  const originalWarn = console.warn;
  const warnings = [];
  try {
    const relativeDestination = artworkMirrorPath(artworkPath(PNG_URL));
    const destination = join(root, relativeDestination);
    // A directory, so the destination is neither a symlink nor a regular file:
    // the second operand of the guard is what has to reject it.
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, 'occupant'), 'left by an earlier run');

    console.warn = (...args) => warnings.push(args.join(' '));
    await withStubbedFetch('mirrored-bytes', () =>
      mirrorArtworkUrls(root, [PNG_URL]),
    );
  } finally {
    console.warn = originalWarn;
    cleanup();
  }

  // Skipping has to be audible: a silent `continue` would leave the asset
  // missing with nothing in the import log explaining why.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /destination is not a regular file/);
});

test('mirrorArtworkUrls leaves an irregular destination byte-for-byte alone', async () => {
  const { root, cleanup } = sandbox();
  const originalWarn = console.warn;
  try {
    const relativeDestination = artworkMirrorPath(artworkPath(PNG_URL));
    const destination = join(root, relativeDestination);
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, 'occupant'), 'left by an earlier run');

    console.warn = () => {};
    await withStubbedFetch('mirrored-bytes', () =>
      mirrorArtworkUrls(root, [PNG_URL]),
    );
    console.warn = originalWarn;

    assert.ok(
      lstatSync(destination).isDirectory(),
      'the destination must still be the directory it was',
    );
    assert.deepEqual(
      readdirSync(destination),
      ['occupant'],
      'nothing may be written underneath the occupied destination',
    );
    assert.equal(
      readFileSync(join(destination, 'occupant'), 'utf8'),
      'left by an earlier run',
      'the occupant must not be overwritten',
    );
  } finally {
    console.warn = originalWarn;
    cleanup();
  }
});
