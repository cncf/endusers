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
  assert.deepEqual(reasons('<img src=x onerror=alert(1)>'), [
    'disallowed element <img>',
    'event handler attribute',
  ]);
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
  // A control character a URL parser would ignore.
  assert.deepEqual(reasons('[click](java\tscript:alert(1))'), [
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
  // element -- the finding here is the handler, not the element itself.
  assert.deepEqual(reasons('``<b onClick={alert}>hi</b>`'), [
    'event handler attribute',
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
