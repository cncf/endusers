import assert from 'node:assert/strict';
import test from 'node:test';
import {
  artworkMirrorName,
  artworkMirrorPath,
  artworkPath,
  artworkUrls,
  projectAsset,
} from '../scripts/lib/project-assets.mjs';

test('artworkPath extracts the path from raw.githubusercontent artwork URLs', () => {
  assert.equal(
    artworkPath(
      'https://raw.githubusercontent.com/cncf/artwork/main/projects/helm/icon/color/helm-icon-color.svg',
    ),
    'projects/helm/icon/color/helm-icon-color.svg',
  );
});

test('artworkPath extracts the path from github.com raw artwork URLs', () => {
  assert.equal(
    artworkPath(
      'https://github.com/cncf/artwork/raw/main/projects/argo/horizontal/color/argo-horizontal-color.svg',
    ),
    'projects/argo/horizontal/color/argo-horizontal-color.svg',
  );
});

test('artworkPath accepts non-project artwork trees', () => {
  assert.equal(
    artworkPath(
      'https://github.com/cncf/artwork/raw/main/other/csi/horizontal/color/csi-horizontal-color.svg',
    ),
    'other/csi/horizontal/color/csi-horizontal-color.svg',
  );
});

test('artworkPath rejects hosts and repositories outside cncf/artwork', () => {
  for (const url of [
    'https://upload.wikimedia.org/wikipedia/commons/9/9e/Logo_of_PowerDNS.svg',
    'https://raw.githubusercontent.com/netbox-community/netbox/main/docs/netbox_logo_light.svg',
    'https://kubernetes-sigs.github.io/external-dns/latest/docs/img/external-dns.png',
    'https://landscape.cncf.io/logos/abc.svg',
    'https://raw.githubusercontent.com.evil.test/cncf/artwork/main/projects/helm/icon/color/x.svg',
  ]) {
    assert.equal(artworkPath(url), null, url);
  }
});

test('artworkPath rejects traversal segments', () => {
  assert.equal(
    artworkPath(
      'https://raw.githubusercontent.com/cncf/artwork/main/projects/../../etc/passwd',
    ),
    null,
  );
});

test('artworkPath strips query and fragment', () => {
  assert.equal(
    artworkPath(
      'https://raw.githubusercontent.com/cncf/artwork/main/projects/flux/icon/color/flux-icon-color.svg?raw=1',
    ),
    'projects/flux/icon/color/flux-icon-color.svg',
  );
});

test('artworkMirrorName keeps the historical name-file shape', () => {
  assert.equal(
    artworkMirrorName('projects/helm/icon/color/helm-icon-color.svg'),
    'helm-helm-icon-color.svg',
  );
  assert.equal(
    artworkMirrorName('projects/dapr/stacked/color/dapr-stacked-color.svg'),
    'dapr-dapr-stacked-color.svg',
  );
});

test('artworkMirrorPath targets the mirrored asset directory', () => {
  assert.equal(
    artworkMirrorPath('projects/helm/icon/color/helm-icon-color.svg'),
    'static/img/cncf-projects/helm-helm-icon-color.svg',
  );
});

test('projectAsset maps mirrored artwork to a local site path', () => {
  assert.equal(
    projectAsset(
      'https://raw.githubusercontent.com/cncf/artwork/main/projects/helm/icon/color/helm-icon-color.svg',
    ),
    '/img/cncf-projects/helm-helm-icon-color.svg',
  );
});

test('projectAsset passes through an already local path', () => {
  assert.equal(
    projectAsset('/img/cncf-projects/helm-helm-icon-color.svg'),
    '/img/cncf-projects/helm-helm-icon-color.svg',
  );
});

test('projectAsset never returns a remote URL', () => {
  for (const url of [
    'https://upload.wikimedia.org/wikipedia/commons/9/9e/Logo_of_PowerDNS.svg',
    'https://raw.githubusercontent.com/netbox-community/netbox/main/docs/netbox_logo_light.svg',
    'https://landscape.cncf.io/logos/abc.svg',
    'http://example.test/logo.png',
    '',
    undefined,
  ]) {
    const result = projectAsset(url);
    assert.equal(result, null, String(url));
  }
});

