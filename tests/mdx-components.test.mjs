import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const CONTENT_DIRS = ['docs', 'blog'];

// Tags that Docusaurus/MDX resolves without a file-local import.
const GLOBAL_TAGS = new Set(['Fragment']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.mdx?$/.test(entry)) out.push(full);
  }
  return out;
}

function contentFiles() {
  return CONTENT_DIRS.filter((dir) => existsSync(join(repoRoot, dir))).flatMap(
    (dir) => walk(join(repoRoot, dir)),
  );
}

// MDX treats `<Foo />` inside a fenced block or backticks as literal text, so
// those regions must be removed before scanning for real component usage.
function stripCode(source) {
  return source
    .replace(/^ {0,3}(```|~~~)[\s\S]*?^ {0,3}\1[^\n]*$/gm, '')
    .replace(/`[^`\n]*`/g, '');
}

function usedComponents(source) {
  return new Set(
    [...stripCode(source).matchAll(/<([A-Z][A-Za-z0-9]*)/g)]
      .map(([, tag]) => tag)
      .filter((tag) => !GLOBAL_TAGS.has(tag)),
  );
}

function importsOf(source) {
  const map = new Map();
  for (const [, local, specifier] of source.matchAll(
    /^import\s+([A-Za-z_$][\w$]*)\s+from\s+'([^']+)';?\s*$/gm,
  )) {
    map.set(local, specifier);
  }
  return map;
}

function relative(file) {
  return file.slice(repoRoot.length + 1);
}

function resolveSiteSpecifier(specifier) {
  const base = join(repoRoot, specifier.replace(/^@site\//, ''));
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const candidate of [
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.js'),
    join(base, 'index.jsx'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const FILES = contentFiles().map((file) => ({
  path: file,
  name: relative(file),
  source: readFileSync(file, 'utf8'),
}));

test('the docs/ and blog/ scan is non-empty', () => {
  assert.ok(
    FILES.length > 0,
    'no markdown found under docs/ or blog/ — the other assertions would pass vacuously',
  );
  const withComponents = FILES.filter(
    (file) => usedComponents(file.source).size > 0,
  );
  assert.ok(
    withComponents.length > 0,
    'no MDX component usage found — the component assertions would pass vacuously',
  );
});

test('every component used in docs/ or blog/ is imported in that file', () => {
  const missing = [];
  for (const file of FILES) {
    const imported = importsOf(file.source);
    for (const tag of usedComponents(file.source)) {
      if (!imported.has(tag)) missing.push(`${file.name}: <${tag}>`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `MDX renders an un-imported capitalized tag as an unknown element and the build fails late:\n${missing.join('\n')}`,
  );
});

test('every @site/ import in docs/ or blog/ resolves to a file on disk', () => {
  const unresolved = [];
  let checked = 0;
  for (const file of FILES) {
    for (const [local, specifier] of importsOf(file.source)) {
      if (!specifier.startsWith('@site/')) continue;
      checked += 1;
      if (!resolveSiteSpecifier(specifier)) {
        unresolved.push(`${file.name}: ${local} from '${specifier}'`);
      }
    }
  }
  assert.ok(checked > 0, 'no @site/ imports were checked');
  assert.deepEqual(unresolved, [], unresolved.join('\n'));
});

// The prop list is read from the component so a rename there cannot silently
// diverge from the 50+ hand-authored usages in docs/architectures/.
function projectCardProps() {
  const source = readFileSync(
    join(repoRoot, 'src/components/CNCFProjectCard/index.js'),
    'utf8',
  );
  const match = source.match(
    /export default function CNCFProjectCard\(\s*\{([^}]*)\}/,
  );
  assert.ok(match, 'could not read the CNCFProjectCard prop destructuring');
  return new Set(
    match[1]
      .split(',')
      .map((part) => part.split(/[=:]/)[0].trim())
      .filter(Boolean),
  );
}

function projectCardUsages() {
  const usages = [];
  for (const file of FILES) {
    for (const [, attrs] of stripCode(file.source).matchAll(
      /<CNCFProjectCard\b([\s\S]*?)\/>/g,
    )) {
      usages.push({
        file: file.name,
        props: new Set([...attrs.matchAll(/(\w+)\s*=/g)].map(([, key]) => key)),
      });
    }
  }
  return usages;
}

test('every CNCFProjectCard usage supplies the props the component dereferences', () => {
  const usages = projectCardUsages();
  assert.ok(usages.length > 0, 'no <CNCFProjectCard> usage found');
  const incomplete = [];
  for (const usage of usages) {
    // name is dereferenced unconditionally (name.slice) and href is the card's
    // only navigation target, so neither has a usable default.
    for (const required of ['name', 'href']) {
      if (!usage.props.has(required)) {
        incomplete.push(`${usage.file}: missing ${required}`);
      }
    }
  }
  assert.deepEqual(incomplete, [], incomplete.join('\n'));
});

test('no CNCFProjectCard usage passes a prop the component ignores', () => {
  const accepted = projectCardProps();
  const unknown = [];
  for (const usage of projectCardUsages()) {
    for (const prop of usage.props) {
      if (!accepted.has(prop)) unknown.push(`${usage.file}: ${prop}`);
    }
  }
  assert.deepEqual(
    unknown,
    [],
    `a misspelled prop is dropped silently — neither the build nor any validator reports it:\n${unknown.join('\n')}`,
  );
});
