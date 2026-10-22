import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findActiveContent,
  findRemoteReferences,
  hasDoctype,
  stripActiveContent,
  stripDoctype,
} from '../scripts/lib/svg-active-content.mjs';

const INERT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><a href="https://example.com/docs"><rect width="10" height="10" fill="#fff"/></a></svg>';

const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">';
const svg = (body) => `${SVG_OPEN}${body}</svg>`;

test('reports nothing for an inert SVG', () => {
  assert.deepEqual(findActiveContent(INERT), []);
  assert.deepEqual(stripActiveContent(INERT), { source: INERT, removed: [] });
});

// Each row is markup the allowlist does not cover, the finding it produces and
// what stripping removes. The bypasses the denylist this gate replaced kept
// missing are rows here, so a regression in any of them fails by name.
const REJECTED = [
  [
    'script element and its contents',
    '<script>alert(1)</script>',
    ['contains a disallowed element <script>'],
    ['<script> element'],
  ],
  [
    'event handler attribute',
    '<rect onload="alert(1)"/>',
    ['contains a disallowed attribute onload on <rect>'],
    ['onload attribute'],
  ],
  [
    'animation that installs an href at runtime',
    '<a><set attributeName="href" to="javascript:alert(1)"/></a>',
    ['contains a disallowed element <set>'],
    ['<set> element'],
  ],
  [
    'namespace-prefixed script element',
    '<s:script xmlns:s="http://www.w3.org/2000/svg">alert(1)</s:script>',
    ['contains a disallowed element <s:script>'],
    ['<s:script> element'],
  ],
  [
    'unknown namespace declaration',
    '<g xmlns:m="http://www.w3.org/1998/Math/MathML"/>',
    ['contains a disallowed attribute xmlns:m on <g>'],
    ['xmlns:m attribute'],
  ],
  [
    'SVG element in no namespace',
    '<rect xmlns=""/>',
    ['contains a disallowed element <rect> (namespace none)'],
    ['<rect> element'],
  ],
  [
    'form action on HTML in a foreignObject',
    '<foreignObject><form xmlns="http://www.w3.org/1999/xhtml" action="https://evil.example/"/></foreignObject>',
    [
      'contains a disallowed element <form> (namespace http://www.w3.org/1999/xhtml)',
    ],
    ['<form> element'],
  ],
  [
    'document-embedding attribute on HTML',
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml" srcdoc="x"/></foreignObject>',
    ['contains a disallowed attribute srcdoc on <div>'],
    ['srcdoc attribute'],
  ],
  [
    'script URI in href',
    '<a href="javascript:alert(1)"/>',
    ['contains a disallowed URI scheme in href on <a>: javascript:'],
    ['href attribute (javascript:)'],
  ],
  [
    'unknown scheme in xlink:href',
    '<use xlink:href="foo:bar"/>',
    ['contains a disallowed URI scheme in xlink:href on <use>: foo:'],
    ['xlink:href attribute (foo:)'],
  ],
  [
    'markup-bearing data: URI',
    '<image href="data:image/svg+xml,x"/>',
    ['contains a disallowed URI scheme in href on <image>: data:image/svg+xml'],
    ['href attribute (data:image/svg+xml)'],
  ],
  [
    'script URI in a presentation attribute url()',
    `<rect fill="url('javascript:alert(1)')"/>`,
    ['contains a disallowed URI scheme in fill on <rect>: javascript:'],
    ['fill attribute (javascript:)'],
  ],
  [
    'malformed url() token, which this scan cannot read',
    '<rect fill="url(javascript:alert(1))"/>',
    ['contains a disallowed URI scheme in fill on <rect>: malformed url()'],
    ['fill attribute (malformed url())'],
  ],
  [
    'script URI in a <style> block',
    '<style>rect{fill:url(javascript:x)}</style>',
    ['contains a disallowed URI scheme in a <style> block: javascript:'],
    ['<style> element (javascript:)'],
  ],
];

for (const [label, body, findings, removals] of REJECTED) {
  test(`rejects and strips ${label}`, () => {
    const source = svg(body);
    assert.deepEqual(findActiveContent(source), findings);
    const stripped = stripActiveContent(source);
    assert.deepEqual(stripped.removed, removals);
    assert.deepEqual(findActiveContent(stripped.source), []);
  });
}

// The scheme test runs on the value a browser decodes, so a reference or a
// control character cannot split a scheme into something the allowlist skips.
test('sees through entity and control-character obfuscation of a scheme', () => {
  for (const payload of [
    'java&#115;cript:alert(1)',
    'javascript&#58;alert(1)',
    'java&#x73;cript:alert(1)',
    'javascript&amp;#x3a;alert(1)',
    'java\tscript:alert(1)',
    ' JaVaScRiPt:alert(1)',
  ]) {
    assert.deepEqual(
      findActiveContent(svg(`<a href="${payload}"/>`)),
      ['contains a disallowed URI scheme in href on <a>: javascript:'],
      JSON.stringify(payload),
    );
  }
});

test('accepts the corpus vocabulary: editor metadata, data-* and raster data:', () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" content="&lt;mxfile/&gt;" inkscape:version="1">' +
    '<inkscape:page x="0" width="1"><inkscape:anything/></inkscape:page>' +
    '<g data-cell-id="1"><image href="data:image/png;base64,AA"/><use href="#a"/></g>' +
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml" style="color:red"><br/></div></foreignObject>' +
    '<a href="mailto:x@example.com"/></svg>';
  assert.deepEqual(findActiveContent(source), []);
  assert.deepEqual(stripActiveContent(source), { source, removed: [] });
});

// An XML parser treats a character reference outside the Unicode range as a
// fatal error, so such a document is rejected as malformed rather than decoded
// into -- or around -- a scheme. So is an unquoted or missing attribute value.
test('rejects markup an XML parser refuses as not well-formed', () => {
  for (const body of [
    '<a href="java&#x110000;cript:alert(1)"/>',
    '<a href="java&#1114112;cript:alert(1)"/>',
    '<a href="&unknown;javascript:alert(1)"/>',
    '<a onload=/>',
    '<a onload=`alert(1)`/>',
    '<a href=javascript:alert(1)/>',
    '<rect fill=#fff/>',
    '<x:rect/>',
  ]) {
    const source = svg(body);
    assert.match(findActiveContent(source)[0], /^is not well-formed XML/, body);
    assert.throws(() => stripActiveContent(source), {
      message: /is not well-formed XML/,
    });
  }
});

