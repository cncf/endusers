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

// An image whose destination lives in a link-reference definition is the same
// image to the compiler as the inline form. The demotion above matched only
// `![alt](dest)`, so every reference form published its third-party host
// verbatim -- the beacon this module exists to stop, reachable by choosing a
// different spelling of the same image.
test('every reference-style image form is demoted when its definition is remote', () => {
  for (const image of ['![alt][beacon]', '![beacon][]', '![beacon]']) {
    const demoted = cleanMarkdown(
      `${image}\n\n[beacon]: https://evil.example/pixel.png`,
      'demo',
    );
    assert.ok(
      !demoted.includes('!['),
      `${image} was published as an image: ${demoted}`,
    );
    assert.ok(demoted.includes('](https://evil.example/pixel.png)'));
  }
});

test('a reference-style image is demoted whatever its destination spelling', () => {
  for (const definition of [
    '//evil.example/pixel.png',
    '<https://evil.example/pixel.png>',
    'HTTPS://evil.example/pixel.png',
  ]) {
    const demoted = cleanMarkdown(
      `![alt][beacon]\n\n[beacon]: ${definition}`,
      'demo',
    );
    assert.ok(
      !demoted.includes('!['),
      `${definition} was published as an image: ${demoted}`,
    );
  }
});

test('reference labels match the way CommonMark matches them', () => {
  // Labels are compared case-insensitively with internal whitespace
  // collapsed, so a label that only differs that way still resolves -- and
  // must still be demoted rather than slipping through unmatched.
  assert.equal(
    cleanMarkdown(
      '![alt][  My  Beacon ]\n\n[my beacon]: https://evil.example/p.png',
      'demo',
    ),
    '[alt](https://evil.example/p.png)\n\n[my beacon]: https://evil.example/p.png',
  );
});

test('a reference-style artwork image is rewritten to its mirrored path', () => {
  assert.equal(
    cleanMarkdown(`![Helm][logo]\n\n[logo]: ${ARTWORK_SVG}`, 'demo'),
    `![Helm](/img/cncf-projects/helm-helm-icon-color.svg)\n\n[logo]: ${ARTWORK_SVG}`,
  );
});

test('a reference-style relative image is scoped to the asset directory', () => {
  assert.equal(
    cleanMarkdown('![Diagram][d]\n\n[d]: images/local.png', 'demo'),
    '![Diagram](/img/architectures/demo/local.png)\n\n[d]: images/local.png',
  );
});

test('a destination the inline rules cannot express fails closed', () => {
  // The rules above match destinations as `[^\)]+`, so a destination
  // containing a parenthesis cannot be handed to them intact. Dropping the
  // `!` renders the construct as a link reference, which fetches nothing,
  // rather than leaving a live third-party image behind.
  assert.equal(
    cleanMarkdown('![alt][p]\n\n[p]: https://evil.example/a(b).png', 'demo'),
    '[alt][p]\n\n[p]: https://evil.example/a(b).png',
  );
});

test('an image reference with no definition is left as written', () => {
  assert.equal(cleanMarkdown('![alt][missing]', 'demo'), '![alt][missing]');
});

test('a text link reference is not turned into an image', () => {
  assert.equal(
    cleanMarkdown('See [Agones]\n\n[Agones]: https://agones.dev/site/', 'demo'),
    'See [Agones]\n\n[Agones]: https://agones.dev/site/',
  );
});
