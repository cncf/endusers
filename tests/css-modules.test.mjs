import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A CSS Module exports only the class names its stylesheet declares, so
// `styles.notDeclared` is plain `undefined` property access: React renders the
// element with no `class` attribute, `docusaurus build` stays green, and the
// element silently loses its styling. Nothing else in the pipeline resolves a
// class name across the JS/CSS boundary, so this test is the only gate on it.
const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'src');

// Known drift, tracked so it cannot spread. Each entry is asserted to still be
// drifting below, so fixing the source makes this test demand the entry's
// removal rather than rotting into a permanent exemption.
const KNOWN_UNDECLARED = new Set([
  'src/theme/Footer/styles.module.css#iconLink',
]);
const KNOWN_ORPHANS = new Set(['src/theme/Footer/styles.module.css#orgText']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Line and block comments are stripped so commented-out JSX never counts as a
// live reference to a class name.
function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Class selectors are read from selector preludes only — the text preceding
// each `{`. Scanning whole stylesheets instead would pick up `.png` inside a
// `url(./x.png)` declaration, and requiring a leading space would miss the
// minified `}.note,.source {` form this repository actually ships.
function declaredClassesIn(source) {
  const names = new Set();
  for (const [, prelude] of stripCssComments(source).matchAll(/([^{}]*)\{/g)) {
    for (const [, name] of prelude.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      names.add(name);
    }
  }
  return names;
}

// `composes: foo from './other.css'` pulls a class in from another stylesheet
// rather than declaring it locally; `composes: foo;` pulls it from this one.
function composedNamesIn(source) {
  const out = [];
  for (const [, names, from] of stripCssComments(source).matchAll(
    /composes\s*:\s*([^;}]+?)(?:\s+from\s+['"]([^'"]+)['"])?\s*[;}]/g,
  )) {
    for (const name of names.trim().split(/\s+/)) out.push({ name, from });
  }
  return out;
}

const cssModules = walk(srcDir).filter((file) => file.endsWith('.module.css'));
const importers = walk(srcDir).filter((file) =>
  /\.(js|jsx|ts|tsx)$/.test(file),
);

// Maps each importer to the stylesheet it pulls in and the local binding it
// reads class names off, e.g. `import styles from './styles.module.css'`.
const bindings = [];
for (const file of importers) {
  const source = stripJsComments(readFileSync(file, 'utf8'));
  // Import statements are excluded from the reference scan: the specifier
  // `'./styles.module.css'` otherwise reads as a `styles.module` reference.
  const body = source.replace(
    /^\s*import[\s\S]*?from\s*['"][^'"]+['"];?/gm,
    '',
  );
  for (const [, binding, specifier] of source.matchAll(
    /import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.css)['"]/g,
  )) {
    bindings.push({
      file,
      binding,
      stylesheet: resolve(dirname(file), specifier),
      source: body,
    });
  }
}

// `styles.name`, `styles['name']` and `styles["name"]`. A computed lookup on a
// variable (`styles[key]`) cannot be resolved statically and is collected
// separately so it can suppress the orphan assertion for that stylesheet.
function referencesIn(source, binding) {
  const dotted = [
    ...source.matchAll(new RegExp(`\\b${binding}\\.(\\w+)`, 'g')),
  ].map(([, name]) => name);
  const bracketed = [
    ...source.matchAll(new RegExp(`\\b${binding}\\[\\s*['"]([^'"]+)['"]`, 'g')),
  ].map(([, name]) => name);
  return [...dotted, ...bracketed];
}

function hasComputedLookup(source, binding) {
  return new RegExp(`\\b${binding}\\[\\s*[^'"\\]]`).test(source);
}

const rel = (file) => relative(root, file).split('\\').join('/');
const key = (stylesheet, name) => `${rel(stylesheet)}#${name}`;

test('every src/ stylesheet importer resolves to a stylesheet on disk', () => {
  assert.ok(bindings.length > 0, 'expected at least one CSS Module importer');
  for (const { file, stylesheet } of bindings) {
    assert.ok(
      cssModules.includes(stylesheet),
      `${rel(file)} imports ${rel(stylesheet)}, which does not exist`,
    );
  }
});

