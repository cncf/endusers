// walk() already refuses to validate through a symlinked *entry*. These tests
// cover the walk roots, which are reached before walk() ever runs: a symlink at
// docs/architectures/<id>/images or static/img/cncf-projects used to be followed,
// so files outside the published asset tree were validated as if they were
// assets and were written back through by --fix.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertInvalidAssets,
  assertValidAssets,
  assetDiagnostics,
  validateAssetFixtures,
} from './helpers-architecture-assets.mjs';

const DOCTYPE_SVG =
  '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>';

test('rejects a symlinked architecture asset root instead of following it', () => {
  const result = validateAssetFixtures(
    { 'outside/evil/diagram.svg': DOCTYPE_SVG },
    {
      symlinks: {
        'docs/architectures/example/images': '../../../outside/evil',
      },
    },
  );
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /docs\/architectures\/example\/images: asset directory is a symbolic link/,
  );
  // The link target must not be reported as if it were a published asset.
  assert.doesNotMatch(assetDiagnostics(result), /DOCTYPE/);
});

test('rejects a symlinked mirrored-artwork root instead of following it', () => {
  const result = validateAssetFixtures(
    { 'outside/evil/logo.svg': DOCTYPE_SVG },
    { symlinks: { 'static/img/cncf-projects': '../../outside/evil' } },
  );
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /static\/img\/cncf-projects: asset directory is a symbolic link/,
  );
});

test('--fix does not write through a symlinked asset root', () => {
  const result = validateAssetFixtures(
    { 'outside/evil/diagram.svg': DOCTYPE_SVG },
    {
      fix: true,
      symlinks: {
        'docs/architectures/example/images': '../../../outside/evil',
      },
      readBack: ['outside/evil/diagram.svg'],
    },
  );
  assertInvalidAssets(result);
  assert.equal(result.files['outside/evil/diagram.svg'], DOCTYPE_SVG);
});

test('a regular file at an asset root is skipped, not walked', () => {
  const result = validateAssetFixtures({
    'docs/architectures/example/images': 'not a directory',
  });
  assertValidAssets(result);
  assert.equal(result.assetCount, 0);
});
