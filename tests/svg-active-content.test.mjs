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

test('reports nothing for an inert SVG', () => {
  assert.deepEqual(findActiveContent(INERT), []);
  assert.deepEqual(stripActiveContent(INERT), { source: INERT, removed: [] });
});

test('leaves ordinary http links and styling attributes alone', () => {
  const { source } = stripActiveContent(INERT);
  assert.match(source, /href="https:\/\/example\.com\/docs"/);
  assert.match(source, /fill="#fff"/);
});

test('detects and removes script elements with their contents', () => {
  const svg = INERT.replace('<rect', '<script>alert(1)</script><rect');
  assert.deepEqual(findActiveContent(svg), ['contains a <script> element']);

  const { source, removed } = stripActiveContent(svg);
  assert.doesNotMatch(source, /script/i);
  assert.doesNotMatch(source, /alert\(1\)/);
  assert.ok(removed.includes('<script> element'));
  assert.deepEqual(findActiveContent(source), []);
});

test('detects and removes event handler attributes', () => {
  const svg = INERT.replace('<rect ', '<rect onload="alert(1)" onclick="x()" ');
  assert.deepEqual(findActiveContent(svg), [
    'contains event handler attribute(s): onclick, onload',
  ]);

  const { source } = stripActiveContent(svg);
  assert.doesNotMatch(source, /onload|onclick/i);
  assert.match(source, /<rect /);
});

test('sees through entity and control-character obfuscation of javascript:', () => {
  for (const payload of [
    'javascript:alert(1)',
    'java&#115;cript:alert(1)',
    'javascript&#58;alert(1)',
    'java\tscript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
  ]) {
    const svg = INERT.replace('https://example.com/docs', payload);
    assert.deepEqual(
      findActiveContent(svg),
      ['contains a script URI in href="javascript:..."'],
      `expected detection for ${JSON.stringify(payload)}`,
    );
    assert.deepEqual(findActiveContent(stripActiveContent(svg).source), []);
  }
});

// decodeEntities has two numeric-entity branches. The test above reaches only
// the decimal one (`&#115;`), which is also the form the module header uses as
// its example, so the hex callback had no coverage at all -- even though hex is
// the more usual way to hide a scheme. The last payload is double-encoded and
// only resolves because decodeEntities is deliberately applied twice.
test('sees through hex numeric-entity obfuscation of javascript:', () => {
  for (const payload of [
    'java&#x73;cript:alert(1)',
    'java&#X73;cript:alert(1)',
    'javascript&#x3a;alert(1)',
    'javascript&amp;#x3a;alert(1)',
  ]) {
    const svg = INERT.replace('https://example.com/docs', payload);
    assert.deepEqual(
      findActiveContent(svg),
      ['contains a script URI in href="javascript:..."'],
      `expected detection for ${JSON.stringify(payload)}`,
    );
    assert.deepEqual(findActiveContent(stripActiveContent(svg).source), []);
  }
});

// The hex callback guards `code <= 0x10ffff` before calling String.fromCodePoint
// and returns the literal match when the codepoint is out of range. Pinning the
// guard keeps it from being "simplified" into a throw, and confirms the literal
// entity that survives does not itself read as a scheme.
test('leaves an out-of-range hex entity literal rather than forming a scheme', () => {
  const svg = INERT.replace(
    'https://example.com/docs',
    'java&#x110000;cript:alert(1)',
  );
  assert.deepEqual(findActiveContent(svg), []);
  assert.deepEqual(stripActiveContent(svg), { source: svg, removed: [] });
});

// The decimal callback carries the same `code <= 0x10ffff` guard as the hex one
// above, but no payload in this file had ever pushed a decimal entity past the
// limit, so that guard's false arm never ran. It is not cosmetic: without it
// String.fromCodePoint(1114112) throws a RangeError, and decodeEntities runs on
// every attribute value of every imported third-party SVG -- so an asset
// carrying `&#1114112;` would crash the validator rather than be reported on.
// 1114112 is the first codepoint over the 0x10ffff limit.
test('leaves an out-of-range decimal entity literal rather than forming a scheme', () => {
  const svg = INERT.replace(
    'https://example.com/docs',
    'java&#1114112;cript:alert(1)',
  );
  assert.deepEqual(findActiveContent(svg), []);
  assert.deepEqual(stripActiveContent(svg), { source: svg, removed: [] });

  // The true arm must still decode, so the guard cannot be "satisfied" by
  // rejecting decimal entities wholesale: &#58; is a colon, and decoding it is
  // what turns the payload below into a scheme the scanner reports.
  const inRange = INERT.replace(
    'https://example.com/docs',
    'javascript&#58;alert(1)',
  );
  assert.deepEqual(findActiveContent(inRange), [
    'contains a script URI in href="javascript:..."',
  ]);
});

