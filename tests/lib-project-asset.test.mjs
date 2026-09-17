import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAsset } from '../scripts/lib/project-asset.mjs';

test('projectAsset passes through already-local paths', () => {
  assert.equal(
    projectAsset('/img/cncf-projects/kubernetes-icon.svg'),
    '/img/cncf-projects/kubernetes-icon.svg',
  );
});

test('projectAsset maps a mirrored cncf/artwork icon URL to its local path', () => {
  assert.equal(
    projectAsset(
      'https://raw.githubusercontent.com/cncf/artwork/main/projects/kubernetes/icon/color/kubernetes-icon-color.svg',
    ),
    '/img/cncf-projects/kubernetes-kubernetes-icon-color.svg',
  );
});

test('projectAsset fails closed for unrelated remote URLs instead of hot-linking them', () => {
  assert.equal(
    projectAsset(
      'https://upload.wikimedia.org/wikipedia/commons/9/9e/Logo_of_PowerDNS.svg',
    ),
    null,
  );
});

test('projectAsset fails closed for github.com URLs that are not artwork icons', () => {
  assert.equal(
    projectAsset(
      'https://github.com/netbox-community/netbox/blob/main/logo.png',
    ),
    null,
  );
});
