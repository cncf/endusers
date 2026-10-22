// Every name on the SVG allowlists is accepted when it appears in a document.
//
// The allowlists are the gate's behaviour: dropping an element or attribute
// from one turns an inert diagram in the imported corpus into a rejected file.
// The property tests in active-content-allowlist.test.mjs draw from the same
// sets but treat a failed-closed document as a passing outcome, so a lost
// entry is invisible to them. Here each entry is placed in otherwise inert
// markup and must be reported clean and returned byte for byte.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findActiveContent,
  METADATA_ATTRIBUTES,
  METADATA_NAMESPACES,
  stripActiveContent,
  SVG_ATTRIBUTES,
  SVG_ELEMENTS,
  SVG_ROOT_ATTRIBUTES,
  XHTML_ATTRIBUTES,
  XHTML_ELEMENTS,
  XLINK_ATTRIBUTES,
  XML_ATTRIBUTES,
} from '../scripts/lib/svg-active-content.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const METADATA_NS = 'http://www.inkscape.org/namespaces/inkscape';

const root = (attributes, body) =>
  `<svg xmlns="${SVG_NS}"${attributes}>${body}</svg>`;

function assertInert(source, label) {
  assert.deepEqual(findActiveContent(source), [], label);
  assert.deepEqual(stripActiveContent(source), { source, removed: [] }, label);
}

const VOCABULARY = [
  ['SVG element', SVG_ELEMENTS, (name) => root('', `<${name}/>`)],
  ['SVG attribute', SVG_ATTRIBUTES, (name) => root('', `<rect ${name}="1"/>`)],
  [
    'SVG root attribute',
    SVG_ROOT_ATTRIBUTES,
    (name) => root(` ${name}="1"`, ''),
  ],
  [
    'XHTML element',
    XHTML_ELEMENTS,
    (name) =>
      root('', `<foreignObject><${name} xmlns="${XHTML_NS}"/></foreignObject>`),
  ],
  [
    'XHTML attribute',
    XHTML_ATTRIBUTES,
    (name) =>
      root(
        '',
        `<foreignObject><div xmlns="${XHTML_NS}" ${name}="1"/></foreignObject>`,
      ),
  ],
  [
    'xlink attribute',
    XLINK_ATTRIBUTES,
    (name) => root(` xmlns:xlink="${XLINK_NS}"`, `<use xlink:${name}="#a"/>`),
  ],
  [
    'xml attribute',
    XML_ATTRIBUTES,
    (name) => root('', `<text xml:${name}="en"/>`),
  ],
  [
    'metadata namespace',
    METADATA_NAMESPACES,
    (uri) => root(` xmlns:m="${uri}"`, '<m:anything m:any="1"/>'),
  ],
  [
    'metadata attribute',
    METADATA_ATTRIBUTES,
    (name) => root(` xmlns:m="${METADATA_NS}"`, `<m:page ${name}="1"/>`),
  ],
];

for (const [kind, names, document] of VOCABULARY) {
  test(`every allowlisted ${kind} is accepted in an inert document`, () => {
    assert.ok(names.size > 0, `${kind} allowlist is empty`);
    for (const name of names) {
      assertInert(document(name), `${kind} ${JSON.stringify(name)}`);
    }
  });
}

// A root-only attribute is accepted on the root alone; everywhere else it is
// a disallowed attribute like any other name off the list.
test('a root-only attribute is rejected on a non-root element', () => {
  for (const name of SVG_ROOT_ATTRIBUTES) {
    assert.deepEqual(findActiveContent(root('', `<g ${name}="x"/>`)), [
      `contains a disallowed attribute ${name} on <g>`,
    ]);
  }
});
