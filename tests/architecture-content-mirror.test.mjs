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
// `.github/workflows/architecture-submission.yml` reruns the issue importer
// over whatever the last run left. Without the guard, writeFileSync() would
// throw EISDIR and abort the whole import instead of skipping the one asset it
// cannot mirror.
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

// The fetch-and-write arm. A mirrored SVG is published from static/ at the
// site origin, so the two content gates -- stripping script-capable content and
// refusing remote resource references -- have to run before the bytes reach
// disk; the asset validator only sees what was written. The fetch itself can
// also fail, and a failed asset must be skipped and reported rather than abort
// the remaining URLs.

function captureWarnings(run) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  return Promise.resolve()
    .then(run)
    .then(() => warnings)
    .finally(() => {
      console.warn = originalWarn;
    });
}

test('mirrorArtworkUrls strips active content from a mirrored SVG and says so', async () => {
  const { root, cleanup } = sandbox();
  try {
    const destination = join(root, artworkMirrorPath(artworkPath(SVG_URL)));
    const warnings = await captureWarnings(() =>
      withStubbedFetch(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>',
        () => mirrorArtworkUrls(root, [SVG_URL]),
      ),
    );
    const written = readFileSync(destination, 'utf8');
    assert.ok(!written.includes('<script'), written);
    assert.ok(written.includes('<rect'), written);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^Removed active content from mirrored asset /);
  } finally {
    cleanup();
  }
});

test('mirrorArtworkUrls writes an inert SVG without a warning', async () => {
  const { root, cleanup } = sandbox();
  try {
    const destination = join(root, artworkMirrorPath(artworkPath(SVG_URL)));
    const warnings = await captureWarnings(() =>
      withStubbedFetch(INERT_SVG, () => mirrorArtworkUrls(root, [SVG_URL])),
    );
    assert.equal(readFileSync(destination, 'utf8'), INERT_SVG);
    assert.deepEqual(warnings, []);
  } finally {
    cleanup();
  }
});

test('mirrorArtworkUrls refuses an SVG that references a remote host', async () => {
  const { root, cleanup } = sandbox();
  try {
    const destination = join(root, artworkMirrorPath(artworkPath(SVG_URL)));
    const warnings = await captureWarnings(() =>
      withStubbedFetch(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://evil.example/beacon.png"/></svg>',
        () => mirrorArtworkUrls(root, [SVG_URL]),
      ),
    );
    assert.equal(lstatSync(destination, { throwIfNoEntry: false }), undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /remote resource references/);
  } finally {
    cleanup();
  }
});

test('mirrorArtworkUrls reports a failed fetch and keeps going', async () => {
  const { root, cleanup } = sandbox();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) =>
      url === PNG_URL
        ? { ok: false, status: 503 }
        : {
            ok: true,
            status: 200,
            arrayBuffer: async () => new TextEncoder().encode(INERT_SVG).buffer,
          };
    const warnings = await captureWarnings(() =>
      mirrorArtworkUrls(root, [PNG_URL, SVG_URL]),
    );
    assert.equal(
      lstatSync(join(root, artworkMirrorPath(artworkPath(PNG_URL))), {
        throwIfNoEntry: false,
      }),
      undefined,
    );
    assert.equal(
      readFileSync(join(root, artworkMirrorPath(artworkPath(SVG_URL))), 'utf8'),
      INERT_SVG,
    );
    assert.deepEqual(warnings, [
      `Could not mirror CNCF project asset: ${artworkPath(PNG_URL)}: HTTP 503`,
    ]);
  } finally {
    globalThis.fetch = original;
    cleanup();
  }
});

test('mirrorArtworkUrls ignores URLs that are not mirrorable artwork', async () => {
  const { root, cleanup } = sandbox();
  try {
    let fetched = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      fetched += 1;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    };
    try {
      await mirrorArtworkUrls(root, [
        // Not a cncf/artwork URL at all.
        'https://evil.example/logo.png',
        // Artwork, but an extension the mirror does not accept.
        'https://raw.githubusercontent.com/cncf/artwork/main/projects/helm/icon/color/helm-icon-color.pdf',
      ]);
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(fetched, 0);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    cleanup();
  }
});