test('artworkUrls collects only cncf/artwork image references', () => {
  const body = [
    '![Helm](https://raw.githubusercontent.com/cncf/artwork/main/projects/helm/icon/color/helm-icon-color.svg)',
    '![PowerDNS](https://upload.wikimedia.org/wikipedia/commons/9/9e/Logo_of_PowerDNS.svg)',
    '[Argo](https://github.com/cncf/artwork/raw/main/projects/argo/horizontal/color/argo-horizontal-color.svg)',
    '[Docs](https://example.test/page)',
  ].join('\n\n');
  assert.deepEqual(artworkUrls(body).sort(), [
    'https://github.com/cncf/artwork/raw/main/projects/argo/horizontal/color/argo-horizontal-color.svg',
    'https://raw.githubusercontent.com/cncf/artwork/main/projects/helm/icon/color/helm-icon-color.svg',
  ]);
});

test('artwork with a non-image extension is never mirrored or mapped', () => {
  for (const file of ['helm.html', 'helm.js', 'helm.svg.exe', 'helm']) {
    const path = `projects/helm/icon/color/${file}`;
    assert.equal(artworkMirrorName(path), null, file);
    assert.equal(artworkMirrorPath(path), null, file);
    assert.equal(
      projectAsset(
        `https://raw.githubusercontent.com/cncf/artwork/main/${path}`,
      ),
      null,
      file,
    );
  }
});

// The guards below are what makes this module fail closed. Merged raw V8
// coverage across every suite (including the subprocess-sandboxed import
// pipeline tests) showed none of them executing, so a refactor could have
// removed or inverted any of them without a single test objecting.

test('artworkPath refuses non-string input rather than throwing', () => {
  // projectAsset type-checks before delegating, but artworkPath is exported
  // and called directly (scripts/import-architectures.mjs), so the guard is
  // load-bearing there.
  for (const value of [null, undefined, 42, 0, {}, ['x'], true]) {
    assert.equal(artworkPath(value), null, String(value));
  }
});

test('artworkMirrorName refuses a path with no name segment to mirror under', () => {
  // The mirrored name is <name>-<file>; a single-segment path has no <name>,
  // so it is dropped instead of being mirrored under a guessed one.
  for (const path of ['helm-icon.svg', 'projects', '']) {
    assert.equal(artworkMirrorName(path), null, JSON.stringify(path));
    assert.equal(artworkMirrorPath(path), null, JSON.stringify(path));
  }
});

test('a single-segment artwork URL fails closed rather than mirroring', () => {
  assert.equal(
    projectAsset(
      'https://raw.githubusercontent.com/cncf/artwork/main/helm.svg',
    ),
    null,
  );
});

test('artworkMirrorName does not double the filename when name equals file', () => {
  // projects/helm-icon.svg would otherwise mirror as
  // helm-icon.svg-helm-icon.svg.
  assert.equal(artworkMirrorName('projects/helm-icon.svg'), 'helm-icon.svg');
  assert.equal(
    artworkMirrorPath('projects/helm-icon.svg'),
    'static/img/cncf-projects/helm-icon.svg',
  );
  assert.equal(
    projectAsset(
      'https://raw.githubusercontent.com/cncf/artwork/main/projects/helm-icon.svg',
    ),
    '/img/cncf-projects/helm-icon.svg',
  );
});

test('artworkMirrorName falls back to the bare filename when the name segment is empty', () => {
  assert.equal(artworkMirrorName('other//x/logo.png'), 'logo.png');
  assert.equal(artworkMirrorName('projects/logo.png/logo.png'), 'logo.png');
});

test('an empty name segment in a URL is still rejected before mirroring', () => {
  // artworkMirrorName tolerates the shape, but artworkPath rejects the empty
  // segment first, so no such URL ever reaches the mirror.
  assert.equal(
    artworkPath(
      'https://raw.githubusercontent.com/cncf/artwork/main/projects//helm-icon.svg',
    ),
    null,
  );
  assert.equal(
    projectAsset(
      'https://raw.githubusercontent.com/cncf/artwork/main/projects//helm-icon.svg',
    ),
    null,
  );
});
