// Guards the parts of the module-resolution contract for src/ and scripts/
// that `npm run check:unused` (knip) does not. knip already fails on a
// relative or @site/ import that resolves to nothing and on a bare import not
// declared in package.json, but it resolves the way a bundler does, so two
// failure modes stay silent until the code runs:
//
//   - an extensionless relative import inside a scripts/*.mjs file resolves
//     under webpack but throws ERR_MODULE_NOT_FOUND under plain Node, so it
//     only fails when the script is actually invoked;
//   - a `node:` specifier that names no builtin.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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
// Comment bodies and template literals that *emit* an import into generated
// MDX must not be picked up, so the pattern requires a real statement keyword
// at the start of a line.
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
