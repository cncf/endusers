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