test('reads a single-quoted value without disturbing inert markup', () => {
  const source = svg("<rect fill='#fff' width='10'/>");
  assert.deepEqual(stripActiveContent(source), { source, removed: [] });
});

// findRemoteReferences is a separate gate from findActiveContent: a remote
// reference executes nothing, so it is not "active content", but the browser
// still fetches it from a host the upstream diagram author chose and thereby
// discloses the visitor's IP address, User-Agent and Referer to that host.
// Imported project artwork is mirrored locally to prevent exactly this
// (scripts/lib/project-assets.mjs); these tests hold the diagrams themselves
// to the same standard.
test('reports nothing remote for an inert SVG', () => {
  assert.deepEqual(findRemoteReferences(INERT), []);
});

test('a plain <a> hyperlink is not a remote reference', () => {
  // draw.io stamps this exact link into exports with text-rendering problems,
  // and it is present in the imported corpus today. A hyperlink is navigation
  // the visitor chooses, not a load the page performs, so flagging it would
  // fail every such diagram on import.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://www.drawio.com/doc/faq/svg-export-text-problems"><text>x</text></a></svg>';
  assert.deepEqual(findRemoteReferences(svg), []);
});

for (const [label, element] of [
  ['image', 'image'],
  ['use', 'use'],
  ['feImage', 'feImage'],
]) {
  test(`detects a remote href on <${label}>`, () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><${element} href="https://evil.example/beacon.png"/></svg>`;
    assert.deepEqual(findRemoteReferences(svg), [
      `references a remote resource in <${element.toLowerCase()}> href: https://evil.example/beacon.png`,
    ]);
  });
}

test('detects a remote xlink:href, the legacy spelling', () => {
  assert.deepEqual(
    findRemoteReferences(
      svg('<image xlink:href="http://evil.example/b.png"/>'),
    ),
    [
      'references a remote resource in <image> xlink:href: http://evil.example/b.png',
    ],
  );
});

test('detects a protocol-relative reference, which inherits https at the origin', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="//evil.example/b.png"/></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in <image> href: //evil.example/b.png',
  ]);
});

// The URL parser treats `\` as `/` in the scheme and authority prefix of a
// special-scheme URL, and the site is served over https. Each value below
// therefore reaches evil.example in a browser exactly as `//evil.example`
// does, so a `//`-only remote test reads a cross-origin fetch as a local path.
for (const [value, expected] of [
  ['\\\\evil.example/b.png', '//evil.example/b.png'],
  ['/\\evil.example/b.png', '//evil.example/b.png'],
  ['\\/evil.example/b.png', '//evil.example/b.png'],
  ['\\\\\\evil.example/b.png', '//evil.example/b.png'],
  ['https:\\\\evil.example/b.png', 'https://evil.example/b.png'],
  ['https:/\\evil.example/b.png', 'https://evil.example/b.png'],
  ['https:\\/evil.example/b.png', 'https://evil.example/b.png'],
]) {
  test(`detects a backslash authority prefix: ${value}`, () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="${value}"/></svg>`;
    assert.deepEqual(findRemoteReferences(svg), [
      `references a remote resource in <image> href: ${expected}`,
    ]);
  });
}

// Only the leading run of separators is an authority. A single separator keeps
// the value on this origin, and an interior backslash is an ordinary path
// character -- flagging either would fail diagrams that reference their own
// sibling assets.
for (const [label, value] of [
  ['a single leading backslash, which is a path on this origin', '\\local.png'],
  ['a scheme with a single separator', 'https:/local.png'],
  ['an interior backslash in a relative path', 'a\\b/c.png'],
  ['a backslash inside a dot-relative path', './sub\\dir/x.png'],
]) {
  test(`does not flag ${label}`, () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="${value}"/></svg>`;
    assert.deepEqual(findRemoteReferences(svg), []);
  });
}

// `http:` is not the scheme this site is served over, so the parser never
// treats it as relative: it skips however many separators follow -- including
// none -- and reads the next component as the host. Each value below loads
// from evil.example in a browser exactly as `http://evil.example` does, and a
// browser that auto-upgrades the mixed-content request still sends the
// visitor's IP, User-Agent and Referer to that host.
for (const [value, expected] of [
  ['http:evil.example/b.png', 'http://evil.example/b.png'],
  ['http:/evil.example/b.png', 'http://evil.example/b.png'],
  ['http:\\evil.example/b.png', 'http://evil.example/b.png'],
  ['http:///evil.example/b.png', 'http://evil.example/b.png'],
  ['HTTP:evil.example/b.png', 'http://evil.example/b.png'],
]) {
  test(`detects a slashless http: authority: ${value}`, () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="${value}"/></svg>`;
    assert.deepEqual(findRemoteReferences(svg), [
      `references a remote resource in <image> href: ${expected}`,
    ]);
  });
}

// The same shape under the *site's own* scheme is relative, and a scheme with
// no host after it is not a URL the parser accepts. Flagging either would
// fail a diagram that references its own sibling assets.
for (const [label, value] of [
  ['an https: value with no separator, which is a sibling path', 'https:a.png'],
  ['an http: scheme with no host at all', 'http:'],
  ['an http: scheme followed only by a query', 'http:?q'],
  ['an http: scheme followed only by a fragment', 'http:#f'],
]) {
  test(`does not flag ${label}`, () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="${value}"/></svg>`;
    assert.deepEqual(findRemoteReferences(svg), []);
  });
}

test('detects a slashless http: authority in a CSS url()', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>rect{fill:url(http:evil.example/b.png)}</style><rect/></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: http://evil.example/b.png',
  ]);
});

test('detects a remote url() in a <style> block, including @font-face src', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@font-face{font-family:x;src:url(https://evil.example/f.woff)}</style><text style="font-family:x">a</text></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/f.woff',
  ]);
});

test('detects a remote url() in a style attribute', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(\'https://evil.example/p.png\')"/></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a style attribute: https://evil.example/p.png',
  ]);
});