// ATTRIBUTE_PATTERN only matches an attribute that carries a value, so a
// handler written without one slips past the scanner. findActiveContent has an
// explicit fallback for that case, but every handler in the tests above is
// valued and therefore caught by the scanner, leaving the fallback unreached.
test('falls back to on* for a handler the attribute scanner cannot see', () => {
  for (const svg of [
    '<svg onload=></svg>',
    '<svg onload= ></svg>',
    '<svg onload=`alert(1)`></svg>',
  ]) {
    assert.deepEqual(
      findActiveContent(svg),
      ['contains event handler attribute(s): on*'],
      `expected the on* fallback for ${JSON.stringify(svg)}`,
    );
  }
});

// Fixed in #540: the on* fallback existed only in findActiveContent.
// stripActiveContent now runs an equivalent fallback pass after
// ATTRIBUTE_PATTERN, so a value-less or backtick-delimited handler is both
// removed and recorded. Re-detecting on the stripped output is the invariant:
// stripping must leave an SVG that findActiveContent considers inert.
test('stripActiveContent removes a handler the attribute scanner cannot see', () => {
  for (const svg of ['<svg onload=></svg>', '<svg onload=`alert(1)`></svg>']) {
    const { source, removed } = stripActiveContent(svg);
    assert.doesNotMatch(
      source,
      /onload/i,
      `onload survived stripping of ${JSON.stringify(svg)}`,
    );
    assert.notDeepEqual(
      removed,
      [],
      `stripping ${JSON.stringify(svg)} reported no removal`,
    );
    assert.deepEqual(findActiveContent(source), []);
  }
});

test('detects script URIs in animation targets, not just href', () => {
  const svg = INERT.replace(
    '<rect',
    '<set attributeName="xlink:href" to="javascript:alert(1)"/><rect',
  );
  assert.deepEqual(findActiveContent(svg), [
    'contains a script URI in to="javascript:..."',
    'contains a <set> element that animates href (can install a script URI at runtime)',
  ]);
  assert.deepEqual(findActiveContent(stripActiveContent(svg).source), []);
});

test('detects markup-bearing data: URIs', () => {
  const svg = INERT.replace(
    'https://example.com/docs',
    'data:text/html;base64,PHNjcmlwdD4=',
  );
  assert.deepEqual(findActiveContent(svg), [
    'contains a script URI in href="data:text/html..."',
  ]);
});

test('does not flag inert data: URIs such as raster images', () => {
  const svg = INERT.replace(
    'https://example.com/docs',
    'data:image/png;base64,iVBOR',
  );
  assert.deepEqual(findActiveContent(svg), []);
});

test('detects active content nested inside foreignObject', () => {
  const svg = INERT.replace(
    '<rect',
    '<foreignObject><img src="x" onerror="alert(1)"/></foreignObject><rect',
  );
  assert.deepEqual(findActiveContent(svg), [
    'contains event handler attribute(s): onerror',
  ]);
  assert.deepEqual(findActiveContent(stripActiveContent(svg).source), []);
});

test('strips every finding from a heavily obfuscated payload', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<script type="text/ecmascript">alert(1)</script>' +
    '<a xlink:href="java&#115;cript&#58;alert(2)"><rect onmouseover="alert(3)"/></a>' +
    '</svg>';
  assert.equal(findActiveContent(svg).length, 3);

  const { source, removed } = stripActiveContent(svg);
  assert.ok(removed.length >= 3);
  assert.deepEqual(findActiveContent(source), []);
  assert.match(source, /viewBox="0 0 10 10"/);
});

