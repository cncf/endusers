import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImportArchitectureIssue } from './helpers-import-issue-sandbox.mjs';

// Companion to tests/helpers-spawn-fallbacks.test.mjs, which pins the
// spawn-failure contract for runScriptWithFixtures, runScriptWithFetchMock and
// runWithGhStub. The issue-importer sandbox normalises its spawnSync result
// the same way -- `status ?? 1`, `stdout ?? ''`, `stderr ?? ''` -- and nothing
// else reaches those fallbacks, because spawnSync reports a failed spawn as
// `status: null` with `stdout`/`stderr` undefined rather than throwing. The
// contract is that a harness failure surfaces as a plain non-zero run with
// empty output, not as a crash and not as `null` leaking into an assertion.
// This helper backs the import-architecture-issue suite, so a regression here
// would turn "the importer failed" into "the harness could not start it" with
// no test able to tell the difference.
//
// The established `withoutPath` trick does not work here: the helper spawns
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