test('a raw > inside an earlier attribute value does not hide the remote href', () => {
  // `>` is legal unescaped inside an XML attribute value, so a tag scanner
  // that stops at the first `>` would never see the href after it.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><image alt=">" href="https://evil.example/b.png"/></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in <image> href: https://evil.example/b.png',
  ]);
});

test('entity-obfuscated schemes are normalized before the remote test', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https&#58;//evil.example/b.png"/></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in <image> href: https://evil.example/b.png',
  ]);
});

for (const [label, value] of [
  [
    'a data: URI, which resolves without a network request',
    'data:image/png;base64,iVBORw0KGgo=',
  ],
  ['a fragment reference into the same document', '#local'],
  ['a relative path', './local.png'],
]) {
  test(`does not flag ${label}`, () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="${value}"/></svg>`;
    assert.deepEqual(findRemoteReferences(svg), []);
  });
}

test('does not flag a local url() reference such as a gradient', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>rect{fill:url(#grad)}</style><rect/></svg>';
  assert.deepEqual(findRemoteReferences(svg), []);
});

test('reports each distinct remote target once, sorted', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://b.example/2.png"/><image href="https://a.example/1.png"/><image href="https://b.example/2.png"/></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in <image> href: https://a.example/1.png',
    'references a remote resource in <image> href: https://b.example/2.png',
  ]);
});

test('a single-quoted href is read as a value, not skipped', () => {
  // ATTRIBUTE_PATTERN has three value alternatives -- double-quoted,
  // single-quoted and bare -- and findRemoteReferences reads whichever one
  // matched. Only the double-quoted alternative is exercised above, so a
  // regression that dropped the other two would still pass every test here.
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg'><image href='https://evil.example/sq.png'/></svg>";
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in <image> href: https://evil.example/sq.png',
  ]);
});

test('an unquoted href is rejected as not well-formed', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><image href=https://evil.example/uq.png /></svg>';
  const findings = findRemoteReferences(svg);
  assert.match(findings[0], /^is not well-formed XML/);
});

test('an empty <style> block does not break the block scan that follows it', () => {
  // The block scan reads from the end of the open tag to the close tag, so an
  // empty block yields empty CSS. Nothing may be reported for the block
  // itself, and the rest of the document still has to be scanned.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style></style><image href="https://evil.example/after.png"/></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in <image> href: https://evil.example/after.png',
  ]);
});

test('a </style> inside a CDATA section does not end the <style> block', () => {
  // A browser parses a standalone .svg as XML, where a `</style>` inside a
  // CDATA section is character data and does not close the element. A lazy
  // `<style ...>([\s\S]*?)</style>` match stops there anyway, so every
  // declaration after it went unscanned in a file that is well-formed and
  // renders -- a live remote fetch hidden from the gate that keeps a
  // visitor's IP, User-Agent and Referer off a host the diagram chose.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style type="text/css"><![CDATA[' +
    '/* </style> */ rect{fill:url(https://evil.example/track.svg#g)}' +
    ']]></style><rect width="10" height="10"/></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/track.svg#g',
  ]);
});

test('an unterminated CDATA section inside <style> is rejected as not well-formed', () => {
  // The parser cannot say where the section ends, so what it holds is not
  // readable; the file is rejected rather than certified.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[' +
    'rect{fill:url(https://evil.example/track.svg#g)}';
  assert.match(findRemoteReferences(svg)[0], /^is not well-formed XML/);
});

test('a <style> block after a CDATA-hiding one is still scanned', () => {
  // The scan resumes at the real close tag, not at the decoy, so a second
  // block cannot be skipped by hiding a `</style>` in the first.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<style><![CDATA[/* </style> */ a{fill:url(https://a.example/1.svg#g)}]]></style>' +
    '<style>b{fill:url(https://b.example/2.svg#g)}</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://a.example/1.svg#g',
    'references a remote resource in a <style> block: https://b.example/2.svg#g',
  ]);
});

test('an unclosed <style> block is rejected as not well-formed', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><defs><style type="text/css">' +
    'rect{fill:url(https://evil.example/late.svg#g)}';
  const findings = findRemoteReferences(svg);
  assert.match(findings[0], /^is not well-formed XML/);
  assert.ok(findings.some((finding) => finding.includes('evil.example/late')));
});

test('a self-closing <style/> swallows no content', () => {
  // `<style/>` has no body; treating what follows it as CSS would report a
  // local `url(#id)` reference as remote-adjacent noise and, worse, would
  // make the scan's idea of where CSS ends depend on later markup.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style /><image href="https://evil.example/after.png"/></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in <image> href: https://evil.example/after.png',
  ]);
});

test('a long remote target is truncated so one URL cannot flood the output', () => {
  // A data-bearing URL can be arbitrarily long, and these findings are printed
  // one per line by the import and validation gates.
  const target = `https://evil.example/${'a'.repeat(200)}.png`;
  const [finding] = findRemoteReferences(
    `<svg xmlns="http://www.w3.org/2000/svg"><image href="${target}"/></svg>`,
  );
  const reported = finding.slice(finding.indexOf('href: ') + 'href: '.length);
  assert.equal(reported.length, 120);
  assert.ok(reported.endsWith('...'));
  assert.ok(target.startsWith(reported.slice(0, -3)));
});

test('an undefined named entity is rejected as not well-formed', () => {
  // XML defines five named entities. A browser treats any other reference,
  // `&nbsp;` included, as a fatal error rather than a character, so it must
  // not be decoded into a scheme here either.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="java&nbsp;script:alert(1)">x</a></svg>';
  assert.match(findActiveContent(svg)[0], /^is not well-formed XML/);
});

