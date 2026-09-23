import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const staticRoot = join(repoRoot, 'static');
const cssPath = join(repoRoot, 'src', 'css', 'custom.css');
const css = readFileSync(cssPath, 'utf8');

// Every url('/...') reference in custom.css, in source order. font-face
// declarations are the only ones root-relative today, but the scan is not
// scoped to @font-face so a future url() elsewhere in the file is covered too.
const URL_REF = /url\(['"]?(\/[^'")]+)['"]?\)/g;
const REFERENCES = [...css.matchAll(URL_REF)].map((match) => match[1]);

const FONT_FILES = readdirSync(join(staticRoot, 'fonts'));

test('the scan finds url() references in custom.css to check', () => {
  assert.ok(
    REFERENCES.length > 0,
    'expected custom.css to contain at least one url() reference; found ' +
      `${REFERENCES.length}. A regression in the extraction regex would ` +
      'silently make every other test here vacuous.',
  );
});

test('every url() reference in custom.css resolves to a real file under static/, case-exactly', () => {
  // GitHub Pages serves from a case-sensitive filesystem; a reference whose
  // case differs from the file on disk resolves on a case-insensitive
  // developer machine and 404s in production, so this walks each path
  // segment against readdirSync rather than relying on statSync alone.
  const broken = [];
  for (const ref of REFERENCES) {
    const segments = decodeURIComponent(ref).split('/').filter(Boolean);
    let dir = staticRoot;
    let ok = true;
    for (const [index, segment] of segments.entries()) {
      let entries;
      try {
        entries = readdirSync(dir);
      } catch {
        ok = false;
        break;
      }
      if (!entries.includes(segment)) {
        ok = false;
        break;
      }
      dir = join(dir, segment);
      if (index === segments.length - 1 && !statSync(dir).isFile()) ok = false;
    }
    if (!ok) broken.push(ref);
  }
  assert.deepEqual(
    broken,
    [],
    `url() references in custom.css not resolvable case-exactly under static/:\n${broken.join('\n')}`,
  );
});

test('every file under static/fonts/ is referenced by an @font-face in custom.css', () => {
  const referencedNames = new Set(
    REFERENCES.filter((ref) => ref.startsWith('/fonts/')).map((ref) =>
      ref.slice('/fonts/'.length),
    ),
  );
  const orphaned = FONT_FILES.filter((name) => !referencedNames.has(name));
  assert.deepEqual(
    orphaned,
    [],
    `files under static/fonts/ not referenced by any @font-face in custom.css:\n${orphaned.join('\n')}`,
  );
});
