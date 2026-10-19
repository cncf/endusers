// Guards the JSX prop-casing convention #1603 established across src/.
//
// The swizzled footer's LinkedIn and Flickr icons were pasted in from HTML
// and carried `stroke-width`, `fill-rule` and `clip-rule` with them. React
// DOM rejects the hyphenated HTML spellings as JSX props -- "Invalid DOM
// property `stroke-width`. Did you mean `strokeWidth`?" -- so the development
// console was filled on every page render. 62c1252 renamed all three.
//
// That commit changed `src/theme/Footer/index.js` and nothing else: no file
// under tests/ names any of the six spellings, and tests/footer.test.mjs
// reads the footer's landmark, wordmark, links and copyright line without
// ever looking at a prop name. Reverting it left the whole suite green. This
// is not a coverage gap -- the footer's JSX executes, and src/ sits at 100%
// lines and regions in the unit lane -- it is the assertion that was never
// written, and the next SVG pasted in from a vendor's site reintroduces it.
//
// The check is made over the whole shipped tree rather than over the three
// props that happened to be wrong, because the mistake is a class: any
// hyphenated DOM attribute name typed into JSX behaves this way. `data-*`
// and `aria-*` are the two families React forwards verbatim, so they are the
// only hyphenated names allowed through.
//
// Attribute names are read from an @swc/core AST rather than matched in the
// source text. @swc/core is already a devDependency -- tests/tools/
// jsx-hooks.mjs transpiles src/ with it so `node --test` can import JSX --
// and parsing is what keeps a hyphenated word inside a string literal, a
// class name or a comment from being reported as a prop.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseSync } from '@swc/core';

import { walk } from './tools/static-references.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// The two hyphenated families React passes through to the DOM unchanged.
const FORWARDED_VERBATIM = /^(?:data|aria)-/u;

/**
 * Every JSX attribute name in `source` that React DOM would reject.
 *
 * Namespaced names (`xlink:href`) are left alone: they are not identifiers,
 * React has its own handling for them, and they are not the mistake this
 * guards against.
 *
 * @param {string} source JSX-bearing module text
 * @returns {string[]} offending attribute names, in source order
 */
function hyphenatedJsxProps(source) {
  const found = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    if (
      node.type === 'JSXAttribute' &&
      node.name.type === 'Identifier' &&
      node.name.value.includes('-') &&
      !FORWARDED_VERBATIM.test(node.name.value)
    ) {
      found.push(node.name.value);
    }
    for (const key of Object.keys(node)) visit(node[key]);
  };
  visit(parseSync(source, { syntax: 'ecmascript', jsx: true }));
  return found;
}

/**
 * Every offence across `modules`, labelled by the module it came from.
 *
 * The fixture below and the real tree are both reported through this, so the
 * failure message the shipped sources would produce is the one the fixture
 * test asserts rather than a shape only a regression would ever render.
 *
 * @param {Array<{label: string, source: string}>} modules
 * @returns {string[]} `"<label>: <prop>"` for each offending attribute
 */
function offences(modules) {
  const found = [];
  for (const { label, source } of modules) {
    for (const name of hyphenatedJsxProps(source))
      found.push(`${label}: ${name}`);
  }
  return found;
}

/** Every JSX-bearing module the site ships, labelled by repo-relative path. */
function srcModules() {
  return walk(`${repoRoot}src`, ['.js', '.jsx']).map((file) => ({
    label: file.slice(repoRoot.length),
    source: readFileSync(file, 'utf8'),
  }));
}

// The shapes the scan has to tell apart, in one module: the three props
// 62c1252 removed, the two forwarded families, a camelCase prop, a namespaced
// prop, and a hyphenated word in a position that is not a prop at all.
const FIXTURE = `
export default function Icon() {
  return (
    <svg className="stroke-width" xmlns="http://www.w3.org/2000/svg">
      <title>{'fill-rule'}</title>
      <path stroke-width="66" aria-label="x" data-testid="y" d="M0 0" />
      <path fill-rule="evenodd" clip-rule="evenodd" strokeWidth="2" />
      <use xlink:href="#a" />
    </svg>
  );
}
`;

test('the scan names exactly the props 62c1252 removed from the footer', () => {
  assert.deepEqual(offences([{ label: 'Icon.js', source: FIXTURE }]), [
    'Icon.js: stroke-width',
    'Icon.js: fill-rule',
    'Icon.js: clip-rule',
  ]);
});

test('every JSX prop under src/ is spelled the way React DOM accepts', () => {
  const modules = srcModules();
  assert.ok(
    modules.length > 0,
    'src/ holds no JSX-bearing module, so this contract is vacuous',
  );
  assert.deepEqual(
    offences(modules),
    [],
    'these JSX props are written in their hyphenated HTML form, which React DOM ' +
      'rejects with "Invalid DOM property" on every render; use the camelCase ' +
      'spelling, as 62c1252 did for the footer icons',
  );
});

// The specific regression 62c1252 fixed, named in the file it was fixed in,
// so a reader of that commit finds the test that holds it.
test('the footer icons still spell their SVG props in camelCase', () => {
  const footer = readFileSync(`${repoRoot}src/theme/Footer/index.js`, 'utf8');
  assert.deepEqual(hyphenatedJsxProps(footer), []);
  for (const prop of ['strokeWidth', 'fillRule', 'clipRule']) {
    assert.match(
      footer,
      new RegExp(`\\b${prop}=`, 'u'),
      `the footer no longer sets ${prop}; if the icon was replaced, this test ` +
        'should name whatever camelCase props the new markup carries',
    );
  }
});