// Removal rebuilds the document from its parse instead of deleting character
// ranges, so deleting an element cannot join the text either side of it into a
// new one. These shapes -- a tag name split by the element being removed -- are
// not well-formed XML at all, so they are rejected before any edit is tried.
for (const [label, markup] of [
  [
    'embed',
    '<scr<embed src="x"></embed>ipt>alert(1)</scr<embed src="y"></embed>ipt>',
  ],
  ['object', '<scr<object></object>ipt>alert(1)</scr<object></object>ipt>'],
  ['self-closing embed', '<scr<embed/>ipt>alert(1)</scr<embed/>ipt>'],
  ['processing instruction', '<scr<?pi?>ipt>alert(1)</scr<?pi?>ipt>'],
]) {
  test(`does not manufacture a script element by splicing around a removed ${label}`, () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`;
    assert.match(findActiveContent(svg)[0], /^is not well-formed XML/);
    assert.throws(() => stripActiveContent(svg), {
      message: /Could not strip active content from SVG/,
    });
  });
}

test('removing an element never joins the text on either side of it', () => {
  // Well-formed input: the text nodes around the removed <embed> stay separate
  // text, and the rebuilt document parses back to the same inert content.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><text>scr<embed/>ipt</text></svg>';
  const { source, removed } = stripActiveContent(svg);
  assert.equal(
    source,
    '<svg xmlns="http://www.w3.org/2000/svg"><text>script</text></svg>',
  );
  assert.deepEqual(removed, ['<embed> element']);
  assert.deepEqual(findActiveContent(source), []);
});

test('throws rather than returning a source the detector still flags', () => {
  // An unterminated element is not well-formed XML, so there is no parse to
  // rebuild from. Returning it as sanitized would publish it at the site
  // origin, so the function fails closed.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script';
  assert.ok(findActiveContent(svg).length > 0);
  assert.throws(() => stripActiveContent(svg), {
    message: /Could not strip active content from SVG: is not well-formed XML/,
  });
});

// The test above covers the structural refusal, which happens *before* the
// document is rebuilt. This one covers the other half of the same promise: a
// document that is well-formed enough to edit still has to come back inert.
// architecture-content.mjs (mirrorArtworkUrls) and enduser-collector.mjs
// (mirrorLandscapeLogo) write this return value straight into static/ and run
// only findRemoteReferences() over it, so stripActiveContent() is the sole
// active-content gate on the bytes those two paths publish at the site origin.
// Asserting the post-condition over every construct the module strips keeps a
// future change to classifyTag()'s removal set, rebuild()'s serialization or
// findActiveContent()'s detection from silently drifting apart.
test('stripActiveContent throws instead of returning output its detector still flags', () => {
  // The default detector and the stripper agree by construction, so the
  // survival throw is only reachable through the scan seam. Drive it with a
  // detector that reports a finding over the rebuilt bytes and assert the
  // sanitized string never reaches the caller.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  const seen = [];
  assert.throws(
    () =>
      stripActiveContent(svg, {
        scan: (output) => {
          seen.push(output);
          return ['<script> element survived'];
        },
      }),
    /Active content survived stripping from SVG: <script> element survived/,
  );
  assert.equal(seen.length, 1);
  assert.doesNotMatch(seen[0], /<script/);
});

// An XML parser expands author-defined general entities before the document
// tree exists, so a payload parked in a declaration never appears in any
// attribute value this module can normalize. The scanner cannot resolve them,
// so it has to refuse the document rather than scan around it.
const ENTITY_SVG =
  '<!DOCTYPE svg [<!ENTITY x "javascript:alert(1)">]>\n' +
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
  '<a xlink:href="&x;"><rect width="10" height="10"/></a></svg>';

test('flags an entity declaration whose payload it cannot resolve', () => {
  assert.ok(
    findActiveContent(ENTITY_SVG).includes(
      'contains an entity declaration in an internal DTD subset ' +
        '(the XML parser expands it, so its payload is not visible here)',
    ),
  );
});

test('throws rather than returning an entity-bearing SVG as sanitized', () => {
  assert.throws(() => stripActiveContent(ENTITY_SVG), {
    message:
      /Could not strip active content from SVG: .*contains an entity declaration/,
  });
});

test('hasDoctype reports a DOCTYPE with and without an internal subset', () => {
  assert.equal(hasDoctype(ENTITY_SVG), true);
  assert.equal(hasDoctype('<!DOCTYPE svg>' + INERT), true);
  assert.equal(hasDoctype(INERT), false);
});

test('stripDoctype consumes an internal subset instead of halving it', () => {
  const stripped = stripDoctype(
    ENTITY_SVG.replace('&x;', 'ok').replace('xlink:', ''),
  );
  assert.doesNotMatch(stripped, /DOCTYPE|ENTITY|\]>/);
  assert.ok(stripped.startsWith('<svg '));
  assert.deepEqual(findActiveContent(stripped), []);
  // A document that still uses the entity cannot be repaired: it is returned
  // untouched, and hasDoctype() tells the caller to reject it.
  assert.equal(stripDoctype(ENTITY_SVG), ENTITY_SVG);
  assert.equal(hasDoctype(stripDoctype(ENTITY_SVG)), true);
});

test('stripDoctype removes a subset whose entity value contains a bracket', () => {
  const svg = '<!DOCTYPE svg [<!ENTITY x "a]b">]>\n' + INERT;
  assert.equal(stripDoctype(svg), INERT);
});

// XML's doctypedecl grammar allows `[`, `]` and `>` inside an ExternalID's
// quoted literals. A pattern that reads a bare `[` as the start of an internal
// subset either matches nothing -- so a caller reports an intact declaration
// as removed -- or deletes everything up to an unrelated `]>`, such as the end
// of a CDATA section later in the document.
test('stripDoctype removes a declaration whose system identifier contains a bracket', () => {
  const svg = '<!DOCTYPE svg SYSTEM "https://evil.example/x[.dtd">\n' + INERT;
  assert.equal(stripDoctype(svg), INERT);
});

test('stripDoctype does not delete markup between a bracketed identifier and a CDATA close', () => {
  const body =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<style><![CDATA[.a{fill:#fff}]]></style>' +
    '<rect width="10" height="10"/></svg>';
  const svg = '<!DOCTYPE svg SYSTEM "https://evil.example/x[.dtd">\n' + body;
  assert.equal(stripDoctype(svg), body);
});

test('stripDoctype handles ">" and "]>" inside quoted literals', () => {
  assert.equal(
    stripDoctype('<!DOCTYPE svg SYSTEM "a>b.dtd">\n' + INERT),
    INERT,
  );
  assert.equal(
    stripDoctype("<!DOCTYPE svg SYSTEM 'a]>b.dtd'>\n" + INERT),
    INERT,
  );
  assert.equal(
    stripDoctype("<!DOCTYPE svg [<!ENTITY y 'c]>d'>]>\n" + INERT),
    INERT,
  );
});

test('stripDoctype leaves an unclosed subset in place for callers to reject', () => {
  // Guessing where a malformed declaration ends would delete live markup, so
  // the pattern matches nothing. Callers must re-check hasDoctype() and fail
  // closed instead of publishing the result as cleaned.
  const svg =
    '<!DOCTYPE svg [\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>';
  assert.equal(stripDoctype(svg), svg);
  assert.equal(hasDoctype(stripDoctype(svg)), true);
  assert.match(findActiveContent(svg)[0], /^is not well-formed XML/);
});

test('stripDoctype matches an unterminated literal in linear time', () => {
  // The alternation branches are disjoint on their first character, so no
  // input can make the engine explore them combinatorially.
  const started = Date.now();
  stripDoctype('<!DOCTYPE svg SYSTEM "' + 'a'.repeat(200000));
  assert.ok(Date.now() - started < 1000);
});

test('stripDoctype removes a plain DOCTYPE and every repeat of one', () => {
  assert.equal(stripDoctype('<!DOCTYPE svg>\n' + INERT), INERT);
  // A second DOCTYPE is not well-formed; the source comes back untouched so
  // the caller's hasDoctype() check rejects it.
  const repeated = '<!DOCTYPE svg>\n<!DOCTYPE svg PUBLIC "a" "b">\n' + INERT;
  assert.equal(stripDoctype(repeated), repeated);
  assert.equal(hasDoctype(repeated), true);
  assert.equal(stripDoctype(INERT), INERT);
});

// A processing instruction is not a start tag, so no tag or attribute scan
// ever sees it. `<?xml-stylesheet href?>` makes the browser fetch the target
// when the SVG is opened directly, and `type="text/xsl"` applies an XSLT
// program to the document. The only PI an SVG image needs is the XML
// declaration, which stays allowed.
test('allows the XML declaration but flags any other processing instruction', () => {
  const declared = '<?xml version="1.0" encoding="UTF-8"?>\n' + INERT;
  assert.deepEqual(findActiveContent(declared), []);
  assert.deepEqual(stripActiveContent(declared), {
    source: declared,
    removed: [],
  });

  const svg =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<?xml-stylesheet type="text/css" href="https://evil.example/x.css"?>\n' +
    INERT;
  assert.deepEqual(findActiveContent(svg), [
    'contains a <?xml-stylesheet?> processing instruction ' +
      '(can load a remote stylesheet or apply an XSLT program to the image)',
  ]);

  const { source, removed } = stripActiveContent(svg);
  assert.doesNotMatch(source, /xml-stylesheet|evil\.example/);
  assert.match(source, /^<\?xml version/);
  assert.ok(removed.includes('<?xml-stylesheet?> processing instruction'));
  assert.deepEqual(findActiveContent(source), []);
});

test('flags an XSLT processing instruction regardless of target case', () => {
  const svg = '<?XML-STYLESHEET type="text/xsl" href="payload.xsl"?>\n' + INERT;
  assert.equal(findActiveContent(svg).length, 1);
  assert.deepEqual(findActiveContent(stripActiveContent(svg).source), []);
});

// The validators read every SVG as UTF-8. A file in another encoding turns
// into text this module's patterns cannot faithfully scan, while a browser
// honoring the BOM or encoding declaration parses the original bytes. The
// mismatch itself is the finding, and nothing can repair it, so
// stripActiveContent refuses the document.
test('fails closed on NUL or replacement characters from a mis-decoded file', () => {
  const utf16ish = INERT.split('').join('\u0000');
  const findings = findActiveContent(utf16ish);
  assert.ok(
    findings.some((finding) =>
      finding.includes('NUL or replacement characters'),
    ),
    `expected a mis-decoding finding, got ${JSON.stringify(findings)}`,
  );
  assert.throws(() => stripActiveContent(utf16ish), {
    message: /NUL or replacement characters/,
  });

  const replaced = '\ufffd\ufffd' + INERT;
  assert.ok(findActiveContent(replaced).length > 0);
});

test('fails closed on a declared multi-byte or ASCII-incompatible encoding', () => {
  for (const encoding of ['UTF-16', 'UTF-7', 'shift_jis', 'gb2312']) {
    const svg = `<?xml version="1.0" encoding="${encoding}"?>\n` + INERT;
    const findings = findActiveContent(svg);
    assert.ok(
      findings.some((finding) =>
        finding.includes(
          `declares a non-UTF-8 encoding (${encoding.toLowerCase()})`,
        ),
      ),
      `expected an encoding finding for ${encoding}, got ${JSON.stringify(findings)}`,
    );
    assert.throws(() => stripActiveContent(svg), {
      message: /declares a non-UTF-8 encoding/,
    });
  }
});

// XML allows either quote around the encoding pseudo-attribute, so
// XML_DECLARATION_ENCODING captures the single-quoted spelling in its second
// group. A reader that only consulted the first group would see no declared
// encoding at all and silently certify a file it cannot faithfully scan.
test('reads the declared encoding from a single-quoted declaration', () => {
  const svg = "<?xml version='1.0' encoding='utf-16'?>\n" + INERT;
  assert.deepEqual(findActiveContent(svg), [
    'declares a non-UTF-8 encoding (utf-16) ' +
      '(an XML parser honoring it reads different bytes than this scan did)',
  ]);
  assert.throws(() => stripActiveContent(svg), {
    message: /declares a non-UTF-8 encoding \(utf-16\)/,
  });

  // The single-quoted spelling is no more permissive than the double-quoted
  // one: a safe encoding still passes through either way.
  assert.deepEqual(
    findActiveContent("<?xml version='1.0' encoding='UTF-8'?>\n" + INERT),
    [],
  );
});

// An empty encoding names no encoding at all, so a parser falls back to its
// own default rather than to this module's UTF-8 reading. The finding has to
// stay legible when there is no name to quote.
test('names an empty declared encoding rather than printing a blank', () => {
  const svg = '<?xml version="1.0" encoding=""?>\n' + INERT;
  assert.deepEqual(findActiveContent(svg), [
    'declares a non-UTF-8 encoding (empty) ' +
      '(an XML parser honoring it reads different bytes than this scan did)',
  ]);
  assert.throws(() => stripActiveContent(svg), {
    message: /declares a non-UTF-8 encoding \(empty\)/,
  });
});

// PROCESSING_INSTRUCTION stops its target capture at the first whitespace, so
// `<? ... ?>` and `<??>` both carry an empty target. A target-less short tag
// is still a processing instruction the browser hands to the XML parser, and
// it is precisely the shape that slips past a filter keyed on known names --
// so it must be reported and removed under a label, not under a blank.
test('reports and removes a processing instruction with no target', () => {
  for (const instruction of ['<??>', '<? type="text/xsl" ?>']) {
    const svg = INERT.replace('<rect', instruction + '<rect');
    assert.deepEqual(
      findActiveContent(svg),
      [
        'contains a <?(unnamed)?> processing instruction ' +
          '(can load a remote stylesheet or apply an XSLT program to the image)',
      ],
      `expected an unnamed-PI finding for ${instruction}`,
    );

    const { source, removed } = stripActiveContent(svg);
    assert.ok(
      removed.includes('<?(unnamed)?> processing instruction'),
      `expected an unnamed-PI removal for ${instruction}, got ${JSON.stringify(removed)}`,
    );
    assert.doesNotMatch(source, /<\?/);
    assert.deepEqual(findActiveContent(source), []);
  }
});

test('accepts the UTF-8 encoding spellings a generator actually emits', () => {
  // ISO-8859-1 appears in the committed member-logo corpus; its 0x00-0x7F
  // range is ASCII, so markup tokenizes exactly as this module's UTF-8
  // reading saw it.
  for (const encoding of [
    'UTF-8',
    'utf-8',
    'utf8',
    'US-ASCII',
    'ISO-8859-1',
    'windows-1252',
  ]) {
    const svg = `<?xml version="1.0" encoding="${encoding}"?>\n` + INERT;
    assert.deepEqual(
      findActiveContent(svg),
      [],
      `expected no findings for ${encoding}`,
    );
  }
});

test('a CSS hex escape in a bare url() does not hide the host', () => {
  // A browser's CSS tokenizer resolves escapes before the value is read as a
  // URL, so `url(\68ttps://...)` fetches `https://...`. Scanning the raw text
  // instead sees a value starting with a backslash -- neither absolute nor
  // protocol-relative -- and the remote fetch walked past the gate.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{fill:url(\\68ttps://evil.example/esc.svg#g)}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/esc.svg#g',
  ]);
});

