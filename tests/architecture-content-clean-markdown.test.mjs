import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanMarkdown } from '../scripts/lib/architecture-content.mjs';

// cleanMarkdown() is the last transform between third-party Markdown and a
// published docs/architectures page: the cncf/architecture importer and the
// submission-issue importer both run it, unattended, on text their authors
// control. A published <img> is fetched by every visitor's browser, so an
// image left pointing at a third-party host beacons that visitor's IP,
// User-Agent and Referer there. Nothing downstream re-checks the generated
// page for remote image references, so the demotion below is the gate.

const ARTWORK_SVG =
  'https://raw.githubusercontent.com/cncf/artwork/main/projects/helm/icon/color/helm-icon-color.svg';

test('a protocol-relative image is demoted to a plain link', () => {
  // "//host/x.png" inherits the page's https scheme and loads off-site
  // exactly like an absolute URL, while matching neither `https?://` nor the
  // local-path rewrite -- so it used to survive as a live remote <img>.
  assert.equal(
    cleanMarkdown('![beacon](//evil.example/b.png)', 'demo'),
    '[beacon](//evil.example/b.png)',
  );
});

test('an uppercase-scheme image is demoted rather than mangled', () => {
  // A browser reads HTTPS:// as https://. The old case-sensitive test missed
  // it, and the local-path rewrite then turned it into
  // "/img/architectures/demo/HTTPS://evil.example/b.png", a path that can
  // never resolve.
  assert.equal(
    cleanMarkdown('![beacon](HTTPS://evil.example/b.png)', 'demo'),
    '[beacon](HTTPS://evil.example/b.png)',
  );
});

test('an image on a scheme other than http(s) is demoted too', () => {
  assert.equal(
    cleanMarkdown('![beacon](ftp://evil.example/b.png)', 'demo'),
    '[beacon](ftp://evil.example/b.png)',
  );
});

test('an absolute http(s) image is still demoted', () => {
  assert.equal(
    cleanMarkdown('![beacon](https://evil.example/b.png)', 'demo'),
    '[beacon](https://evil.example/b.png)',
  );
});

test('a cncf/artwork image still resolves to its mirrored path', () => {
  assert.equal(
    cleanMarkdown(`![Helm](${ARTWORK_SVG})`, 'demo'),
    '![Helm](/img/cncf-projects/helm-helm-icon-color.svg)',
  );
});

test('relative images are still scoped to the architecture asset directory', () => {
  for (const destination of ['images/local.png', './local.png', 'local.png']) {
    assert.equal(
      cleanMarkdown(`![Diagram](${destination})`, 'demo'),
      '![Diagram](/img/architectures/demo/local.png)',
    );
  }
});

test('an already site-absolute image is left alone', () => {
  assert.equal(
    cleanMarkdown('![Diagram](/img/architectures/demo/x.png)', 'demo'),
    '![Diagram](/img/architectures/demo/x.png)',
  );
});

test('a protocol-relative plain link is left alone', () => {
  // Only images are demoted: a link is not fetched until the reader chooses
  // to follow it, so it leaks nothing on page load.
  assert.equal(
    cleanMarkdown('[docs](//example.com/x)', 'demo'),
    '[docs](//example.com/x)',
  );
});

test('demotes a reference-style remote image to a plain link', () => {
  assert.equal(
    cleanMarkdown('![beacon][b]\n\n[b]: https://evil.example/b.png', 'demo'),
    '[beacon](https://evil.example/b.png)\n\n[b]: https://evil.example/b.png',
  );
  assert.equal(
    cleanMarkdown('![beacon][]\n\n[beacon]: //evil.example/b.png', 'demo'),
    '[beacon](//evil.example/b.png)\n\n[beacon]: //evil.example/b.png',
  );
});

test('rebases a reference-style local image and drops a non-http scheme', () => {
  assert.equal(
    cleanMarkdown('![d][x]\n\n[x]: images/d.png', 'demo'),
    '![d](/img/architectures/demo/d.png)\n\n[x]: images/d.png',
  );
  assert.equal(cleanMarkdown('![hi](javascript:alert(1))', 'demo'), 'hi');
});

test('reduces a remote image inside a link to its alt text', () => {
  assert.equal(
    cleanMarkdown(
      '[![logo](https://evil.example/l.png)](https://example.com)',
      'demo',
    ),
    '[logo](https://example.com)',
  );
});

test('does not touch an image written inside a code span or fence', () => {
  const body =
    'Use `![x](https://evil.example/b.png)` here.\n\n```\n![x](https://evil.example/b.png)\n```';
  assert.equal(cleanMarkdown(body, 'demo'), body);
});

test('leaves an unresolved image reference and an absolute reference path alone', () => {
  assert.equal(cleanMarkdown('![a][missing]', 'demo'), '![a][missing]');
  assert.equal(
    cleanMarkdown('![a][x]\n\n[x]: /img/shared/a.png', 'demo'),
    '![a](/img/shared/a.png)\n\n[x]: /img/shared/a.png',
  );
});

test('keeps mirrored artwork referenced by definition and escapes labels and paths', () => {
  assert.equal(
    cleanMarkdown(`![He\\]lm][h]\n\n[h]: ${ARTWORK_SVG}`, 'demo'),
    cleanMarkdown(`![He\\]lm](${ARTWORK_SVG})`, 'demo') +
      `\n\n[h]: ${ARTWORK_SVG}`,
  );
  assert.equal(
    cleanMarkdown('![](<images/my diagram.png>)', 'demo'),
    '![](</img/architectures/demo/my diagram.png>)',
  );
  assert.equal(
    cleanMarkdown('![x](<https://evil.example/a b.png>)', 'demo'),
    '[x](<https://evil.example/a b.png>)',
  );
});
