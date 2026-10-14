// Guards the CNCF_HOST_SUFFIXES export in scripts/lib/url-safety.mjs against
// the drift it was extracted to close.
//
// scripts/validate-case-studies.mjs and scripts/validate-radar-reports.mjs
// used to each declare their own `const ALLOWED_HOST_SUFFIXES = ['cncf.io']`,
// kept in sync only by a cross-reference comment in each file pointing at the
// other. scripts/validate-metrics.mjs declared a third, independent copy
// extended with 'github.com'. Nothing enforced that editing one kept the
// others in step.
//
// This pins two things a comment cannot: the known call sites import the
// shared constant rather than redeclaring it, and a future call site that
// still declares its own `ALLOWED_HOST_SUFFIXES` array literal is caught
// rather than silently drifting.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CNCF_HOST_SUFFIXES } from '../scripts/lib/url-safety.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptsDir = join(repoRoot, 'scripts');

const SHARED_MODULE = 'scripts/lib/url-safety.mjs';

// A floor, not an exact set: losing one of these three would make the
// "imports the shared constant" assertion below vacuous.
const KNOWN_CALL_SITES = [
  'scripts/validate-case-studies.mjs',
  'scripts/validate-radar-reports.mjs',
  'scripts/validate-metrics.mjs',
];

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (entry.endsWith('.mjs')) found.push(full);
  }
  return found;
}

const scriptFiles = walk(scriptsDir)
  .map((full) => ({
    path: relative(repoRoot, full).split('\\').join('/'),
    source: readFileSync(full, 'utf8'),
  }))
  .sort((a, b) => a.path.localeCompare(b.path));

/**
 * Files outside the shared module that declare their own
 * `ALLOWED_HOST_SUFFIXES` array literal instead of importing
 * CNCF_HOST_SUFFIXES. scripts/validate-metrics.mjs's derived
 * `[...CNCF_HOST_SUFFIXES, 'github.com']` is not a literal copy and is not
 * flagged.
 */
export function redeclaredHostSuffixLists(files) {
  const declaresLiteral =
    /(?:const|let|var)\s+ALLOWED_HOST_SUFFIXES\s*=\s*\[\s*['"]/;
  return files
    .filter(
      ({ path, source }) =>
        path !== SHARED_MODULE && declaresLiteral.test(source),
    )
    .map(({ path }) => path);
}

test('CNCF_HOST_SUFFIXES is cncf.io, used as the base for every validator', () => {
  assert.deepEqual(CNCF_HOST_SUFFIXES, ['cncf.io']);
});

test('no script outside scripts/lib/url-safety.mjs redeclares a host-suffix allow-list literal', () => {
  assert.deepEqual(redeclaredHostSuffixLists(scriptFiles), []);
});

test('the known call sites import CNCF_HOST_SUFFIXES rather than a local copy', () => {
  const importsShared = (source) =>
    /import\s*\{[^}]*\bCNCF_HOST_SUFFIXES\b[^}]*\}\s*from\s*['"][^'"]*(?:url-safety|validate-utils)\.mjs['"]/.test(
      source,
    );
  for (const path of KNOWN_CALL_SITES) {
    const file = scriptFiles.find((f) => f.path === path);
    assert.ok(file, `expected ${path} to exist`);
    assert.ok(
      importsShared(file.source),
      `expected ${path} to import CNCF_HOST_SUFFIXES`,
    );
  }
});

test('the guard goes red on a reintroduced local copy (fixture)', () => {
  const fixture = [
    {
      path: 'scripts/validate-fixture.mjs',
      source: "const ALLOWED_HOST_SUFFIXES = ['cncf.io'];\n",
    },
  ];
  assert.deepEqual(redeclaredHostSuffixLists(fixture), [
    'scripts/validate-fixture.mjs',
  ]);
});

test('the guard stays clean for the derived metrics list (fixture)', () => {
  const fixture = [
    {
      path: 'scripts/validate-fixture.mjs',
      source:
        "const ALLOWED_HOST_SUFFIXES = [...CNCF_HOST_SUFFIXES, 'github.com'];\n",
    },
  ];
  assert.deepEqual(redeclaredHostSuffixLists(fixture), []);
});
