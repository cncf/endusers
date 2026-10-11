// CONTENT-SECURITY.md, bound to the scanners it describes.
//
// That document is not background reading. It is the submitter-facing contract
// for the two import gates -- `npm run validate:architectures` and
// `npm run validate:architecture-assets` -- and it is what a contributor is
// sent to when a workflow run rejects their diagram or page body. It works by
// enumeration: these elements, these attributes, these URI schemes, these
// inert MDX tags. Every one of those lists is a copy of a constant in
// `scripts/lib/svg-active-content.mjs`, `scripts/lib/uri-safety.mjs` or
// `scripts/lib/mdx-active-content.mjs`, and until now nothing held the copy to
// the original.
//
// It had already drifted. `ACTIVE_ELEMENTS` gained `base` and `meta` in
// 5dad895 (the parser-based rescan), while the document had been written
// earlier in 29fd4d8 and was never revisited, so a submitter whose export
// carried `<base>` got a CI finding in vocabulary the document did not define
// -- against advice ("remove it") that pointed at a list the element was
// missing from.
//
// Each list is checked in both directions, because either direction failing is
// the same defect seen from a different side: an undocumented rule rejects
// submissions for a reason nobody can look up, and a documented rule that no
// longer exists tells submitters to avoid something harmless.
//
// Parsing the constant out of the module source would be enough to catch a
// renamed entry and not enough to catch a dead one -- a constant the scanner
// stopped consulting still parses. So every entry is also run through the
// scanner it belongs to and asserted to actually produce (or, for the allowed
// sets, not produce) a finding. The document is then pinned to behaviour, with
// the constant only as the bridge between them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { findActiveContent as findSvgActiveContent } from '../scripts/lib/svg-active-content.mjs';
import { findActiveContent as findMdxActiveContent } from '../scripts/lib/mdx-active-content.mjs';

const root = new URL('..', import.meta.url).pathname;

const read = (relative) => readFileSync(join(root, relative), 'utf8');

const doc = read('CONTENT-SECURITY.md');
const svgModule = read('scripts/lib/svg-active-content.mjs');
const uriModule = read('scripts/lib/uri-safety.mjs');
const mdxModule = read('scripts/lib/mdx-active-content.mjs');

/**
 * The entries of a `const <name> = new Set([...])` or `= [...]` literal.
 *
 * The declarations this reads are plain lists of single-quoted strings. A
 * declaration that stops being one -- built from a spread, a concat, a
 * computed value -- fails here rather than silently reading as empty, because
 * an empty enforced set would make every "documented but not enforced"
 * assertion below fail open.
 */
function literalEntries(source, name, label) {
  const match = new RegExp(
    `const ${name} = (?:new Set\\()?\\[([^\\]]*)\\]`,
    'u',
  ).exec(source);
  assert.ok(match, `${label}: no array/Set literal found for ${name}`);

  const body = match[1];
  const entries = [...body.matchAll(/'([^']*)'/gu)].map(([, value]) => value);
  assert.ok(
    entries.length > 0,
    `${label}: ${name} parsed as empty; the declaration is no longer a literal list of strings`,
  );

  const leftover = body
    .replace(/'[^']*'/gu, '')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/[^\n]*/gu, '')
    .replace(/[\s,]/gu, '');
  assert.equal(
    leftover,
    '',
    `${label}: ${name} contains entries this test cannot read (${leftover}); extend the parser rather than narrowing the contract`,
  );

  return new Set(entries);
}

/**
 * The inline-code spans (`` `x` ``) of the bullet whose first line matches
 * `anchor`.
 *
 * Several of these lists wrap across lines, so the bullet is read to its end:
 * continuation lines up to the next bullet, heading, or blank line.
 */
