// The reporter's idea of "harness" used to stop at `tests/tools/`.
// `SOURCE_ROOTS` is a list of trees, so the shared helper modules that sit
// directly in `tests/` -- the script and gh sandboxes, the fetch mock, the JSX
// driver, the JSONC reader -- could not be named by it, and two things
// followed from that.
//
// `--require-source-files` never enumerated them, and a file with no coverage
// record is *absent* from the report rather than 0%: a helper nothing imports
// was invisible, which is the exact failure that flag exists to name one level
// up. And no floor scored them, because `isSourceFile()` drops everything
// under `tests/` while `isHarnessFile()` matched `tests/tools/` alone, leaving
// only `--check-regions`, an all-files aggregate the 100+ `*.test.mjs` files
// dominate.
//
// `isHarnessModule()` is the file-level companion to `SOURCE_ROOTS`. These
// tests pin what it matches, that the two call sites agree with it, that it
// does not swallow the suite's own test files, and that neither the predicate
// nor the enumeration passes vacuously over this repository.

import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  enumerateSourceFiles,
  isHarnessFile,
  isHarnessModule,
  isSourceFile,
  missingSourceFiles,
} from './tools/coverage-report.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function fixtureRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'endusers-harness-modules-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

test('isHarnessModule matches the shared helpers and nothing else', () => {
  for (const file of [
    'tests/helpers.mjs',
    'tests/helpers-script-sandbox.mjs',
    'tests/helpers-import-issue-sandbox.mjs',
    'tests/helpers-jsonc.mjs',
  ]) {
    assert.equal(isHarnessModule(file), true, file);
  }

  for (const file of [
    // The suite's own tests are what the harness is measured against, not
    // part of it -- including the ones named after the helper they cover.
    'tests/helpers.test.mjs',
    'tests/helpers-script-sandbox-fallbacks.test.mjs',
    // A tree, not a file: HARNESS_ROOTS already names it.
    'tests/tools/coverage-report.mjs',
    // Not a helper at all.
    'tests/validate-members.test.mjs',
    'tests/helpers/nested.mjs',
    // Shipped code, which belongs in the `src files` ratios instead.
    'src/lib/profile-links.mjs',
    'scripts/helpers.mjs',
  ]) {
    assert.equal(isHarnessModule(file), false, file);
  }
});

test('a helper module is harness but never source', () => {
  // The two predicates have to disagree for the row to exist at all: a file
  // the harness floors score must stay out of the `src files` ratios, or a
  // harness gap could be paid for out of src/'s slack.
  assert.equal(isHarnessFile('tests/helpers-fetch-mock.mjs'), true);
  assert.equal(isSourceFile('tests/helpers-fetch-mock.mjs'), false);

  // The tests/tools/ arm is untouched by the addition.
  assert.equal(isHarnessFile('tests/tools/coverage-report.mjs'), true);
  // And the suite's own test files still enter neither.
  assert.equal(isHarnessFile('tests/helpers.test.mjs'), false);
  assert.equal(isSourceFile('tests/helpers.test.mjs'), false);
});

test('enumerateSourceFiles lists the helper modules beside the walked trees', () => {
  const root = fixtureRoot({
    'scripts/one.mjs': '',
    'tests/tools/two.mjs': '',
    'tests/helpers.mjs': '',
    'tests/helpers-script-sandbox.mjs': '',
    // Excluded: the suite itself, a nested path HARNESS_FILE does not reach,
    // and a non-module the reporter can hold no record for.
    'tests/helpers-script-sandbox-fallbacks.test.mjs': '',
    'tests/nested/helpers-deep.mjs': '',
    'tests/helpers-notes.md': '',
  });
  try {
    assert.deepEqual(enumerateSourceFiles(root), [
      'scripts/one.mjs',
      'tests/helpers-script-sandbox.mjs',
      'tests/helpers.mjs',
      'tests/tools/two.mjs',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('enumerateSourceFiles skips a symlinked helper and survives a missing tests/', () => {
  // A symlinked helper would be enumerated under a second path no coverage
  // record can ever name, so --require-source-files would fail permanently on
  // a module that is fully measured under its real name.
  const linked = fixtureRoot({ 'tests/helpers.mjs': '' });
  try {
    symlinkSync(
      join(linked, 'tests', 'helpers.mjs'),
      join(linked, 'tests', 'helpers-alias.mjs'),
    );
    assert.deepEqual(enumerateSourceFiles(linked), ['tests/helpers.mjs']);
  } finally {
    rmSync(linked, { recursive: true, force: true });
  }

  // A root with no tests/ at all is an absence, not a throw: the caller is
  // asking what should have been measured, and a repository that has dropped
  // the directory has nothing to answer with.
  const bare = fixtureRoot({ 'scripts/one.mjs': '' });
  try {
    assert.deepEqual(enumerateSourceFiles(bare), ['scripts/one.mjs']);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

test('an unimported helper is a missing source file rather than an absence', () => {
  const root = fixtureRoot({
    'tests/helpers.mjs': '',
    'tests/helpers-unused.mjs': '',
  });
  try {
    assert.deepEqual(missingSourceFiles(['tests/helpers.mjs'], root), [
      'tests/helpers-unused.mjs',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the helper enumeration is not vacuous in this repository', () => {
  // A predicate that matched nothing here would leave the floors scoring an
  // empty set while every assertion above still passed against fixtures.
  const helpers = enumerateSourceFiles(REPO_ROOT).filter(isHarnessModule);
  assert.ok(
    helpers.length > 5,
    `expected the shared tests/helpers*.mjs modules to be enumerated, got: ${helpers.join(', ')}`,
  );
  assert.ok(helpers.includes('tests/helpers-script-sandbox.mjs'));
  assert.ok(
    helpers.every((file) => !file.endsWith('.test.mjs')),
    `the suite's own test files must not be enumerated as harness: ${helpers.join(', ')}`,
  );
});
