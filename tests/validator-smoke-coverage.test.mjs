// Guards the contract between the read-only validators on disk
// (scripts/validate-*.mjs) and the hand-maintained READ_ONLY_VALIDATORS list
// in tests/validators-smoke.test.mjs.
//
// That list is load-bearing well beyond the unit suite. The only
// pull_request-triggered workflow, .github/workflows/ci.yml, runs
// `npm run test:unit` and `npm run build:production` — it never invokes
// `npm run validate:*` directly. The four data validators reach the PR gate
// solely because validators-smoke.test.mjs executes them against the real
// repository data. A validator that is added to scripts/ but forgotten in
// that array therefore never runs on any pull request; its first failure
// surfaces post-merge, on the push-to-main deploy, where it blocks the
// deployment of an already-merged change.
//
// Nothing else in the suite models that relationship: the array is a literal
// list of strings, so adding scripts/validate-foo.mjs leaves every existing
// test green.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptsDir = join(repoRoot, 'scripts');
const smokeTestPath = join(repoRoot, 'tests', 'validators-smoke.test.mjs');

const smokeSource = readFileSync(smokeTestPath, 'utf8');

// Reads the READ_ONLY_VALIDATORS array literal out of the smoke test. Parsing
// the source keeps this check honest: importing the module would execute the
// validators a second time and would not expose the list.
function smokeListedValidators() {
  const match = smokeSource.match(
    /READ_ONLY_VALIDATORS\s*=\s*\[([\s\S]*?)\]\s*;/,
  );
  assert.ok(
    match,
    'could not locate the READ_ONLY_VALIDATORS array in tests/validators-smoke.test.mjs',
  );
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(([, name]) => name);
}

// Validators are read-only unless they clone a repository, call a network API
// or write into the working tree. The smoke test deliberately excludes such
// scripts, so the exclusion has to be detectable from the source rather than
// hard-coded here, or this test would go stale the moment one changes.
function isReadOnly(scriptName) {
  const source = readFileSync(join(scriptsDir, scriptName), 'utf8');
  return !/\b(?:fetch|writeFileSync|mkdirSync|rmSync|cpSync|execFileSync|spawnSync)\s*\(/.test(
    source,
  );
}

const validatorScripts = readdirSync(scriptsDir)
  .filter((name) => /^validate-.*\.mjs$/.test(name))
  .sort();

test('the repository still ships read-only validate-*.mjs scripts', () => {
  assert.ok(
    validatorScripts.length > 0,
    'no scripts/validate-*.mjs found; this guard would pass vacuously',
  );
});

test('every read-only validator is listed in READ_ONLY_VALIDATORS', () => {
  const listed = new Set(smokeListedValidators());
  const unguarded = validatorScripts
    .filter((name) => isReadOnly(name))
    .filter((name) => !listed.has(name));
  assert.deepEqual(
    unguarded,
    [],
    'validators that never run on a pull request: add them to READ_ONLY_VALIDATORS in tests/validators-smoke.test.mjs',
  );
});

test('every entry in READ_ONLY_VALIDATORS exists on disk', () => {
  const missing = smokeListedValidators().filter(
    (name) => !existsSync(join(scriptsDir, name)),
  );
  assert.deepEqual(
    missing,
    [],
    'READ_ONLY_VALIDATORS names scripts that are not in scripts/',
  );
});

test('READ_ONLY_VALIDATORS lists each validator exactly once', () => {
  const listed = smokeListedValidators();
  const duplicates = listed.filter(
    (name, index) => listed.indexOf(name) !== index,
  );
  assert.deepEqual(duplicates, [], 'duplicate entries in READ_ONLY_VALIDATORS');
});
