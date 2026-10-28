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
    cleanMarkdown('![beacon](//evil.example/b.png)'),
    '[beacon](//evil.example/b.png)',
  );
});

test('an uppercase-scheme image is demoted rather than mangled', () => {
  // A browser reads HTTPS:// as https://. The old case-sensitive test missed
  // it, and the local-path rewrite then turned it into
  // "./images/HTTPS://evil.example/b.png", a path that can
  // never resolve.
  assert.equal(
    cleanMarkdown('![beacon](HTTPS://evil.example/b.png)'),
    '[beacon](HTTPS://evil.example/b.png)',
  );
});

test('an absolute http(s) image is still demoted', () => {
  assert.equal(
    cleanMarkdown('![beacon](https://evil.example/b.png)'),
    '[beacon](https://evil.example/b.png)',
  );
});

test('a cncf/artwork image still resolves to its mirrored path', () => {
  assert.equal(
    cleanMarkdown(`![Helm](${ARTWORK_SVG})`),
    '![Helm](/img/cncf-projects/helm-helm-icon-color.svg)',
  );
});

test('relative images are scoped to the page images directory', () => {
  for (const destination of ['images/local.png', './local.png', 'local.png']) {
    assert.equal(
      cleanMarkdown(`![Diagram](${destination})`),
      '![Diagram](./images/local.png)',
    );
  }
});

test('an already site-absolute image is left alone', () => {
  assert.equal(
    cleanMarkdown('![Diagram](/img/shared/x.png)'),
    '![Diagram](/img/shared/x.png)',
  );
});

test('a protocol-relative plain link is left alone', () => {
  // Only images are demoted: a link is not fetched until the reader chooses
  // to follow it, so it leaks nothing on page load.
  assert.equal(
    cleanMarkdown('[docs](//example.com/x)'),
    '[docs](//example.com/x)',
  );
});

test('demotes a reference-style remote image to a plain link', () => {
  assert.equal(
    cleanMarkdown('![beacon][b]\n\n[b]: https://evil.example/b.png'),
    '[beacon](https://evil.example/b.png)\n\n[b]: https://evil.example/b.png',
  );
  assert.equal(
    cleanMarkdown('![beacon][]\n\n[beacon]: //evil.example/b.png'),
    '[beacon](//evil.example/b.png)\n\n[beacon]: //evil.example/b.png',
  );
});

test('rebases a reference-style local image and drops a non-http scheme', () => {
  assert.equal(
    cleanMarkdown('![d][x]\n\n[x]: images/d.png'),
    '![d](./images/d.png)\n\n[x]: images/d.png',
  );
  assert.equal(cleanMarkdown('![hi](javascript:alert(1))'), 'hi');
});

test('a script-capable image destination is reduced to alt text even with an authority prefix', () => {
  // REMOTE_DESTINATION matches "javascript://..." exactly as it matches
  // "https://host/x", so deciding the host question first rewrote the image
  // into a *link* carrying the same scheme. "//" is a JavaScript line comment
  // and "%0a" starts a new line, so that link runs alert(1) on click. Only
  // findActiveContent() stood between it and the published page.
  assert.equal(cleanMarkdown('![x](javascript://%0aalert(1))'), 'x');
  assert.equal(cleanMarkdown('![x](vbscript://x)'), 'x');
  assert.equal(
    cleanMarkdown('![x][r]\n\n[r]: javascript://%0aalert(1)'),
    'x\n\n[r]: javascript://%0aalert(1)',
  );
});

test('a schemed destination that names no host is reduced to alt text', () => {
  // The HAS_SCHEME arm catches what the scheme allowlist lets through but
  // REMOTE_DESTINATION does not: an allowed scheme that carries no authority.
  // It is not a usable image source, so the alt text is all that survives.
  assert.equal(cleanMarkdown('![x](mailto:a@b.example)'), 'x');
  assert.equal(cleanMarkdown('![x](tel:+15551234)'), 'x');
  assert.equal(cleanMarkdown('![x](data:image/png;base64,AAAA)'), 'x');
});

test('a disallowed scheme is reduced to alt text even when it names a host', () => {
  // Demoting ftp:// to a link would publish a scheme the publish-time gate
  // rejects. A schemeless //host is still demoted, since it inherits https.
  assert.equal(cleanMarkdown('![beacon](ftp://evil.example/b.png)'), 'beacon');
  assert.equal(
    cleanMarkdown('![beacon](//evil.example/b.png)'),
    '[beacon](//evil.example/b.png)',
  );
});

test('reduces a remote image inside a link to its alt text', () => {
  assert.equal(
    cleanMarkdown('[![logo](https://evil.example/l.png)](https://example.com)'),
    '[logo](https://example.com)',
  );
});

test('does not touch an image written inside a code span or fence', () => {
  const body =
    'Use `![x](https://evil.example/b.png)` here.\n\n```\n![x](https://evil.example/b.png)\n```';
  assert.equal(cleanMarkdown(body), body);
});