test('a CSS hex escape inside a quoted url() does not hide the host', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{fill:url("\\68ttps://evil.example/q.svg#g")}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/q.svg#g',
  ]);
});

test('the whitespace terminating a hex escape does not end a bare url token', () => {
  // The space after a six-digit escape belongs to the escape, so this is one
  // url token worth `https://evil.example/ws.css`. Stopping the bare token at
  // the first whitespace captured only `\000068` and lost the host entirely.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    '@import url(\\000068 ttps://evil.example/ws.css);' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/ws.css',
  ]);
});

test('an unterminated escaped url() does not backtrack exponentially', () => {
  // The bare-url alternatives must be mutually exclusive. When a hex run could
  // split across them, `url(` followed by repeated escapes and never closed
  // grew about 7x per repetition, so an upstream SVG could hang every job that
  // scans one. 400 repetitions finished in under a second here and took tens
  // of seconds at 10 repetitions before the fix.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{fill:url(' +
    '\\abcdef'.repeat(400) +
    '</style></svg>';
  const started = Date.now();
  assert.deepEqual(findRemoteReferences(svg), []);
  assert.ok(
    Date.now() - started < 1000,
    'findRemoteReferences must stay linear on repeated unterminated escapes',
  );
});

test('escaped separators still resolve to a protocol-relative target', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{fill:url(\\00002f\\00002fevil.example/sep.svg#g)}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: //evil.example/sep.svg#g',
  ]);
});

