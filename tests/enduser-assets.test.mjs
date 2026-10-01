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
  ensureOwnedAssetManifest,
  pruneOwnedLandscapeAssets,
  readOwnedAssetManifest,
} from '../scripts/lib/enduser-assets.mjs';

const OLD = '/img/end-user-members/aaaaaaaaaaaaaaaa-old.svg';
const NEW = '/img/end-user-members/bbbbbbbbbbbbbbbb-new.svg';
const UNRELATED = '/img/end-user-members/deadbeefdeadbeef-unrelated.svg';

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
