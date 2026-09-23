import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// A `var(--x)` reference to a custom property that is never declared is not an
// error anywhere in the pipeline: the declaration is simply dropped, the
// property falls back to its initial/inherited value, and the build stays
// green. Nothing in the test suite reads custom-property names, so a typo in a
// token name ships as a silently unstyled element.
const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'src');
const globalStylesheet = join(srcDir, 'css', 'custom.css');

// Custom properties supplied by the Infima/Docusaurus theme rather than by
// this repository. They are legitimately referenced without a local
// declaration, so they are excluded from the resolution assertion.
const VENDOR_PREFIXES = ['--ifm-', '--docusaurus-'];

// Custom properties this repository owns. Every token in this namespace must
// be both declared locally and referenced locally.
const PROJECT_PREFIX = '--cncf-';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// Comments are stripped so commented-out code never counts as a declaration
// or a reference in either direction.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

const allFiles = walk(srcDir);
const cssFiles = allFiles.filter((file) => file.endsWith('.css'));
const scriptFiles = allFiles.filter((file) => /\.(js|jsx|ts|tsx)$/.test(file));

function declarationsIn(source) {
  return [...stripComments(source).matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map(
    ([, name]) => name,
  );
}

// `var(--x)` and `var(--x, fallback)`. A reference carrying a fallback still
// renders something when the token is missing, so it is recorded separately
// from a bare reference.
function referencesIn(source) {
  return [
    ...stripComments(source).matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/g),
  ].map(([, name, next]) => ({ name, hasFallback: next === ',' }));
}

// React sets a custom property by using it as a style-object key, e.g.
// `style={{ '--bar-width': '40%' }}`. Those declarations live in JS, not CSS,
// and are invisible to a stylesheet-only scan.
function inlineStyleDeclarationsIn(source) {
  return [
    ...stripComments(source).matchAll(/['"`](--[A-Za-z0-9_-]+)['"`]\s*:/g),
  ].map(([, name]) => name);
}

const declared = new Set();
for (const file of cssFiles) {
  for (const name of declarationsIn(readFileSync(file, 'utf8'))) {
    declared.add(name);
  }
}
for (const file of scriptFiles) {
  for (const name of inlineStyleDeclarationsIn(readFileSync(file, 'utf8'))) {
    declared.add(name);
  }
}

const references = [];
for (const file of cssFiles) {
  for (const reference of referencesIn(readFileSync(file, 'utf8'))) {
    references.push({ ...reference, file });
  }
}

const isVendor = (name) =>
  VENDOR_PREFIXES.some((prefix) => name.startsWith(prefix));

// Guards against a regression in the extractors above silently emptying the
// sets the other assertions iterate over.
test('custom-property extraction is non-vacuous', () => {
  assert.ok(cssFiles.length > 0, 'found no stylesheets under src/');
  assert.ok(declared.size > 0, 'extracted no custom-property declarations');
  assert.ok(references.length > 0, 'extracted no var() references');
});

test('every var() reference resolves to a declared custom property', () => {
  const unresolved = references
    .filter(({ name }) => !declared.has(name) && !isVendor(name))
    .map(
      ({ name, file, hasFallback }) =>
        `${name} in ${relative(root, file)}${hasFallback ? ' (has fallback)' : ''}`,
    );
  assert.deepEqual(
    unresolved.sort(),
    [],
    'these var() references name a custom property that is declared in no ' +
      'src/ stylesheet, set by no inline style, and is not vendor-provided; ' +
      'the declaration is dropped silently at render time',
  );
});

test('vendor-namespaced references are the only undeclared ones', () => {
  // Asserts the allowlist is doing bounded work: if VENDOR_PREFIXES ever
  // widened enough to swallow project tokens, this catches it.
  for (const { name, file } of references) {
    if (isVendor(name) || declared.has(name)) continue;
    assert.fail(`${name} in ${relative(root, file)} is neither`);
  }
  const vendorNames = new Set(
    references.map(({ name }) => name).filter(isVendor),
  );
  for (const name of vendorNames) {
    assert.ok(
      !name.startsWith(PROJECT_PREFIX),
      `${name} is project-owned but matched the vendor allowlist`,
    );
  }
});

test(`every declared ${PROJECT_PREFIX}* token is referenced`, () => {
  const referenced = new Set(references.map(({ name }) => name));
  const projectTokens = [...declared].filter((name) =>
    name.startsWith(PROJECT_PREFIX),
  );
  assert.ok(
    projectTokens.length > 0,
    `extracted no ${PROJECT_PREFIX}* declarations`,
  );
  const orphans = projectTokens.filter((name) => !referenced.has(name)).sort();
  assert.deepEqual(
    orphans,
    [],
    `these ${PROJECT_PREFIX}* tokens are declared but no var() reads them`,
  );
});

test(`every ${PROJECT_PREFIX}* token declared for the light theme is redeclared for dark`, () => {
  const source = stripComments(readFileSync(globalStylesheet, 'utf8'));
  const blocks = [...source.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => ({
      selector: selector.trim(),
      tokens: declarationsIn(body).filter((name) =>
        name.startsWith(PROJECT_PREFIX),
      ),
    }),
  );

  const collect = (predicate) => {
    const names = new Set();
    for (const block of blocks) {
      if (!predicate(block.selector)) continue;
      for (const name of block.tokens) names.add(name);
    }
    return names;
  };

  // The `:root` selector carries a `:not(#\#)` specificity hack, so it is
  // matched by substring rather than by equality.
  const light = collect((selector) => selector.includes(':root'));
  const dark = collect((selector) => selector.includes("[data-theme='dark']"));

  assert.ok(light.size > 0, `no ${PROJECT_PREFIX}* tokens found on :root`);
  assert.ok(
    dark.size > 0,
    `no ${PROJECT_PREFIX}* tokens found on [data-theme='dark']`,
  );

  const missing = [...light].filter((name) => !dark.has(name)).sort();
  assert.deepEqual(
    missing,
    [],
    'these tokens are themed for light mode only, so dark mode silently ' +
      'inherits the light value',
  );
});
