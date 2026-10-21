// CONTENT-SECURITY.md, bound to the scanners it describes.
//
// That document is not background reading. It is the submitter-facing contract
// for the two import gates -- `npm run validate:architectures` and
// `npm run validate:architecture-assets` -- and it is what a contributor is
// sent to when a workflow run rejects their diagram or page body. It works by
// enumeration: these elements, these attributes, these URI schemes, these
// node types. Every one of those lists is a copy of an allowlist exported by
// `scripts/lib/svg-active-content.mjs`, `scripts/lib/uri-safety.mjs` or
// `scripts/lib/mdx-active-content.mjs`, and a copy drifts unless something
// holds it to the original.
//
// Each list is checked in both directions, because either direction failing is
// the same defect seen from a different side: an undocumented allowance is a
// hole nobody reviewed, and a documented one the gate no longer grants rejects
// submissions the page says are fine. Every documented entry is also run
// through its scanner and asserted to pass, so a set the scanner stopped
// consulting cannot satisfy the comparison.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { resolveRepoRoot } from './helpers.mjs';

import * as svgGate from '../scripts/lib/svg-active-content.mjs';
import * as mdxGate from '../scripts/lib/mdx-active-content.mjs';
import {
  ALLOWED_SCHEMES,
  RASTER_DATA_TYPES,
} from '../scripts/lib/uri-safety.mjs';

const root = resolveRepoRoot(import.meta.url);

const read = (relative) => readFileSync(join(root, relative), 'utf8');

const doc = read('CONTENT-SECURITY.md');

/**
 * The inline-code spans (`` `x` ``) of the bullet whose first line contains
 * `**anchor**`, read to the bullet's end: continuation lines up to the next
 * bullet, heading, or blank line.
 */
function documentedCodeSpans(anchor) {
  const lines = doc.split('\n');
  const start = lines.findIndex((line) => line.includes(`**${anchor}**`));
  assert.ok(start !== -1, `CONTENT-SECURITY.md has no **${anchor}** bullet`);

  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || /^\s*[-*#]/u.test(line)) break;
    block.push(line);
  }
  return [...block.join('\n').matchAll(/`([^`]+)`/gu)].map(([, v]) => v);
}

const sorted = (values) => [...values].sort();
const svgReasons = (inner) =>
  svgGate.findActiveContent(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`,
  );
const mdxReasons = (body) =>
  mdxGate.findActiveContent(body).map(({ reason }) => reason);
const XHTML = 'xmlns="http://www.w3.org/1999/xhtml"';

// [bullet, documented spans -> entries, allowlist, behaviour probe]
const LISTS = [
  [
    'SVG elements',
    (spans) => spans,
    svgGate.SVG_ELEMENTS,
    (name) => svgReasons(`<${name}/>`),
  ],
  [
    'SVG attributes',
    (spans) => spans.filter((span) => span !== 'data-*'),
    svgGate.SVG_ATTRIBUTES,
    (name) => svgReasons(`<g ${name}="1"/>`),
  ],
  [
    'Root-only SVG attributes',
    (spans) => spans.filter((span) => span !== '--fix'),
    svgGate.SVG_ROOT_ATTRIBUTES,
    (name) =>
      svgGate.findActiveContent(
        `<svg xmlns="http://www.w3.org/2000/svg" ${name}="1"/>`,
      ),
  ],
  [
    'HTML elements inside `<foreignObject>`',
    (spans) => spans.filter((span) => span !== '<foreignObject>'),
    svgGate.XHTML_ELEMENTS,
    (name) => svgReasons(`<foreignObject><${name} ${XHTML}/></foreignObject>`),
  ],
  [
    'HTML attributes',
    (spans) => spans.filter((span) => span !== 'data-*'),
    svgGate.XHTML_ATTRIBUTES,
    (name) =>
      svgReasons(`<foreignObject><p ${XHTML} ${name}="1"/></foreignObject>`),
  ],
  [
    'Prefixed attributes',
    (spans) => spans,
    new Set([
      ...[...svgGate.XLINK_ATTRIBUTES].map((name) => `xlink:${name}`),
      ...[...svgGate.XML_ATTRIBUTES].map((name) => `xml:${name}`),
    ]),
    (name) => svgReasons(`<g ${name}="preserve"/>`),
  ],
  [
    'Editor metadata namespaces',
    (spans) => spans,
    svgGate.METADATA_NAMESPACES,
    (uri) => svgReasons(`<m:any xmlns:m="${uri}" m:attr="1"/>`),
  ],
  [
    'Unprefixed attributes on editor metadata elements',
    (spans) => spans,
    svgGate.METADATA_ATTRIBUTES,
    (name) =>
      svgReasons(
        `<m:any xmlns:m="http://www.inkscape.org/namespaces/inkscape" ${name}="1"/>`,
      ),
  ],
  [
    'Markdown node types',
    (spans) => spans,
    mdxGate.MARKDOWN_NODE_TYPES,
    () => [],
  ],
  [
    'Inert inline HTML elements',
    (spans) => spans,
    mdxGate.ALLOWED_ELEMENTS,
    (name) => mdxReasons(`Prose with <${name}>markup</${name}> in it.`),
  ],
  [
    'Component',
    (spans) => spans.filter((span) => span !== 'CNCFProjectCard'),
    mdxGate.COMPONENT_ATTRIBUTES,
    (name) => mdxReasons(`<CNCFProjectCard ${name}="/x" />`),
  ],
  [
    'URL schemes',
    (spans) =>
      spans
        .filter((span) => /^[a-z]+:$/u.test(span))
        .map((span) => span.slice(0, -1)),
    ALLOWED_SCHEMES,
    (scheme) => mdxReasons(`[x](${scheme}:example)`),
  ],
];

