import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImportArchitectures } from './helpers-import-sandbox.mjs';
import { runImportArchitectureIssue } from './helpers-import-issue-sandbox.mjs';

// Companion to tests/helpers-spawn-fallbacks.test.mjs, which pins the
// spawn-failure contract for runScriptWithFixtures, runScriptWithFetchMock and
// runWithGhStub. The two importer sandboxes normalise their spawnSync result
// the same way -- `status ?? 1`, `stdout ?? ''`, `stderr ?? ''` -- and nothing
// reached those fallbacks, because spawnSync reports a failed spawn as
// `status: null` with `stdout`/`stderr` undefined rather than throwing. The
// contract they define is that a harness failure surfaces as a plain non-zero
// run with empty output, not as a crash and not as `null` leaking into an
// assertion. These two helpers back the four import-architecture* suites, so a
// regression there would turn "the importer failed" into "the harness could not
// start it" with no suite able to tell the difference.
//
// The established `withoutPath` trick does not work here: both helpers spawn
// `process.execPath`, an absolute path, so emptying PATH cannot stop the child
// from starting. `process.execPath` is a writable property, so pointing it at a
// path that does not exist is the equivalent lever, and it is restored in a
// `finally`. `node --test` runs the tests within a file sequentially, so no
// sibling test observes the gap.
function withUnspawnableNode(run) {
  const saved = process.execPath;
  assert.equal(
    typeof saved,
    'string',
    'this check replaces process.execPath and restores it, so it requires one',
  );
  process.execPath = join(tmpdir(), 'endusers-no-such-node');
  try {
    return run();
  } finally {
    process.execPath = saved;
  }
}

// runImportArchitectures throws before it can return a `cleanup()` handle when
// a fixture FIFO cannot be created, so the temp directory it had already made
// would leak. Both helpers place their sandbox with `mkdtempSync(join(tmpdir(),
// ...))` and `os.tmpdir()` re-reads TMPDIR on every call, so redirecting TMPDIR
// at a directory this test owns makes the orphan collectable.
function setTmpdir(value) {
  if (value === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = value;
}

function withDisposableTmpdir(run) {
  const saved = process.env.TMPDIR;
  const root = mkdtempSync(join(tmpdir(), 'endusers-fallbacks-'));
  process.env.TMPDIR = root;
  try {
    return run();
  } finally {
    setTmpdir(saved);
    rmSync(root, { recursive: true, force: true });
  }
}

const ACME = {
  'content/en/architectures/acme/index.md': `---
title: Acme
---

Acme runs a platform.
`,
};

test('runImportArchitectures degrades to status 1 and empty output when the child cannot spawn', () => {
  const run = withUnspawnableNode(() =>
    runImportArchitectures({ upstream: ACME }),
  );

  try {
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.equal(run.stderr, '');
    // The sandbox readers still work, so a harness fault stays distinguishable
    // from an importer that ran and wrote nothing: the fixture the helper
    // staged before the spawn is readable, and a path only the importer would
    // have written is absent.
    assert.equal(run.exists('scripts/import-architectures.mjs'), true);
    assert.equal(run.exists('data/architectures/records/acme.json'), false);
  } finally {
    run.cleanup();
  }
});

test('runImportArchitectureIssue degrades to status 1 and empty output when the child cannot spawn', () => {
  const run = withUnspawnableNode(() =>
    runImportArchitectureIssue({
      issue: { number: 7, title: 'Acme', body: 'Acme runs a platform.' },
    }),
  );

  try {
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.equal(run.stderr, '');
    // `issuePath` is staged by the helper itself, so it survives a spawn that
    // never happened; the catalog the importer would have written does not.
    assert.equal(run.exists('issue.json'), true);
    assert.equal(run.exists('data/architectures/catalog.json'), false);
  } finally {
    run.cleanup();
  }
});

test('runImportArchitectures fails loudly when a fixture FIFO cannot be created', () => {
  // The helper shells out to mkfifo because Node has no binding for it, and
  // treats a non-zero exit as a broken fixture rather than a skip -- a silent
  // skip would let "a special file in images/ is dropped by the walk" pass
  // against a tree that never contained a special file. mkfifo refuses a path
  // that already exists, which is the collision a caller is most likely to
  // make, so the fixture file below doubles as the trigger.
  const collision = 'content/en/architectures/acme/index.md';

  assert.throws(
    () =>
      withDisposableTmpdir(() =>
        runImportArchitectures({
          upstream: ACME,
          upstreamFifos: [collision],
        }),
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /could not create FIFO/);
      // The failing path is named, and mkfifo's own stderr is carried through
      // rather than discarded -- without it the message cannot say why.
      assert.ok(error.message.includes(collision));
      assert.match(error.message, /mkfifo/);
      return true;
    },
  );
});

test('the FIFO check collects the sandbox the throw orphaned', () => {
  // Guards the cleanup above: if TMPDIR were not restored, every later test in
  // this process would build its sandbox inside a deleted directory, and if the
  // root were not removed the orphaned sandbox would survive the run. Both
  // restore paths are checked, because an absent TMPDIR has to come back absent
  // rather than as the string "undefined", which os.tmpdir() would then treat
  // as a relative directory name.
  const outer = process.env.TMPDIR;
  try {
    for (const start of [join(tmpdir(), 'endusers-outer-tmpdir'), undefined]) {
      if (start !== undefined) mkdirSync(start, { recursive: true });
      setTmpdir(start);

      let root;
      withDisposableTmpdir(() => {
        root = tmpdir();
        mkdirSync(join(root, 'sentinel'));
      });

      assert.equal(process.env.TMPDIR, start);
      assert.equal(existsSync(root), false);
      if (start !== undefined) rmSync(start, { recursive: true, force: true });
    }
  } finally {
    setTmpdir(outer);
  }
});
