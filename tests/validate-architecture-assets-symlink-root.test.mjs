// walk() already refuses to validate through a symlinked *entry*. These tests
// cover the walk roots, which are reached before walk() ever runs: a symlink at
// static/img/architectures or static/img/cncf-projects used to be followed,
// so files outside the published asset tree were validated as if they were
// assets and were written back through by --fix.
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-architecture-assets.mjs';

const DOCTYPE_SVG =
  '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>';

test('rejects a symlinked architecture asset root instead of following it', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    { 'outside/evil/diagram.svg': DOCTYPE_SVG },
    { symlinks: { 'static/img/architectures': '../../outside/evil' } },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /static\/img\/architectures: asset directory is a symbolic link/,
  );
  // The link target must not be reported as if it were a published asset.
  assert.doesNotMatch(result.stderr, /DOCTYPE/);
});

test('rejects a symlinked mirrored-artwork root instead of following it', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    { 'outside/evil/logo.svg': DOCTYPE_SVG },
    { symlinks: { 'static/img/cncf-projects': '../../outside/evil' } },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /static\/img\/cncf-projects: asset directory is a symbolic link/,
  );
});

test('--fix does not write through a symlinked asset root', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    { 'outside/evil/diagram.svg': DOCTYPE_SVG },
    {
      args: ['--fix'],
      symlinks: { 'static/img/architectures': '../../outside/evil' },
      readBack: ['outside/evil/diagram.svg'],
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.files['outside/evil/diagram.svg'], DOCTYPE_SVG);
});

test('a regular file at an asset root is skipped, not walked', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    'static/img/architectures': 'not a directory',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 0 architecture asset/);
});