test('resolves a repeated label to its first definition', () => {
  // CommonMark and the renderer both give a repeated label to the first
  // definition, so the image policy has to be applied to that one: resolving
  // to the last instead rewrote the reference from a destination the published
  // page would never have loaded, and left this module disagreeing with the
  // publish-time gate in scripts/lib/mdx-active-content.mjs.
  assert.equal(
    cleanMarkdown(
      '![d][x]\n\n[x]: https://evil.example/b.png\n[x]: images/d.png',
    ),
    '[d](https://evil.example/b.png)\n\n[x]: https://evil.example/b.png\n[x]: images/d.png',
  );
  assert.equal(
    cleanMarkdown(
      '![d][x]\n\n[x]: images/d.png\n[x]: https://evil.example/b.png',
    ),
    '![d](./images/d.png)\n\n[x]: images/d.png\n[x]: https://evil.example/b.png',
  );
});

test('leaves an unresolved image reference and an absolute reference path alone', () => {
  assert.equal(cleanMarkdown('![a][missing]'), '![a][missing]');
  assert.equal(
    cleanMarkdown('![a][x]\n\n[x]: /img/shared/a.png'),
    '![a](/img/shared/a.png)\n\n[x]: /img/shared/a.png',
  );
});

test('keeps mirrored artwork referenced by definition and escapes labels and paths', () => {
  assert.equal(
    cleanMarkdown(`![He\\]lm][h]\n\n[h]: ${ARTWORK_SVG}`),
    cleanMarkdown(`![He\\]lm](${ARTWORK_SVG})`) + `\n\n[h]: ${ARTWORK_SVG}`,
  );
  assert.equal(
    cleanMarkdown('![](<images/my diagram.png>)'),
    '![](<./images/my diagram.png>)',
  );
  assert.equal(
    cleanMarkdown('![x](<https://evil.example/a b.png>)'),
    '[x](<https://evil.example/a b.png>)',
  );
});

// Edits are applied back to front so earlier offsets stay valid; a body with
// two rewrites is what exercises the ordering.
test('cleanMarkdown rewrites several references in one body', () => {
  assert.equal(
    cleanMarkdown(
      '![a](images/a.png) text ![b](https://evil.example/b.png) more ![c](./c.png)',
    ),
    '![a](./images/a.png) text [b](https://evil.example/b.png) more ![c](./images/c.png)',
  );
});

// Each row pins one character of the rewrite that a neighbouring input would
// not: an anchor, a quantifier, a scheme alternative or a replacement string.
const PINNED_REWRITES = [
  [
    'a "//" inside a relative path does not make it remote',
    '![x](sub//b.png)',
    '![x](./images/sub//b.png)',
  ],
  [
    'a ":" inside a relative path is not a scheme',
    '![x](images/a:b.png)',
    '![x](./images/a:b.png)',
  ],
  [
    'only a leading "./" and "images/" are stripped from a relative path',
    '![x](a/./b.png) ![y](sub/images/b.png)',
    '![x](./images/a/./b.png) ![y](./images/sub/images/b.png)',
  ],
  [
    'a bracket in alt text is escaped when the image is demoted',
    '![a\\]b](https://evil.example/x.png)',
    '[a\\]b](https://evil.example/x.png)',
  ],
  [
    'a remote image inside a reference-style link is reduced to alt text',
    '[![logo](https://evil.example/l.png)][r]\n\n[r]: https://example.com',
    '[logo][r]\n\n[r]: https://example.com',
  ],
  [
    'a site-absolute image keeps its title untouched',
    '![a](/img/a.png "title")',
    '![a](/img/a.png "title")',
  ],
  [
    'an image inside a GFM footnote is seen through the GFM grammar',
    '[^1]: ![x](https://evil.example/b.png)\n\nt[^1]',
    '[^1]: [x](https://evil.example/b.png)\n\nt[^1]',
  ],
  [
    'a footnote call inside alt text is dropped as the GFM tree does',
    '![a[^1]b](https://evil.example/x.png)\n\n[^1]: n',
    '[ab](https://evil.example/x.png)\n\n[^1]: n',
  ],
  [
    'a shortcode whose body contains ">" is removed whole',
    'a {{< a > b >}} c',
    'a  c',
  ],
  [
    'a shortcode uncovered by removing a nested one is removed too',
    'before {{{{< a >}}< b >}} after',
    'before  after',
  ],
  ['a closing shortcode is removed', 'a {{</ tabs >}} c', 'a  c'],
  [
    'a double-bracketed http link is unwrapped',
    '[[docs](http://example.com/d)]',
    '[docs](http://example.com/d)',
  ],
  ['an empty angle-bracket pair is escaped', 'a <> b', 'a &lt;&gt; b'],
  ['runs of blank lines collapse to one', 'a\n\n\n\nb', 'a\n\nb'],
  ['surrounding whitespace is trimmed', '\n\n x \n\n', 'x'],
];

for (const [label, body, expected] of PINNED_REWRITES) {
  test(`cleanMarkdown: ${label}`, () => {
    assert.equal(cleanMarkdown(body), expected);
  });
}