test('a backslash before a non-hex character decodes to that character', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{fill:url(\\https://evil.example/lit.svg#g)}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/lit.svg#g',
  ]);
});

test('a backslash-newline line continuation joins the text either side', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    '@import "htt\\\nps://evil.example/cont.css";' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/cont.css',
  ]);
});

test('a CSS escape in a presentation attribute does not hide the host', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<rect fill="url(\\68ttps://evil.example/attr.svg#g)"/></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a fill presentation attribute: https://evil.example/attr.svg#g',
  ]);
});

test('an escape naming NUL or a surrogate decodes to U+FFFD, not a host', () => {
  // CSS maps NUL, the surrogate range and out-of-range code points to U+FFFD.
  // Decoding them to the character the digits name would invent a host that
  // no browser fetches.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{fill:url(\\000000ttps://evil.example/nul.css)}' +
    'circle{fill:url(\\00d800ttps://evil.example/sur.css)}' +
    'path{fill:url(\\110000ttps://evil.example/over.css)}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), []);
});

test('an interior backslash in a local CSS path stays local', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{fill:url(./sub\\dir/x.png)}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), []);
});

test('a bare-string image-set() target is a remote reference', () => {
  // CSS Images 4: "Each <string> inside image-set() represents a <url>", so
  // this fetches exactly as url("...") does while carrying no url( token.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{cursor:image-set("https://evil.example/set.png" 1x)}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/set.png',
  ]);
});

test('the -webkit-image-set() alias is scanned like image-set()', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    "rect{cursor:-webkit-image-set('https://evil.example/pre.png' 2x)}" +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/pre.png',
  ]);
});

test('a CSS escape inside an image-set() string does not hide the host', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{cursor:image-set("\\68 ttps://evil.example/esc-set.png" 1x)}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/esc-set.png',
  ]);
});

test('an unclosed image-set() is read to the end rather than skipped', () => {
  // Fail closed: a target hidden behind a missing parenthesis is still a
  // target, and the browser's error recovery is not this scanner's to guess.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{cursor:image-set("https://evil.example/open.png" 1x' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/open.png',
  ]);
});

test('an unterminated string inside image-set() does not hide earlier arguments', () => {
  // The argument walk skips quoted strings as units; a string with no closing
  // quote runs to the end of the fragment. The complete argument before it
  // must still be collected and reported.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{cursor:image-set("https://evil.example/kept.png" 1x, "unterminated' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/kept.png',
  ]);
});

