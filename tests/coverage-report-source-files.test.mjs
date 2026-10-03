// The unit coverage gates are ratios, and a ratio cannot see a file that was
// never weighed.
//
// `npm run test:unit:coverage:check` gates on --check, --check-regions,
// --check-source and --check-source-regions. All four are computed from the
// rows tests/tools/coverage-report.mjs built out of the V8 records the run
// produced, so a module under scripts/ or src/ that no test ever imports is
// not a row at all: its lines are missing from the numerator and the
// denominator together. Adding a brand-new source file with an untaken branch
// therefore left `src files | 100.00 | 8351/8351 lines | 2395/2395 regions`
// character-for-character unchanged and the gate exiting 0.
//
// The only whole-set guard the reporter had was the total-wipeout case
// (`--check-source was requested, but no source lines outside tests/ were
// recorded`), which fires when *everything* vanishes, never when one file
// does.
//
// --require-source-files compares the files on disk against the files the run
// measured. These tests pin the three things that makes it worth having:
// what counts as a source file on disk, what counts as "measured", and that
// the gate actually fails a run the percentage gates pass.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  missingSourceFiles,
} from './tools/coverage-report.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORTER = fileURLToPath(
  new URL('./tools/coverage-report.mjs', import.meta.url),
);

function fixtureRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'endusers-source-files-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

// Mirrors tests/coverage-report-cli.test.mjs: NODE_V8_COVERAGE is left in the
// child so the reporter's own execution is recorded (it overrides the
// variable for the `node --test` it spawns, so the grandchild writes
// elsewhere), and NODE_TEST_CONTEXT is removed because `node --test` refuses
// to run inside another runner.
function runReporter(args) {
  const env = { ...process.env, TZ: 'UTC' };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [REPORTER, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
  });
}

test('enumerateSourceFiles walks scripts/ and src/ for modules only', () => {
  const root = fixtureRoot({
    'scripts/one.mjs': '',
    'scripts/lib/two.js': '',
    'scripts/lib/nested/three.cjs': '',
    'src/components/Four/index.jsx': '',
    // Not modules: the reporter cannot hold a coverage record for them.
    'src/css/custom.css': '',
    'src/pages/about.md': '',
    // Outside the enumerated trees.
    'tests/five.test.mjs': '',
    'docusaurus.config.js': '',
  });
  try {
    assert.deepEqual(enumerateSourceFiles(root), [
      'scripts/lib/nested/three.cjs',
      'scripts/lib/two.js',
      'scripts/one.mjs',
      'src/components/Four/index.jsx',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('enumerateSourceFiles skips symlinks and a missing root', () => {
  // A symlinked module would be enumerated under a second path that no
  // coverage record can ever name, so the gate would fail permanently on a
  // file that is in fact fully covered under its real path.
  const root = fixtureRoot({ 'src/real.mjs': '' });
  symlinkSync(join(root, 'src', 'real.mjs'), join(root, 'src', 'alias.mjs'));
  try {
    // scripts/ does not exist in this fixture at all.
    assert.deepEqual(enumerateSourceFiles(root), ['src/real.mjs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missingSourceFiles reports only files nothing recorded', () => {
  const root = fixtureRoot({
    'src/covered.mjs': '',
    'src/unmappable.js': '',
    'src/forgotten.mjs': '',
  });
  try {
    // 'src/unmappable.js' stands for a JSX component the reporter withheld:
    // it was executed, the offsets just could not be attributed. Counting it
    // as missing would make every such component a permanent failure of a
    // check that is about files nothing ran at all.
    assert.deepEqual(
      missingSourceFiles(['src/covered.mjs', 'src/unmappable.js'], root),
      ['src/forgotten.mjs'],
    );
    assert.deepEqual(missingSourceFiles([], root), [
      'src/covered.mjs',
      'src/forgotten.mjs',
      'src/unmappable.js',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--require-source-files fails a run the percentage gates pass', () => {
  // One real test file, so the suite passes and produces coverage, but almost
  // nothing under scripts/ or src/ is loaded. Without the flag the source
  // gates are satisfied by the handful of files that were: that is the blind
  // spot, asserted here rather than described.
  const narrow = [
    '--check-source',
    '100',
    '--',
    'tests/validate-utils.test.mjs',
  ];

  const ungated = runReporter(narrow);
  assert.equal(ungated.status, 0, ungated.stderr);
  assert.doesNotMatch(ungated.stdout, /Never measured/);

  const gated = runReporter(['--require-source-files', ...narrow]);
  assert.equal(gated.status, 1);
  assert.match(gated.stderr, /--require-source-files requires every file/);

  const notice = gated.stdout.match(/\nNever measured \((\d+)\):([\s\S]*)$/);
  assert.ok(notice, `no "Never measured" notice in:\n${gated.stdout}`);
  // The block runs from the header to the first line that is not an indented
  // path, so it is read the same way whether or not a "Not reported" notice
  // follows it.
  const named = [];
  for (const line of notice[2].split('\n')) {
    if (/^ {2}\S+$/.test(line)) named.push(line);
    else if (named.length > 0) break;
  }
  assert.equal(
    named.length,
    Number(notice[1]),
    'the count in the notice must match the files it lists',
  );
  // scripts/lib/validate-utils.mjs is the one module that suite exercises, so
  // it is the control: everything else is listed and it is not.
  assert.ok(
    !named.includes('  scripts/lib/validate-utils.mjs'),
    `a measured file was reported as missing:\n${named.join('\n')}`,
  );
  assert.ok(
    named.includes('  src/components/MemberDirectory/utils.js'),
    `an unmeasured file was not reported:\n${named.join('\n')}`,
  );
});
