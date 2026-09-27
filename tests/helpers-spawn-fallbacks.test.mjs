import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';
import { runScriptWithFetchMock } from './helpers-fetch-mock.mjs';
import { runWithGhStub } from './helpers-gh-sandbox.mjs';

// Every sandbox helper normalises the spawnSync result before handing it to a
// test: `status ?? 1`, `stdout ?? ''`, `stderr ?? ''`. Those fallbacks only
// run when the child never started, because spawnSync reports a failed spawn
// as `status: null` with `stdout`/`stderr` undefined rather than throwing.
// Until now nothing reached them, so the contract they define — a harness
// failure surfaces as a plain non-zero run with empty output, not as a crash
// or as `null` leaking into an assertion — was never checked. A regression
// there would turn "the script under test failed" into "the harness could not
// run it" without any suite noticing the difference.
//
// The spawn is broken by removing PATH from this process's environment, which
// makes the bare `node` lookup every helper performs fail with ENOENT. PATH is
// restored immediately afterwards; `node --test` runs the tests within a file
// sequentially, so no sibling test observes the gap.
function withoutPath(run) {
  const saved = process.env.PATH;
  assert.equal(
    typeof saved,
    'string',
    'this check removes PATH and restores it, so it requires PATH to be set',
  );
  delete process.env.PATH;
  try {
    return run();
  } finally {
    process.env.PATH = saved;
  }
}

test('runScriptWithFixtures reports an unwritten readBack path as null', () => {
  // The documented contract of `readBack`: a path the script deleted or never
  // wrote comes back as null, which is how write-mode tests tell "no output"
  // apart from "empty output".
  const result = runScriptWithFixtures(
    'validate-awards.mjs',
    {
      'data/awards.json': JSON.stringify({
        verifiedAt: '2026-08-08',
        awards: [],
      }),
    },
    { readBack: ['data/never-written.json', 'data/awards.json'] },
  );

  assert.equal(result.files['data/never-written.json'], null);
  assert.equal(
    typeof result.files['data/awards.json'],
    'string',
    'a fixture that exists must be read back as its contents, not as null',
  );
});

test('runScriptWithFixtures degrades to status 1 and empty output when the child cannot spawn', () => {
  const result = withoutPath(() =>
    runScriptWithFixtures('validate-awards.mjs', {
      'data/awards.json': JSON.stringify({
        verifiedAt: '2026-08-08',
        awards: [],
      }),
    }),
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.deepEqual(result.files, {});
});

test('runScriptWithFetchMock degrades to status 1 and empty output when the child cannot spawn', () => {
  const result = withoutPath(() =>
    runScriptWithFetchMock({
      script: 'validate-awards.mjs',
      fixtures: {
        'data/awards.json': JSON.stringify({
          verifiedAt: '2026-08-08',
          awards: [],
        }),
      },
      outputs: ['data/awards.json'],
    }),
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  // Outputs are still read back from the sandbox, so a spawn failure is
  // distinguishable from a run that produced nothing.
  assert.equal(typeof result.outputs['data/awards.json'], 'string');
});

test('runWithGhStub prepends its stub directory even when PATH is unset, and degrades to status 1', () => {
  // With PATH absent the helper builds `<stub dir>:` from its `?? ''`
  // fallback rather than interpolating "undefined" into the child's PATH —
  // the stub directory stays first, and the empty tail finds no real `gh`.
  const result = withoutPath(() =>
    runWithGhStub({
      script: 'pr-queue-hygiene.mjs',
      routes: [{ match: 'pr list', stdout: '[]' }],
    }),
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.deepEqual(
    result.calls,
    [],
    'a child that never started cannot have invoked gh',
  );
});