test('flags an <animate> element that installs an href at runtime', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<a><animate attributeName="href" to="javascript:alert(1)" begin="0s"/><rect/></a>' +
    '</svg>';
  assert.ok(
    findActiveContent(svg).includes(
      'contains a <animate> element that animates href (can install a script URI at runtime)',
    ),
  );
  assert.deepEqual(findActiveContent(stripActiveContent(svg).source), []);
});

test('flags a paired <set> element animating xlink:href and leaves no orphan tag', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<a><set attributeName="xlink:href" to="javascript:alert(1)"></set><rect/></a>' +
    '</svg>';
  assert.ok(
    findActiveContent(svg).some((finding) => finding.includes('animates href')),
  );
  const { source } = stripActiveContent(svg);
  assert.doesNotMatch(source, /<\s*\/?\s*set\b/i);
  assert.match(source, /<rect\/>/);
  assert.deepEqual(findActiveContent(source), []);
});

test('leaves an ordinary animation of a presentation attribute alone', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<rect><animate attributeName="opacity" to="0.5"/></rect>' +
    '</svg>';
  assert.deepEqual(findActiveContent(svg), []);
  assert.equal(stripActiveContent(svg).source, svg);
});

// Standalone SVG under static/ is served as image/svg+xml and parsed as XML,
// where a namespace prefix is arbitrary and only the URI it binds matters:
// <x:script xmlns:x="http://www.w3.org/2000/svg"> is a script element and runs.
// Anchoring the element patterns on the bare local name let a one-character
// edit walk an imported asset past both the CI gate and the import sanitizer.
test('detects and removes namespace-prefixed active elements', () => {
  for (const [prefix, element, finding] of [
    ['svg', 'script', 'contains a <script> element'],
    ['x', 'script', 'contains a <script> element'],
    ['svg', 'handler', 'contains a <handler> element'],
    ['ev', 'listener', 'contains a <listener> element'],
  ]) {
    const svg = INERT.replace(
      '<rect',
      `<${prefix}:${element}>alert(1)</${prefix}:${element}><rect`,
    );
    assert.deepEqual(
      findActiveContent(svg),
      [finding],
      `expected detection for <${prefix}:${element}>`,
    );

    const { source, removed } = stripActiveContent(svg);
    assert.doesNotMatch(source, /alert\(1\)/);
    assert.doesNotMatch(source, new RegExp(`${prefix}:${element}`, 'i'));
    assert.ok(removed.includes(`<${element}> element`));
    assert.deepEqual(findActiveContent(source), []);
  }
});

test('detects a namespace-prefixed element that animates href', () => {
  const svg = INERT.replace(
    '<rect',
    '<svg:set attributeName="xlink:href" to="https://example.com/x"/><rect',
  );
  assert.deepEqual(findActiveContent(svg), [
    'contains a <set> element that animates href (can install a script URI at runtime)',
  ]);
  assert.deepEqual(findActiveContent(stripActiveContent(svg).source), []);
});

// <foreignObject> hosts XHTML, so an embedding element reached through it
// loads an attacker-chosen document into the origin serving the SVG. A srcdoc
// payload is entity-encoded, so no scan of the attribute *value* would flag it.
test('detects and removes document-embedding elements in foreignObject', () => {
  for (const element of ['iframe', 'embed', 'object']) {
    const svg = INERT.replace(
      '<rect',
      `<foreignObject><${element} src="https://evil.example/x"></${element}></foreignObject><rect`,
    );
    assert.deepEqual(
      findActiveContent(svg),
      [`contains a <${element}> element`],
      `expected detection for <${element}>`,
    );

    const { source, removed } = stripActiveContent(svg);
    assert.doesNotMatch(source, new RegExp(`<${element}`, 'i'));
    assert.ok(removed.includes(`<${element}> element`));
    assert.deepEqual(findActiveContent(source), []);
  }
});

test('detects and removes srcdoc regardless of its value', () => {
  const svg = INERT.replace(
    '<rect',
    '<foreignObject><div srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></div></foreignObject><rect',
  );
  assert.deepEqual(findActiveContent(svg), [
    'contains an embedded document attribute: srcdoc (carries markup that executes in this origin)',
  ]);

  const { source, removed } = stripActiveContent(svg);
  assert.doesNotMatch(source, /srcdoc/i);
  assert.ok(removed.includes('srcdoc attribute (embedded document)'));
  assert.deepEqual(findActiveContent(source), []);
});

