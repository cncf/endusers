import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  currentLandscapeAssetReferences,
  ensureOwnedAssetManifest,
  pruneOwnedLandscapeAssets,
  readOwnedAssetManifest,
} from '../scripts/lib/enduser-assets.mjs';

const OLD = '/img/end-user-members/aaaaaaaaaaaaaaaa-old.svg';
const NEW = '/img/end-user-members/bbbbbbbbbbbbbbbb-new.svg';

function withRoots(run) {
  const root = mkdtempSync(join(tmpdir(), 'endusers-assets-test-'));
  const assetRoot = join(root, 'static/img/end-user-members');
  const manifestPath = join(root, 'data/enduser-landscape-assets.json');
  mkdirSync(assetRoot, { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  try {
    run({ root, assetRoot, manifestPath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function snapshot(localLogo) {
  return {
    records: [
      {
        included: true,
        localLogo,
      },
    ],
  };
}

test('prunes only manifest-owned unreferenced files and preserves unrelated names', () => {
  withRoots(({ assetRoot, manifestPath }) => {
    writeFileSync(join(assetRoot, 'aaaaaaaaaaaaaaaa-old.svg'), 'old');
    writeFileSync(join(assetRoot, 'bbbbbbbbbbbbbbbb-new.svg'), 'new');
    writeFileSync(join(assetRoot, 'deadbeefdeadbeef-unrelated.svg'), 'keep');
    writeFileSync(
      manifestPath,
      JSON.stringify({ generated: true, assets: [OLD, NEW] }),
    );

    pruneOwnedLandscapeAssets({
      assetRoot,
      manifestPath,
      snapshot: snapshot(NEW),
      members: [],
    });

    assert.equal(
      existsSync(join(assetRoot, 'aaaaaaaaaaaaaaaa-old.svg')),
      false,
    );
    assert.equal(existsSync(join(assetRoot, 'bbbbbbbbbbbbbbbb-new.svg')), true);
    assert.equal(
      readFileSync(join(assetRoot, 'deadbeefdeadbeef-unrelated.svg'), 'utf8'),
      'keep',
    );
    assert.deepEqual(readOwnedAssetManifest(manifestPath), [NEW]);
  });
});

test('preserves a referenced old asset while a refreshed snapshot is pending', () => {
  withRoots(({ assetRoot, manifestPath }) => {
    writeFileSync(join(assetRoot, 'aaaaaaaaaaaaaaaa-old.svg'), 'old');
    writeFileSync(join(assetRoot, 'deadbeefdeadbeef-unrelated.svg'), 'keep');
    writeFileSync(
      manifestPath,
      JSON.stringify({ generated: true, assets: [OLD] }),
    );

    // No generator call means no prune call: a failed generation cannot
    // remove the old members output's referenced logo.
    assert.equal(existsSync(join(assetRoot, 'aaaaaaaaaaaaaaaa-old.svg')), true);
    assert.equal(
      existsSync(join(assetRoot, 'deadbeefdeadbeef-unrelated.svg')),
      true,
    );
  });
});

test('seeds ownership from the previous snapshot only once', () => {
  withRoots(({ manifestPath }) => {
    ensureOwnedAssetManifest(manifestPath, snapshot(OLD));
    ensureOwnedAssetManifest(manifestPath, snapshot(NEW));
    assert.deepEqual(readOwnedAssetManifest(manifestPath), [OLD]);
  });
});

test('does not delete a symlink or directory named by the ownership manifest', () => {
  withRoots(({ assetRoot, manifestPath }) => {
    const outside = join(assetRoot, '..', 'outside.svg');
    writeFileSync(outside, 'outside');
    symlinkSync(outside, join(assetRoot, 'aaaaaaaaaaaaaaaa-old.svg'));
    mkdirSync(join(assetRoot, 'bbbbbbbbbbbbbbbb-dir'));
    writeFileSync(
      manifestPath,
      JSON.stringify({
        generated: true,
        assets: [OLD, '/img/end-user-members/bbbbbbbbbbbbbbbb-dir'],
      }),
    );

    pruneOwnedLandscapeAssets({
      assetRoot,
      manifestPath,
      snapshot: snapshot(NEW),
      members: [],
    });
    assert.equal(existsSync(join(assetRoot, 'aaaaaaaaaaaaaaaa-old.svg')), true);
    assert.equal(existsSync(join(assetRoot, 'bbbbbbbbbbbbbbbb-dir')), true);
  });
});

test('rejects invalid or unsafe ownership manifests', () => {
  withRoots(({ manifestPath, assetRoot }) => {
    writeFileSync(manifestPath, JSON.stringify({ generated: false }));
    assert.throws(
      () => readOwnedAssetManifest(manifestPath),
      /manifest is invalid/,
    );
    writeFileSync(
      manifestPath,
      JSON.stringify({
        generated: true,
        assets: ['/img/end-user-members/../outside.svg'],
      }),
    );
    assert.throws(() => readOwnedAssetManifest(manifestPath), /unsafe path/);
    assert.equal(existsSync(assetRoot), true);
  });
});

test('treats absent snapshots, members, and membership sources as no references', () => {
  assert.deepEqual(
    [...currentLandscapeAssetReferences(undefined, undefined)],
    [],
  );
  assert.deepEqual([...currentLandscapeAssetReferences({}, [{}])], []);
});

test('collects references from both the snapshot and member membership sources', () => {
  const references = currentLandscapeAssetReferences(snapshot(OLD), [
    { membershipSources: [{ localLogo: NEW }, { localLogo: null }] },
    {},
  ]);
  assert.deepEqual([...references].sort(), [NEW, OLD].sort());
});

const UNSAFE = '/img/end-user-members/../outside.svg';

// isSafeAssetPath is the only gate between a manifest or snapshot path and an
// rmSync call, so each clause is pinned with an input that fails only it: a
// non-string, a path outside the asset prefix, a nested path under it and a
// traversal segment. An excluded record's logo is not a current reference
// even when the file still exists.
test('keeps only safe, prefixed, flat paths from included records', () => {
  const localLogos = [
    42,
    '/other/aaaaaaaaaaaaaaaa-old.svg',
    '/img/end-user-members/nested/aaaaaaaaaaaaaaaa-old.svg',
    UNSAFE,
    '/img/end-user-members/..hidden.svg',
    NEW,
  ];
  const references = currentLandscapeAssetReferences(
    {
      records: [
        ...localLogos.map((localLogo) => ({ included: true, localLogo })),
        { included: false, localLogo: OLD },
      ],
    },
    [{ membershipSources: [{ localLogo: UNSAFE }, { localLogo: 7 }] }],
  );
  assert.deepEqual([...references], [NEW]);
});

test('an absent ownership manifest owns nothing', () => {
  withRoots(({ manifestPath }) => {
    assert.deepEqual(readOwnedAssetManifest(manifestPath), []);
  });
});

test('rejects each malformed manifest shape and any unsafe entry', () => {
  withRoots(({ manifestPath }) => {
    const invalid = [
      'null',
      JSON.stringify({ generated: false, assets: [] }),
      JSON.stringify({ generated: true, assets: NEW }),
    ];
    for (const content of invalid) {
      writeFileSync(manifestPath, content);
      assert.throws(
        () => readOwnedAssetManifest(manifestPath),
        new Error('end-user asset manifest is invalid'),
      );
    }
    writeFileSync(
      manifestPath,
      JSON.stringify({ generated: true, assets: [NEW, UNSAFE] }),
    );
    assert.throws(
      () => readOwnedAssetManifest(manifestPath),
      new Error('end-user asset manifest contains an unsafe path'),
    );
    writeFileSync(
      manifestPath,
      JSON.stringify({ generated: true, assets: [NEW, OLD, NEW] }),
    );
    assert.deepEqual(readOwnedAssetManifest(manifestPath), [NEW, OLD]);
  });
});

// The manifest is committed, so its bytes are pinned: sorted, de-duplicated,
// two-space indented and newline-terminated, with unsafe previous references
// left out of the seed.
test('seeds and rewrites the manifest as sorted, de-duplicated, newline-terminated JSON', () => {
  const expected = (assets) =>
    JSON.stringify({ generated: true, assets }, null, 2) + '\n';
  withRoots(({ assetRoot, manifestPath }) => {
    ensureOwnedAssetManifest(manifestPath, {
      records: [NEW, UNSAFE, OLD, NEW].map((localLogo) => ({
        included: true,
        localLogo,
      })),
    });
    assert.equal(readFileSync(manifestPath, 'utf8'), expected([OLD, NEW]));

    // The old asset is owned but no longer referenced and is already gone
    // from disk: a stale manifest entry is skipped, not an error, and the
    // rewrite still lands with only the current references.
    const stillOwned = '/img/end-user-members/cccccccccccccccc-kept.svg';
    pruneOwnedLandscapeAssets({
      assetRoot,
      manifestPath,
      snapshot: snapshot(NEW),
      members: [
        { membershipSources: [{ localLogo: NEW }, { localLogo: stillOwned }] },
      ],
    });
    assert.equal(
      readFileSync(manifestPath, 'utf8'),
      expected([NEW, stillOwned]),
    );
  });
});