function documentedCodeSpans(anchor, label) {
  const lines = doc.split('\n');
  const start = lines.findIndex((candidate) => candidate.includes(anchor));
  assert.ok(
    start !== -1,
    `${label}: CONTENT-SECURITY.md has no line containing ${JSON.stringify(anchor)}`,
  );

  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || /^\s*[-*#]/u.test(line)) break;
    block.push(line);
  }

  const spans = [...block.join('\n').matchAll(/`([^`]+)`/gu)].map(
    ([, value]) => value,
  );
  assert.ok(
    spans.length > 0,
    `${label}: no inline-code entries in that bullet`,
  );
  return spans;
}

const sorted = (values) => [...values].sort();

const svgDocument = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

// --- SVG script-bearing and embedding elements -----------------------------

const documentedSvgElements = new Set(
  documentedCodeSpans(
    '**Script-bearing or embedding elements**',
    'SVG elements',
  )
    .map((span) => /^<([a-zA-Z][\w-]*)>$/u.exec(span))
    .filter(Boolean)
    .map(([, element]) => element),
);

const enforcedSvgElements = literalEntries(
  svgModule,
  'ACTIVE_ELEMENTS',
  'SVG elements',
);

test('CONTENT-SECURITY.md lists exactly the SVG elements the scanner rejects', () => {
  assert.deepEqual(
    sorted(documentedSvgElements),
    sorted(enforcedSvgElements),
    'the "Script-bearing or embedding elements" bullet and ACTIVE_ELEMENTS in ' +
      'scripts/lib/svg-active-content.mjs disagree; a submitter can only look ' +
      'up a finding the document names',
  );
});

test('every SVG element CONTENT-SECURITY.md names is actually rejected', () => {
  for (const element of sorted(documentedSvgElements)) {
    const findings = findSvgActiveContent(svgDocument(`<${element}/>`));
    assert.deepEqual(
      findings,
      [`contains a <${element}> element`],
      `<${element}> is documented as rejected but findActiveContent did not report it`,
    );
  }
});

test('<foreignObject>, documented as allowed, stays allowed', () => {
  // Called out explicitly in the document because draw.io emits it for plain
  // text labels; banning it would reject most real submissions.
  assert.deepEqual(
    findSvgActiveContent(
      svgDocument('<foreignObject><p>label</p></foreignObject>'),
    ),
    [],
    'CONTENT-SECURITY.md promises <foreignObject> itself is allowed',
  );
});

// --- SVG embedded-document attributes --------------------------------------

const documentedDocumentAttributes = new Set(
  documentedCodeSpans(
    '**Embedded-document attributes**',
    'document attributes',
  ),
);

const enforcedDocumentAttributes = literalEntries(
  svgModule,
  'DOCUMENT_ATTRIBUTES',
  'document attributes',
);

test('CONTENT-SECURITY.md lists exactly the embedded-document attributes the scanner rejects', () => {
  assert.deepEqual(
    sorted(documentedDocumentAttributes),
    sorted(enforcedDocumentAttributes),
    'the "Embedded-document attributes" bullet and DOCUMENT_ATTRIBUTES disagree',
  );
});

test('every embedded-document attribute CONTENT-SECURITY.md names is actually rejected', () => {
  for (const attribute of sorted(documentedDocumentAttributes)) {
    const findings = findSvgActiveContent(
      svgDocument(`<g ${attribute}="&lt;b&gt;"/>`),
    );
    assert.ok(
      findings.some((finding) => finding.includes(attribute)),
      `${attribute} is documented as rejected but produced no finding: ${JSON.stringify(findings)}`,
    );
  }
});

// --- Script-executing URI schemes ------------------------------------------

// The same bullet also describes `data:` URIs, whose media-type list the
// document deliberately abbreviates ("any `+xml` type", "JavaScript types").
// Only the scheme names are a closed enumeration, so only those are pinned;
// the data-type behaviour is covered by tests/uri-safety.test.mjs.
const documentedSchemes = new Set(
  documentedCodeSpans('**Script-executing URI schemes**', 'URI schemes')
    .filter((span) => /^[a-z]+:$/u.test(span) && span !== 'data:')
    .map((span) => span.slice(0, -1)),
);

const enforcedSchemes = literalEntries(
  uriModule,
  'ACTIVE_SCHEMES',
  'URI schemes',
);

test('CONTENT-SECURITY.md lists exactly the script-executing URI schemes the scanner rejects', () => {
  assert.deepEqual(
    sorted(documentedSchemes),
    sorted(enforcedSchemes),
    'the "Script-executing URI schemes" bullet and ACTIVE_SCHEMES in ' +
      'scripts/lib/uri-safety.mjs disagree',
  );
});

test('every script-executing URI scheme CONTENT-SECURITY.md names is actually rejected', () => {
  for (const scheme of sorted(documentedSchemes)) {
    const findings = findSvgActiveContent(
      svgDocument(`<a href="${scheme}:payload"/>`),
    );
    assert.deepEqual(
      findings,
      [`contains a script URI in href="${scheme}:..."`],
      `${scheme}: is documented as rejected but findActiveContent did not report it`,
    );
  }
});

// --- Inert inline MDX elements ---------------------------------------------

const documentedMdxElements = new Set(
  documentedCodeSpans(
    'A small set of inert inline HTML elements',
    'MDX elements',
  ),
);

const enforcedMdxElements = literalEntries(
  mdxModule,
  'ALLOWED_ELEMENTS',
  'MDX elements',
);

test('CONTENT-SECURITY.md lists exactly the inline HTML elements imported pages may use', () => {
  assert.deepEqual(
    sorted(documentedMdxElements),
    sorted(enforcedMdxElements),
    'the allowed inline-element list and ALLOWED_ELEMENTS in ' +
      'scripts/lib/mdx-active-content.mjs disagree; this list is permissive, ' +
      'so a stale copy either rejects prose the gate accepts or promises an ' +
      'element the gate rejects',
  );
});

test('every inline HTML element CONTENT-SECURITY.md allows passes the page scanner', () => {
  for (const element of sorted(documentedMdxElements)) {
    const body = `Prose with <${element}>markup</${element}> in it.`;
    assert.deepEqual(
      findMdxActiveContent(body),
      [],
      `<${element}> is documented as allowed but the page scanner flagged it`,
    );
  }
});

test('an element outside the documented list is still rejected', () => {
  // Without this, an ALLOWED_ELEMENTS that had swallowed the whole HTML
  // vocabulary would satisfy every assertion above.
  const findings = findMdxActiveContent('<div>block</div>');
  assert.deepEqual(
    findings.map(({ reason }) => reason),
    ['disallowed element <div>'],
    'CONTENT-SECURITY.md promises any other raw HTML/JSX element is rejected',
  );
});

test('a braced MDX expression is rejected, as documented', () => {
  const findings = findMdxActiveContent('Prose with {1 + 1} in it.');
  assert.deepEqual(
    findings.map(({ reason }) => reason),
    ['MDX expression'],
    'CONTENT-SECURITY.md promises any braced {expression} is rejected',
  );
});

test('the component CONTENT-SECURITY.md names as allowed is the one the scanner allows', () => {
  const match = /const ALLOWED_COMPONENT = '([^']+)'/u.exec(mdxModule);
  assert.ok(
    match,
    'no ALLOWED_COMPONENT literal in scripts/lib/mdx-active-content.mjs',
  );
  const [, component] = match;

  assert.ok(
    doc.includes(`\`${component}\` component`),
    `CONTENT-SECURITY.md does not name ${component} as the allowed component`,
  );
  assert.deepEqual(
    findMdxActiveContent(`<${component} project="example" />`),
    [],
    `${component} is documented as allowed but the page scanner flagged it`,
  );
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