// draw.io and Excalidraw emit <foreignObject> for ordinary text, and imported
// diagrams already contain it, so widening the element list must not catch it.
test('leaves foreignObject itself untouched', () => {
  const svg = INERT.replace(
    '<rect',
    '<foreignObject width="10" height="10"><div>label</div></foreignObject><rect',
  );
  assert.deepEqual(findActiveContent(svg), []);
  assert.deepEqual(stripActiveContent(svg), { source: svg, removed: [] });
});

// ATTRIBUTE_PATTERN accepts three value forms -- double-quoted, single-quoted
// and unquoted -- and findActiveContent/stripActiveContent read them through
// `match[2] ?? match[3] ?? match[4]` and `dq ?? sq ?? uq`. Every case above
// writes double-quoted markup, so only the first alternative of either
// fallback chain was ever exercised: a regression that dropped the
// single-quoted or unquoted alternative from the pattern, or read the wrong
// capture group, would have left the suite green while every
// `onclick='alert(1)'` and `href=javascript:alert(1)` an SVG editor emits
// passed the gate unseen. Browsers accept all three forms identically.
const QUOTING_VARIANTS = [
  { article: 'a', label: 'single-quoted', quote: "'" },
  { article: 'an', label: 'unquoted', quote: '' },
];

for (const { article, label, quote } of QUOTING_VARIANTS) {
  test(`detects and removes ${article} ${label} event handler attribute`, () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect onclick=${quote}alert(1)${quote}></rect></svg>`;
    assert.deepEqual(findActiveContent(svg), [
      'contains event handler attribute(s): onclick',
    ]);

    const { source, removed } = stripActiveContent(svg);
    assert.doesNotMatch(source, /onclick/i);
    assert.doesNotMatch(source, /alert\(1\)/);
    assert.ok(removed.includes('onclick attribute'));
    assert.deepEqual(findActiveContent(source), []);
  });

  test(`detects and removes ${article} ${label} script URI`, () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><a href=${quote}javascript:alert(1)${quote}><rect/></a></svg>`;
    assert.deepEqual(findActiveContent(svg), [
      'contains a script URI in href="javascript:..."',
    ]);

    const { source, removed } = stripActiveContent(svg);
    assert.doesNotMatch(source, /javascript:/i);
    assert.ok(removed.includes('href attribute (javascript:)'));
    assert.deepEqual(findActiveContent(source), []);
  });

  test(`detects and removes ${article} ${label} embedded document attribute`, () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect srcdoc=${quote}payload${quote}></rect></svg>`;
    assert.deepEqual(findActiveContent(svg), [
      'contains an embedded document attribute: srcdoc (carries markup that executes in this origin)',
    ]);

    const { source, removed } = stripActiveContent(svg);
    assert.doesNotMatch(source, /srcdoc/i);
    assert.ok(removed.includes('srcdoc attribute (embedded document)'));
    assert.deepEqual(findActiveContent(source), []);
  });

  test(`reads ${article} ${label} value without disturbing inert markup`, () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect fill=${quote}#fff${quote} width=${quote}10${quote}></rect></svg>`;
    assert.deepEqual(findActiveContent(svg), []);
    assert.deepEqual(stripActiveContent(svg), { source: svg, removed: [] });
  });
}

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
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="http://evil.example/b.png"/></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in <image> xlink:href: http://evil.example/b.png',
  ]);
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

test('an unquoted href is read as a value, not skipped', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><image href=https://evil.example/uq.png /></svg>';
  assert.deepEqual(findRemoteReferences(svg), [
    'references a remote resource in <image> href: https://evil.example/uq.png',
  ]);
});

