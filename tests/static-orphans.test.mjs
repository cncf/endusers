import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname;
const staticRoot = join(repoRoot, 'static');

// Directories under static/ that are published but whose contents are only
// ever reached through a reference written somewhere in the source tree.
// Docusaurus copies all of static/ into build/, so an unreferenced file is
// shipped to every visitor as bytes nothing can request.
const GUARDED_DIRS = ['images', 'social', 'favicons'];

// Source trees that may legitimately reference a static asset.
const SOURCE_DIRS = ['docs', 'blog', 'src', 'data', 'adr'];
const SOURCE_FILES = [
  'docusaurus.config.js',
  'sidebars.js',
  'static/manifest.json',
];
const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.md',
  '.mdx',
  '.json',
  '.css',
  '.yml',
  '.yaml',
  '.html',
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function readSourceCorpus() {
  const files = [];
  for (const dir of SOURCE_DIRS) {
    let stats;
    try {
      stats = statSync(join(repoRoot, dir));
    } catch {
      continue;
    }
    if (stats.isDirectory()) files.push(...walk(join(repoRoot, dir)));
  }
  for (const file of SOURCE_FILES) files.push(join(repoRoot, file));

  return files
    .filter((f) => SOURCE_EXTENSIONS.has(f.slice(f.lastIndexOf('.'))))
    .map((f) => {
      try {
        return readFileSync(f, 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

const corpus = readSourceCorpus();

test('the source corpus is non-empty, so the orphan checks cannot pass vacuously', () => {
  assert.ok(
    corpus.length > 10_000,
    `expected a substantial source corpus, read ${corpus.length} chars`,
  );
});

for (const dir of GUARDED_DIRS) {
  test(`every file in static/${dir}/ is referenced from the source tree`, () => {
    const base = join(staticRoot, dir);
    let entries;
    try {
      entries = walk(base);
    } catch {
      return; // directory removed entirely: nothing to orphan
    }

    const orphans = entries.filter((file) => {
      const webPath = `/${relative(staticRoot, file).split('\\').join('/')}`;
      // Match the absolute web path, or the same path without its leading
      // slash (Docusaurus accepts `img/favicon.ico` in config fields).
      return !corpus.includes(webPath) && !corpus.includes(webPath.slice(1));
    });

    assert.deepEqual(
      orphans.map((f) => relative(repoRoot, f)).sort(),
      [],
      `unreferenced files under static/${dir}/ are published but unreachable`,
    );
  });
}
