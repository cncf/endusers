import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const staticRoot = join(repoRoot, 'static');

// Top-level names under static/ are the only absolute paths that resolve to a
// file on disk. Everything else beginning with "/" is a page route, which
// Docusaurus already enforces via onBrokenLinks: 'throw'.
const staticTopLevel = new Set(readdirSync(staticRoot));

// data/architectures/ assets are validated by scripts/validate-architecture-assets.mjs,
// and docusaurus.config.js branding assets are asserted in tests/site-config.test.mjs.
const SOURCES = [
  { dir: 'docs', extensions: ['.md', '.mdx'] },
  { dir: 'blog', extensions: ['.md', '.mdx', '.yml'] },
  { dir: 'src', extensions: ['.js', '.jsx', '.css'] },
];
const DATA_FILES = [
  'awards.json',
  'community-people.json',
  'community-roster.json',
  'members.json',
  'metrics.json',
  'milestones.json',
  'projects-born.json',
];

function walk(dir, extensions, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, extensions, found);
    else if (extensions.some((ext) => entry.name.endsWith(ext)))
      found.push(full);
  }
  return found;
}

function sourceFiles() {
  const files = [];
  for (const { dir, extensions } of SOURCES) {
    files.push(...walk(join(repoRoot, dir), extensions));
  }
  for (const name of DATA_FILES) files.push(join(repoRoot, 'data', name));
  return files;
}

// Absolute and protocol-relative URLs contain path segments that look exactly
// like local references (".../main/images/foo.jpg"). Remove them before
// scanning so a remote URL is never mistaken for a missing local asset.
function stripUrls(text) {
  return text
    .replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'`)\]<>]*/g, ' ')
    .replace(/(^|[\s"'`(=])\/\/[^\s"'`)\]<>]*/g, ' ');
}

const PATH_TOKEN = /\/[A-Za-z0-9._%-]+(?:\/[A-Za-z0-9._%~-]+)*/g;

function staticReferences(file) {
  const text = stripUrls(readFileSync(file, 'utf8'));
  const refs = new Map();
  for (const match of text.match(PATH_TOKEN) || []) {
    const ref = match.replace(/[.]+$/, '');
    const [, first] = ref.split('/');
    if (!staticTopLevel.has(first)) continue;
    // A bare "/img" with no file after it is not an asset reference.
    if (ref === `/${first}` && statSync(join(staticRoot, first)).isDirectory())
      continue;
    if (!refs.has(ref)) refs.set(ref, relative(repoRoot, file));
  }
  return refs;
}

function allStaticReferences() {
  const all = new Map();
  for (const file of sourceFiles()) {
    for (const [ref, origin] of staticReferences(file)) {
      if (!all.has(ref)) all.set(ref, []);
      all.get(ref).push(origin);
    }
  }
  return all;
}

const REFERENCES = allStaticReferences();

function describe(ref) {
  return `${ref} (referenced by ${REFERENCES.get(ref).join(', ')})`;
}

test('the scan finds references to check', () => {
  assert.ok(
    REFERENCES.size > 20,
    `expected the scan to find static references; found ${REFERENCES.size}. ` +
      'A regression in the extraction would silently make every other test here vacuous.',
  );
});

test('every referenced static asset exists on disk', () => {
  const missing = [];
  for (const ref of REFERENCES.keys()) {
    const target = join(staticRoot, decodeURIComponent(ref));
    try {
      if (!statSync(target).isFile())
        missing.push(`${describe(ref)} is not a file`);
    } catch {
      missing.push(describe(ref));
    }
  }
  assert.deepEqual(
    missing,
    [],
    `static assets referenced but absent from static/:\n${missing.join('\n')}`,
  );
});

test('referenced static assets are non-empty', () => {
  const empty = [];
  for (const ref of REFERENCES.keys()) {
    const target = join(staticRoot, decodeURIComponent(ref));
    let stats;
    try {
      stats = statSync(target);
    } catch {
      continue; // absence is reported by the test above
    }
    if (stats.isFile() && stats.size === 0) empty.push(describe(ref));
  }
  assert.deepEqual(empty, [], `zero-byte static assets:\n${empty.join('\n')}`);
});

test('referenced static assets match the on-disk name exactly', () => {
  // GitHub Pages serves from a case-sensitive filesystem. A reference whose
  // case differs from the file on disk resolves locally on macOS and 404s in
  // production, so statSync() alone is not enough.
  const mismatched = [];
  for (const ref of REFERENCES.keys()) {
    const segments = decodeURIComponent(ref).split('/').filter(Boolean);
    let dir = staticRoot;
    for (const segment of segments) {
      let entries;
      try {
        entries = readdirSync(dir);
      } catch {
        break;
      }
      if (!entries.includes(segment)) {
        const insensitive = entries.find(
          (entry) => entry.toLowerCase() === segment.toLowerCase(),
        );
        if (insensitive)
          mismatched.push(`${describe(ref)} — on disk as "${insensitive}"`);
        break;
      }
      dir = join(dir, segment);
    }
  }
  assert.deepEqual(
    mismatched,
    [],
    `case-mismatched static references:\n${mismatched.join('\n')}`,
  );
});

test('no static reference escapes static/ via path traversal', () => {
  const escaping = [];
  for (const ref of REFERENCES.keys()) {
    const target = resolve(staticRoot, `.${decodeURIComponent(ref)}`);
    if (target !== staticRoot && !target.startsWith(`${staticRoot}/`))
      escaping.push(describe(ref));
  }
  assert.deepEqual(
    escaping,
    [],
    `static references resolving outside static/:\n${escaping.join('\n')}`,
  );
});

test('every local CNCFProjectCard logo prop resolves under static/', () => {
  // <CNCFProjectCard logo="/img/cncf-projects/..."> is authored by hand in the
  // architecture docs. The component renders the value straight into <img src>,
  // so a typo produces a broken image with no build-time error.
  const cardLogos = new Map();
  for (const file of walk(join(repoRoot, 'docs'), ['.md', '.mdx'])) {
    const text = readFileSync(file, 'utf8');
    for (const [, value] of text.matchAll(/\blogo=["']([^"']+)["']/g)) {
      if (!value.startsWith('/')) continue;
      if (!cardLogos.has(value)) cardLogos.set(value, relative(repoRoot, file));
    }
  }
  const broken = [];
  for (const [value, origin] of cardLogos) {
    const target = join(staticRoot, decodeURIComponent(value));
    try {
      if (!statSync(target).isFile())
        broken.push(`${value} (${origin}) is not a file`);
    } catch {
      broken.push(`${value} (${origin})`);
    }
  }
  assert.deepEqual(
    broken,
    [],
    `CNCFProjectCard logo props not resolvable under static/:\n${broken.join('\n')}`,
  );
});