test('every referenced CSS Module class is declared by its stylesheet', () => {
  const undeclared = [];
  for (const { file, binding, stylesheet, source } of bindings) {
    const declared = declaredClassesIn(readFileSync(stylesheet, 'utf8'));
    for (const name of referencesIn(source, binding)) {
      if (declared.has(name)) continue;
      if (KNOWN_UNDECLARED.has(key(stylesheet, name))) continue;
      undeclared.push(
        `${rel(file)} reads ${binding}.${name}, but ${rel(stylesheet)} declares no .${name}`,
      );
    }
  }
  assert.deepEqual(undeclared, []);
});

test('no CSS Module class is declared without a reader', () => {
  const referenced = new Map();
  const unresolvable = new Set();
  for (const { binding, stylesheet, source } of bindings) {
    if (!referenced.has(stylesheet)) referenced.set(stylesheet, new Set());
    for (const name of referencesIn(source, binding)) {
      referenced.get(stylesheet).add(name);
    }
    if (hasComputedLookup(source, binding)) unresolvable.add(stylesheet);
  }

  const orphans = [];
  for (const stylesheet of cssModules) {
    if (unresolvable.has(stylesheet)) continue;
    const css = readFileSync(stylesheet, 'utf8');
    const seen = referenced.get(stylesheet) ?? new Set();
    // A class reached only through `composes` has no JS reader by design.
    for (const { name } of composedNamesIn(css)) seen.add(name);
    for (const name of declaredClassesIn(css)) {
      if (seen.has(name)) continue;
      if (KNOWN_ORPHANS.has(key(stylesheet, name))) continue;
      orphans.push(`${rel(stylesheet)} declares .${name}, which nothing reads`);
    }
  }
  assert.deepEqual(orphans, []);
});

test('every composes target resolves to a declared class', () => {
  for (const stylesheet of cssModules) {
    const css = readFileSync(stylesheet, 'utf8');
    for (const { name, from } of composedNamesIn(css)) {
      if (from && !from.startsWith('.')) continue; // package specifier
      const target = from ? resolve(dirname(stylesheet), from) : stylesheet;
      const targetCss = cssModules.includes(target)
        ? readFileSync(target, 'utf8')
        : null;
      assert.ok(
        targetCss !== null,
        `${rel(stylesheet)} composes from ${from}, which does not exist`,
      );
      assert.ok(
        declaredClassesIn(targetCss).has(name),
        `${rel(stylesheet)} composes ${name}, which ${rel(target)} does not declare`,
      );
    }
  }
});

// The two assertions below keep the exemption lists honest: an entry that no
// longer describes real drift must be deleted, so a fix to src/theme/Footer/
// tightens this test instead of leaving a stale carve-out behind.
test('every KNOWN_UNDECLARED entry still describes live drift', () => {
  for (const entry of KNOWN_UNDECLARED) {
    const [file, name] = entry.split('#');
    const stylesheet = join(root, file);
    const isReferenced = bindings.some(
      ({ stylesheet: sheet, binding, source }) =>
        sheet === stylesheet && referencesIn(source, binding).includes(name),
    );
    assert.ok(isReferenced, `${entry}: nothing references .${name} any more`);
    assert.ok(
      !declaredClassesIn(readFileSync(stylesheet, 'utf8')).has(name),
      `${entry} is now declared — remove it from KNOWN_UNDECLARED`,
    );
  }
});

test('every KNOWN_ORPHANS entry still describes live drift', () => {
  for (const entry of KNOWN_ORPHANS) {
    const [file, name] = entry.split('#');
    const stylesheet = join(root, file);
    assert.ok(
      declaredClassesIn(readFileSync(stylesheet, 'utf8')).has(name),
      `${entry} is no longer declared — remove it from KNOWN_ORPHANS`,
    );
    const isReferenced = bindings.some(
      ({ stylesheet: sheet, binding, source }) =>
        sheet === stylesheet && referencesIn(source, binding).includes(name),
    );
    assert.ok(
      !isReferenced,
      `${entry} now has a reader — remove it from KNOWN_ORPHANS`,
    );
  }
});