test('a parenthesis inside an image-set() string does not close the list', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{cursor:image-set("https://evil.example/a).png" 1x,' +
    '"https://evil.example/b.png" 2x)}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/a).png',
    'references a remote resource in a <style> block: https://evil.example/b.png',
  ]);
});

test('an escaped parenthesis inside image-set() does not close the list', () => {
  // A backslash escape is how an unquoted url token carries a parenthesis.
  // Counting that ')' as a closer would end the argument list early and hide
  // every later option, so the walk steps over the escaped character.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{cursor:image-set(url(https://evil.example/a\\).png) 1x,' +
    '"https://evil.example/b.png" 2x)}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/a).png',
    'references a remote resource in a <style> block: https://evil.example/b.png',
  ]);
});

test('an image-set() type() media type is not mistaken for a target', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{cursor:image-set(url("./local.png") 1x type("image/png"))}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), []);
});

test('an image-set() target reached through both spellings is reported once', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{cursor:image-set(url("https://evil.example/dup.png") 1x)}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/dup.png',
  ]);
});

test('an image-set() in a presentation attribute is scanned', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<rect style=\'cursor:image-set("https://evil.example/attr-set.png" 1x)\'/>' +
    '</svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a style attribute: https://evil.example/attr-set.png',
  ]);
});

test('a CSS comment between url( and its argument is a malformed url token', () => {
  // The tokenizer ends the url token at the comment, so the target is not a
  // fetch a browser makes; the shape is reported rather than skipped.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{background:url( /* c */ "https://evil.example/cmt.png")}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'contains a malformed url() token in a <style> block',
  ]);
});

test('a CSS comment after @import does not hide the host', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    '@import /* c */ "https://evil.example/cmt.css";' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/cmt.css',
  ]);
});

test('a comment opener inside a CSS string does not blind the rest of the scan', () => {
  // `content: "/*"` is two literal characters. Treating it as a comment would
  // swallow every declaration after it, hiding the live fetch below.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect::before{content:"/*"}' +
    'rect{background:url("https://evil.example/after.png")}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/after.png',
  ]);
});

test('an unterminated CSS comment runs to the end of the block', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{background:url("https://evil.example/before.png")}/* trailing' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in a <style> block: https://evil.example/before.png',
  ]);
});

test('an unterminated CSS string swallows what follows, as it does in a browser', () => {
  // A bad string runs to the end of the line, so the url() inside it is text
  // and never fetched.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect::before{content:"unterminated /* ' +
    'url(https://evil.example/after-string.png)' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), []);
  const nextLine = svg.replace('/* url', '\nurl');
  assert.deepEqual(findRemoteReferences(nextLine), [
    'references a remote resource in a <style> block: https://evil.example/after-string.png',
  ]);
});

test('a comment is replaced by a separator, not deleted', () => {
  // Deleting it would fuse the text either side into a `url(` token the
  // browser never sees, inventing a finding out of inert text.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'rect{background:ur/* x */l("https://evil.example/fused.png")}' +
    '</style></svg>';
  assert.deepEqual(findRemoteReferences(svg), []);
});

test('rejects a document with no root or more than one root element', () => {
  for (const svg of ['', '<!-- nothing -->', '<svg/><svg/>']) {
    assert.match(findActiveContent(svg)[0], /^is not well-formed XML/);
  }
});

test('rebuilds around a BOM, comments, a DOCTYPE and a trailing newline', () => {
  const svg =
    '\uFEFF<?xml version="1.0"?>\n<!DOCTYPE svg>\n<!-- keep -->\n' +
    '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script><rect/></svg>\n';
  const { source, removed } = stripActiveContent(svg);
  assert.equal(
    source,
    '\uFEFF<?xml version="1.0"?>\n<!DOCTYPE svg>\n<!-- keep -->\n' +
      '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>\n',
  );
  assert.deepEqual(removed, ['<script> element']);
  assert.equal(
    stripDoctype(svg),
    '\uFEFF<?xml version="1.0"?>\n<!-- keep -->\n' +
      '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script><rect/></svg>\n',
  );
});

test('stripDoctype leaves other processing instructions for the scan to report', () => {
  const svg =
    '<!DOCTYPE svg>\n<?xml-stylesheet href="a.css"?>\n' + INERT.trim();
  assert.match(stripDoctype(svg), /<\?xml-stylesheet href="a.css"\?>/);
});

test('reads an unterminated escaped url( to the end of the value', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
    'a{background:\\75rl(https://evil.example/open.png' +
    '</style></svg>';
  assert.equal(findRemoteReferences(svg).length, 1);
});

test('rejects an unterminated DOCTYPE after a prolog, in linear time', () => {
  const body = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  assert.match(
    findActiveContent(
      '<?xml version="1.0"?>\n<!-- c -->\n<!DOCTYPE svg [\n' + body,
    )[0],
    /Unterminated DOCTYPE/,
  );
  // An unterminated prolog item is not a DOCTYPE, and must not hang.
  const started = Date.now();
  for (const unit of ['<?', '<!--']) {
    assert.ok(findActiveContent(unit.repeat(20000) + body).length > 0);
  }
  for (const unit of ['?><?', '--><!--']) {
    findActiveContent('<?' + unit.repeat(20000) + body);
  }
  assert.ok(Date.now() - started < 5000);
});

// These fixtures are independent of the production Sets: removing a supported
// name must fail its acceptance case, not silently remove the test as well.
// Benign values isolate name acceptance from the URI checks above.

// `<g>` hosts the unprefixed and prefixed attribute checks: it is a plain
// container, so no finding can come from the element itself.
const onGroup = (attribute) => svg(`<g ${attribute}="1"/>`);

// XHTML entries are only reachable inside `<foreignObject>`, and only in the
// XHTML namespace -- that namespace is what selects XHTML_ELEMENTS over
// SVG_ELEMENTS, so it has to be declared on the element itself.
const inForeignObject = (markup) =>
  svg(`<foreignObject>${markup}</foreignObject>`);
const XHTML_DECL = 'xmlns="http://www.w3.org/1999/xhtml"';

