// Guards the module-resolution contract for src/ and scripts/.
//
// Every `import ... from '<specifier>'` is a plain string that has to name
// something real somewhere else: a file on disk, a Node builtin, or a package
// declared in package.json. Nothing in the existing suite reads those strings.
// The failure modes they hide are all silent until something else runs:
//
//   - a renamed or deleted component breaks `npm run build`, which no test runs;
//   - an extensionless relative import inside a scripts/*.mjs file resolves
//     under webpack but throws ERR_MODULE_NOT_FOUND under plain Node, so it
//     only fails when the script is actually invoked;
//   - a bare specifier that is not declared in package.json keeps working from
//     a hoisted transitive install and breaks on a clean `npm ci`.
//
// Scope is deliberately narrow: src/**/*.js and scripts/**/*.mjs. Imports
// written inside docs/ and blog/ MDX are a separate contract and are not read
// here. This file checks that specifiers *resolve*; it does not check which
// named exports a module provides, nor how any component behaves.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const packageJson = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);
const declaredPackages = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
]);

function walk(dir, predicate) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full, predicate));
    else if (predicate(entry)) found.push(full);
  }
  return found.sort();
}

const sourceFiles = [
  ...walk(join(repoRoot, 'src'), (name) => name.endsWith('.js')),
  ...walk(join(repoRoot, 'scripts'), (name) => name.endsWith('.mjs')),
];

// `import x from 'y'`, `import 'y'`, `export { x } from 'y'`, `import('y')`.
// Comment bodies and the template literal in import-architectures.mjs that
// *emits* an import into generated MDX must not be picked up, so the pattern
// requires a real statement keyword at the start of a line.
const STATIC_IMPORT =
  /^\s*(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]/gm;
const BARE_IMPORT = /^\s*import\s*['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersOf(file) {
  const source = readFileSync(file, 'utf8');
  const found = new Set();
  for (const pattern of [STATIC_IMPORT, BARE_IMPORT, DYNAMIC_IMPORT]) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

const imports = sourceFiles.flatMap((file) =>
  specifiersOf(file).map((specifier) => ({
    file: relative(repoRoot, file),
    specifier,
  })),
);

// Docusaurus/webpack resolution for src/: extensions are optional and a
// directory may be entered through its index file.
const WEBPACK_CANDIDATES = [
  '',
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
  '.json',
  '/index.js',
  '/index.jsx',
  '/index.ts',
  '/index.tsx',
];

function resolvesWithCandidates(base) {
  return WEBPACK_CANDIDATES.some(
    (extension) =>
      existsSync(base + extension) && statSync(base + extension).isFile(),
  );
}

// Guards against a regex regression quietly emptying every assertion below.
test('the import scan finds source files and specifiers', () => {
  assert.ok(sourceFiles.length >= 10, `only ${sourceFiles.length} files found`);
  assert.ok(imports.length >= 20, `only ${imports.length} imports found`);
  for (const required of [
    'src/components/MemberDirectory/index.js',
    'scripts/validate-awards.mjs',
  ]) {
    assert.ok(
      sourceFiles.some((file) => relative(repoRoot, file) === required),
      `${required} was not scanned`,
    );
  }
});

test('every node: specifier names a real Node builtin', () => {
  const unknown = imports
    .filter(({ specifier }) => specifier.startsWith('node:'))
    .filter(({ specifier }) => !isBuiltin(specifier))
    .map(({ file, specifier }) => `${file} -> ${specifier}`);
  assert.deepEqual(unknown, [], 'imports of non-existent node: builtins');
});

test('every relative import in src/ resolves to a file', () => {
  const unresolved = [];
  for (const { file, specifier } of imports) {
    if (!file.startsWith('src/') || !specifier.startsWith('.')) continue;
    const base = resolve(repoRoot, dirname(file), specifier);
    if (!resolvesWithCandidates(base))
      unresolved.push(`${file} -> ${specifier}`);
  }
  assert.deepEqual(unresolved, [], 'src/ imports that resolve to nothing');
});

test('every relative import in scripts/ resolves exactly, extension included', () => {
  // Plain Node ESM performs no extension guessing: `./lib/github` throws
  // ERR_MODULE_NOT_FOUND even though webpack would accept it. These files run
  // under `node scripts/...`, so the exact filename is the contract.
  const unresolved = [];
  for (const { file, specifier } of imports) {
    if (!file.startsWith('scripts/') || !specifier.startsWith('.')) continue;
    const target = resolve(repoRoot, dirname(file), specifier);
    if (!existsSync(target) || !statSync(target).isFile()) {
      unresolved.push(`${file} -> ${specifier}`);
    }
  }
  assert.deepEqual(unresolved, [], 'scripts/ imports Node cannot resolve');
});

test('every @site/ alias resolves from the repository root', () => {
  // `@site` is the Docusaurus alias for the project root. A stale path here
  // fails the production build and nothing earlier.
  const unresolved = [];
  for (const { file, specifier } of imports) {
    if (!specifier.startsWith('@site/')) continue;
    const base = join(repoRoot, specifier.slice('@site/'.length));
    if (!resolvesWithCandidates(base))
      unresolved.push(`${file} -> ${specifier}`);
  }
  assert.deepEqual(unresolved, [], '@site/ aliases that resolve to nothing');
});

test('every bare import is declared in package.json', () => {
  const undeclared = [];
  for (const { file, specifier } of imports) {
    if (
      specifier.startsWith('.') ||
      specifier.startsWith('node:') ||
      specifier.startsWith('@site/')
    ) {
      continue;
    }
    const segments = specifier.split('/');
    let packageName = specifier.startsWith('@')
      ? segments.slice(0, 2).join('/')
      : segments[0];
    // `@docusaurus/Link`, `@docusaurus/useBaseUrl` and friends are theme
    // aliases served by @docusaurus/core, not published packages.
    if (specifier.startsWith('@docusaurus/')) packageName = '@docusaurus/core';
    if (isBuiltin(packageName)) continue;
    if (!declaredPackages.has(packageName)) {
      undeclared.push(`${file} -> ${specifier} (needs ${packageName})`);
    }
  }
  assert.deepEqual(undeclared, [], 'imports of undeclared packages');
});
