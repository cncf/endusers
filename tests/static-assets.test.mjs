import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectCardLogos,
  collectReferences,
  findBrokenCardLogos,
  findCaseMismatches,
  findEmptyAssets,
  findEscapingReferences,
  findMissingAssets,
} from './tools/static-references.mjs';
import { ARCHITECTURE_IMAGE_PREFIX } from '../scripts/lib/published-assets.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const staticRoot = join(repoRoot, 'static');

// data/architectures/ assets are validated by scripts/validate-architecture-assets.mjs,
// and docusaurus.config.js branding assets are asserted in tests/site-config.test.mjs.
const SOURCES = [
  { dir: 'docs', extensions: ['.md', '.mdx'] },
  { dir: 'blog', extensions: ['.md', '.mdx', '.yml'] },
  { dir: 'src', extensions: ['.js', '.jsx', '.css'] },
];
const DATA_FILES = [
  'data/awards.json',
  'data/community-people.json',
  'data/community-roster.json',
  'data/members.json',
  'data/metrics.json',
  'data/projects-born.json',
];

const REFERENCES = collectReferences({
  repoRoot,
  staticRoot,
  sources: SOURCES,
  dataFiles: DATA_FILES,
});

// /img/architectures/<id>/<file> is published from
// docs/architectures/<id>/images/<file> (endusersArchitectureImages in
// docusaurus.config.js), so those references are rewritten relative to
// docs/architectures and checked there with the same rules.
const architecturesRoot = join(repoRoot, 'docs/architectures');
const fromStatic = new Map();
const fromArchitectures = new Map();
for (const [ref, origins] of REFERENCES) {
  if (ref.startsWith(ARCHITECTURE_IMAGE_PREFIX)) {
    const [id, ...rest] = ref
      .slice(ARCHITECTURE_IMAGE_PREFIX.length)
      .split('/');
    fromArchitectures.set(`/${[id, 'images', ...rest].join('/')}`, origins);
  } else {
    fromStatic.set(ref, origins);
  }
}
const ROOTS = [
  [fromStatic, staticRoot],
  [fromArchitectures, architecturesRoot],
];
const acrossRoots = (check) =>
  ROOTS.flatMap(([references, root]) => check(references, root));

test('the scan finds references to check', () => {
  assert.ok(
    fromArchitectures.size > 0,
    'expected architecture image references; the /img/architectures/ rewrite would otherwise check nothing',
  );
  assert.ok(
    REFERENCES.size > 20,
    `expected the scan to find static references; found ${REFERENCES.size}. ` +
      'A regression in the extraction would silently make every other test here vacuous.',
  );
});

test('every referenced static asset exists on disk', () => {
  const missing = acrossRoots(findMissingAssets);
  assert.deepEqual(
    missing,
    [],
    `static assets referenced but absent from static/:\n${missing.join('\n')}`,
  );
});

test('referenced static assets are non-empty', () => {
  const empty = acrossRoots(findEmptyAssets);
  assert.deepEqual(empty, [], `zero-byte static assets:\n${empty.join('\n')}`);
});

test('referenced static assets match the on-disk name exactly', () => {
  const mismatched = acrossRoots(findCaseMismatches);
  assert.deepEqual(
    mismatched,
    [],
    `case-mismatched static references:\n${mismatched.join('\n')}`,
  );
});

test('no static reference escapes static/ via path traversal', () => {
  const escaping = acrossRoots(findEscapingReferences);
  assert.deepEqual(
    escaping,
    [],
    `static references resolving outside static/:\n${escaping.join('\n')}`,
  );
});

test('every local CNCFProjectCard logo prop resolves under static/', () => {
  const cardLogos = collectCardLogos(join(repoRoot, 'docs'), repoRoot);
  const broken = findBrokenCardLogos(cardLogos, staticRoot);
  assert.deepEqual(
    broken,
    [],
    `CNCFProjectCard logo props not resolvable under static/:\n${broken.join('\n')}`,
  );
});