test('an empty <style> block does not break the block scan that follows it', () => {
  // STYLE_BLOCK_PATTERN captures its body lazily, so an empty block yields an
  // empty capture. Nothing may be reported for the block itself, and the rest
  // of the document still has to be scanned.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style></style><image href="https://evil.example/after.png"/></svg>';
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

test('an unrecognized named entity is left intact rather than dropped', () => {
  // decodeEntities only resolves the named entities that can hide a scheme.
  // Anything else has to survive decoding unchanged: silently deleting it
  // would splice the surrounding characters together and could manufacture a
  // scheme that the source never contained.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="java&nbsp;script:alert(1)">x</a></svg>';
  assert.deepEqual(findActiveContent(svg), []);
});

test('an unrecognized named entity does not hide a scheme that follows it', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="&unknown;javascript:alert(1)">x</a></svg>';
  assert.deepEqual(findActiveContent(svg), [
    'contains a script URI in href="javascript:..."',
  ]);
});

// Removing an element splices the characters on either side of it together.
// `script` is stripped before `embed`/`object`, so a single removal pass
// returned a `<script>` the input never contained and the detector never saw.
test('does not manufacture a script element by splicing around a removed embed', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<scr<embed src="x"></embed>ipt>alert(1)</scr<embed src="y"></embed>ipt>' +
    '</svg>';
  // The input carries no script element -- only the <embed> halves the
  // detector reports -- so a <script> in the output is one the sanitizer built.
  assert.deepEqual(findActiveContent(svg), ['contains a <embed> element']);

  const { source } = stripActiveContent(svg);
  assert.doesNotMatch(source, /<script/i);
  assert.doesNotMatch(source, /alert\(1\)/);
  assert.deepEqual(findActiveContent(source), []);
});

test('does not manufacture a script element by splicing around a removed object', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<scr<object></object>ipt>alert(1)</scr<object></object>ipt>' +
    '</svg>';
  assert.deepEqual(findActiveContent(svg), ['contains a <object> element']);

  const { source } = stripActiveContent(svg);
  assert.doesNotMatch(source, /<script/i);
  assert.deepEqual(findActiveContent(source), []);
});

test('does not manufacture a script element by splicing around a self-closing embed', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<scr<embed/>ipt>alert(1)</scr<embed/>ipt>' +
    '</svg>';
  assert.deepEqual(findActiveContent(svg), ['contains a <embed> element']);

  const { source } = stripActiveContent(svg);
  assert.doesNotMatch(source, /<script/i);
  assert.deepEqual(findActiveContent(source), []);
});

test('throws rather than returning a source the detector still flags', () => {
  // An unterminated active element has no `>` for the removal patterns to
  // match, so no number of passes can remove it. Returning it as sanitized
  // would publish it at the site origin, so the function fails closed.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script';
  assert.ok(findActiveContent(svg).length > 0);
  assert.throws(() => stripActiveContent(svg), {
    message: /Could not strip active content from SVG: contains a <script>/,
  });
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
  assert.deepEqual(findActiveContent(ENTITY_SVG), [
    'contains an entity declaration in an internal DTD subset ' +
      '(the XML parser expands it, so its payload is not visible here)',
  ]);
});

test('throws rather than returning an entity-bearing SVG as sanitized', () => {
  assert.throws(() => stripActiveContent(ENTITY_SVG), {
    message:
      /Could not strip active content from SVG: contains an entity declaration/,
  });
});

test('hasDoctype reports a DOCTYPE with and without an internal subset', () => {
  assert.equal(hasDoctype(ENTITY_SVG), true);
  assert.equal(hasDoctype('<!DOCTYPE svg>' + INERT), true);
  assert.equal(hasDoctype(INERT), false);
});

test('stripDoctype consumes an internal subset instead of halving it', () => {
  // `<!DOCTYPE\s[^>]*>` stops at the `>` closing the <!ENTITY> declaration and
  // leaves a bare `]>` behind, in a file the caller then publishes as XML.
  const stripped = stripDoctype(ENTITY_SVG);
  assert.doesNotMatch(stripped, /DOCTYPE|ENTITY|\]>/);
  assert.ok(stripped.startsWith('<svg '));
  assert.deepEqual(findActiveContent(stripped), []);
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
  assert.equal(
    stripDoctype('<!DOCTYPE svg>\n<!DOCTYPE svg PUBLIC "a" "b">\n' + INERT),
    INERT,
  );
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

test('does not manufacture a script element by splicing around a removed PI', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<scr<?pi?>ipt>alert(1)</scr<?pi?>ipt>' +
    '</svg>';
  const { source } = stripActiveContent(svg);
  assert.doesNotMatch(source, /<script/i);
  assert.deepEqual(findActiveContent(source), []);
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