// `svg` is excluded: it is the root this helper already writes, and nesting a
// second one would test the wrapper rather than the entry.
for (const element of `
  a circle clipPath defs desc ellipse feBlend feColorMatrix feComposite
  feDropShadow feFlood feGaussianBlur feMerge feMergeNode feOffset filter
  foreignObject g image line linearGradient marker mask metadata path pattern
  polygon polyline radialGradient rect stop style svg switch symbol text
  textPath title tspan use
`
  .trim()
  .split(/\s+/)) {
  if (element === 'svg') continue;
  test(`allows the SVG element <${element}>`, () => {
    assert.deepEqual(findActiveContent(svg(`<${element}/>`)), []);
  });
}

for (const attribute of `
  alignment-baseline aria-describedby aria-hidden aria-label aria-labelledby
  baseProfile baseline-shift class clip clip-path clip-rule clipPathUnits color
  color-interpolation color-interpolation-filters color-rendering cx cy d
  direction display dominant-baseline dx dy enable-background fill fill-opacity
  fill-rule filter filterUnits flood-color flood-opacity font-family font-size
  font-size-adjust font-stretch font-style font-variant font-weight fr fx fy
  gradientTransform gradientUnits height href id image-rendering in in2
  isolation k1 k2 k3 k4 lang lengthAdjust letter-spacing lighting-color
  marker-end marker-mid marker-start markerHeight markerUnits markerWidth mask
  maskContentUnits maskUnits mix-blend-mode mode offset opacity operator orient
  overflow paint-order pathLength patternContentUnits patternTransform
  patternUnits pointer-events points preserveAspectRatio primitiveUnits r refX
  refY requiredExtensions requiredFeatures result role rotate rx ry
  shape-rendering spreadMethod startOffset stdDeviation stop-color stop-opacity
  stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin
  stroke-miterlimit stroke-opacity stroke-width style systemLanguage target
  text-anchor text-decoration text-rendering textLength transform
  transform-origin type unicode-bidi values vector-effect version viewBox
  visibility width word-spacing writing-mode x x1 x2 y y1 y2
`
  .trim()
  .split(/\s+/)) {
  test(`allows the SVG attribute ${attribute}`, () => {
    assert.deepEqual(findActiveContent(onGroup(attribute)), []);
  });
}

// Root-only attributes are allowed on `<svg>` and nowhere else, so each entry
// is asserted on both sides: accepted on the root, still a finding below it.
// Blanking the entry would otherwise be invisible -- the root check would stop
// mattering while the rejection carried on passing for the wrong reason.
for (const attribute of ['content']) {
  test(`allows the root-only SVG attribute ${attribute} on <svg> only`, () => {
    assert.deepEqual(
      findActiveContent(
        `<svg xmlns="http://www.w3.org/2000/svg" ${attribute}="x"/>`,
      ),
      [],
    );
    assert.deepEqual(findActiveContent(onGroup(attribute)), [
      `contains a disallowed attribute ${attribute} on <g>`,
    ]);
  });
}

for (const element of `
  a b br code div em font hr i li ol p pre s span strike strong sub sup u ul
`
  .trim()
  .split(/\s+/)) {
  test(`allows the XHTML element <${element}> in a foreignObject`, () => {
    assert.deepEqual(
      findActiveContent(inForeignObject(`<${element} ${XHTML_DECL}/>`)),
      [],
    );
  });
}

for (const attribute of `
  align class color dir face href id lang size style target title
`
  .trim()
  .split(/\s+/)) {
  test(`allows the XHTML attribute ${attribute}`, () => {
    assert.deepEqual(
      findActiveContent(
        inForeignObject(`<div ${XHTML_DECL} ${attribute}="1"/>`),
      ),
      [],
    );
  });
}

for (const attribute of ['href', 'title']) {
  test(`allows the XLink attribute xlink:${attribute}`, () => {
    assert.deepEqual(findActiveContent(onGroup(`xlink:${attribute}`)), []);
  });
}

for (const attribute of ['lang', 'space']) {
  test(`allows the XML attribute xml:${attribute}`, () => {
    assert.deepEqual(findActiveContent(onGroup(`xml:${attribute}`)), []);
  });
}

// Every element in a metadata namespace is allowed whatever it is called, so
// the entry under test is the namespace URI, not the element name.
for (const namespace of `
  http://creativecommons.org/ns#
  http://ns.adobe.com/AdobeIllustrator/10.0/
  http://ns.adobe.com/Extensibility/1.0/
  http://ns.adobe.com/Graphs/1.0/
  http://ns.adobe.com/SaveForWeb/1.0/
  http://purl.org/dc/elements/1.1/
  http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd
  http://www.inkscape.org/namespaces/inkscape
  http://www.w3.org/1999/02/22-rdf-syntax-ns#
`
  .trim()
  .split(/\s+/)) {
  test(`allows elements in the metadata namespace ${namespace}`, () => {
    assert.deepEqual(
      findActiveContent(svg(`<m:thing xmlns:m="${namespace}"/>`)),
      [],
    );
  });
}

for (const attribute of `
  bleed bordercolor borderopacity bottomLeftOrigin gridtolerance guidetolerance
  height id margin objecttolerance pagecolor showgrid units width x y
`
  .trim()
  .split(/\s+/)) {
  test(`allows the metadata attribute ${attribute}`, () => {
    assert.deepEqual(
      findActiveContent(
        svg(
          '<m:thing xmlns:m="http://www.inkscape.org/namespaces/inkscape" ' +
            `${attribute}="1"/>`,
        ),
      ),
      [],
    );
  });
}

// The CSS functions that take a bare string as a URL. Unlike the allowlists
// above, an unrecognized entry here fails *open*: the gate stops reading the
// argument as a URL, and a `javascript:` payload written through that function
// passes. Each entry is asserted to still be read as a URL.
for (const fn of [
  'url',
  'src',
  'image',
  'image-set',
  '-webkit-image-set',
  'cross-fade',
  '-webkit-cross-fade',
]) {
  test(`reads a quoted ${fn}() argument in CSS as a URL`, () => {
    assert.deepEqual(
      findActiveContent(
        svg(`<style>a{background:${fn}("javascript:alert(1)")}</style>`),
      ),
      ['contains a disallowed URI scheme in a <style> block: javascript:'],
    );
  });
}