for (const [anchor, select, allowlist, probe] of LISTS) {
  test(`CONTENT-SECURITY.md lists exactly the allowed ${anchor}`, () => {
    const documented = select(documentedCodeSpans(anchor));
    assert.deepEqual(sorted(documented), sorted(allowlist));
    for (const entry of documented) {
      assert.deepEqual(probe(entry), [], `${entry} is documented as allowed`);
    }
  });
}

test('the SVG URI-scheme bullet names the allowed schemes and raster types', () => {
  const spans = documentedCodeSpans('URI schemes');
  for (const scheme of ALLOWED_SCHEMES) {
    assert.ok(spans.includes(`${scheme}:`), scheme);
  }
  assert.deepEqual(
    sorted(spans.filter((span) => span.startsWith('data:image/'))),
    sorted([...RASTER_DATA_TYPES].map((type) => `data:${type}`)),
  );
});

test('the component CONTENT-SECURITY.md names as allowed is the one the scanner allows', () => {
  assert.ok(
    doc.includes(`\`${mdxGate.ALLOWED_COMPONENT}\` component`),
    `CONTENT-SECURITY.md does not name ${mdxGate.ALLOWED_COMPONENT}`,
  );
});

// Without these, an allowlist that had swallowed its whole vocabulary would
// satisfy every assertion above.
test('names off the documented lists are rejected', () => {
  assert.deepEqual(svgReasons('<script/>'), [
    'contains a disallowed element <script>',
  ]);
  assert.deepEqual(mdxReasons('<div>block</div>'), [
    'disallowed element <div>',
  ]);
  assert.deepEqual(mdxReasons('Prose with {1 + 1} in it.'), ['MDX expression']);
  assert.deepEqual(mdxReasons('[x](ftp://example.com/)'), [
    'disallowed URL scheme ftp:',
  ]);
});

// --- The commands the document tells submitters to run ---------------------

test('every npm script CONTENT-SECURITY.md tells submitters to run exists', () => {
  const { scripts = {} } = JSON.parse(read('package.json'));
  const invoked = [...doc.matchAll(/npm run ([\w:-]+)/gu)].map(
    ([, name]) => name,
  );

  assert.ok(
    invoked.length > 0,
    'CONTENT-SECURITY.md names no npm run commands',
  );

  const missing = [...new Set(invoked)]
    .filter((name) => !(name in scripts))
    .sort();
  assert.deepEqual(
    missing,
    [],
    `CONTENT-SECURITY.md tells submitters to run scripts package.json does not define: ${missing.join(', ')}`,
  );
});
