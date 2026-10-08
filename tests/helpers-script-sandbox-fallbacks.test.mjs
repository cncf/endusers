import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptInSandbox } from './helpers-script-sandbox.mjs';

// tests/helpers-spawn-fallbacks.test.mjs pins the same contract for the three
// other sandbox helpers (helpers.mjs, helpers-fetch-mock.mjs,
// helpers-gh-sandbox.mjs). runScriptInSandbox was left out, so its own
// normalisation — `status ?? 1`, `stdout ?? ''`, `stderr ?? ''`, the
// `process.env.PATH ?? ''` tail it builds the child's PATH from, and
// realGitPath's `|| '/usr/bin/git'` — was never executed by any test. Those
// five fallbacks are the whole difference between "the script under test
// failed" and "the harness could not start it", and a regression in them would
// leak `null` into every collect-*.test.mjs assertion instead.
//
// spawnSync reports a failed spawn as `status: null` with `stdout`/`stderr`
// undefined rather than throwing, so removing PATH from this process is enough
// to reach all of them at once: the helper's bare `node` lookup finds nothing.
// PATH is restored immediately afterwards, and `node --test` runs the tests
// within a file sequentially, so no sibling test observes the gap.
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

// Deleting PATH is not enough to reach realGitPath's `|| '/usr/bin/git'`:
// `command -v git` runs under `/bin/sh`, and a shell with no PATH in its
// environment falls back to a confstr default that still finds git. An empty
// PATH is honoured as an empty search path, so the lookup fails and the helper
// takes its documented last resort. The bare `node` spawn fails the same way
// either case.
function withEmptyPath(run) {
  const saved = process.env.PATH;
  process.env.PATH = '';
  try {
    return run();
  } finally {
    process.env.PATH = saved;
  }
}

const AWARDS_FIXTURE = JSON.stringify({
  verifiedAt: '2026-08-08',
  verifiedAgainst: 'https://contribute.cncf.io/community/awards/',
  awards: [
    {
      year: 2024,
      slug: 'acme',
      award: 'Top End User Award',
      awardLabel: 'Winner',
      organization: 'Acme Corp',
      citation: 'For outstanding adoption of cloud native.',
      event: 'KubeCon NA 2024',
      announcementUrl: 'https://www.cncf.io/announcements/2024/example',
    },
  ],
});

test('runScriptInSandbox degrades to status 1 and empty output when the child cannot spawn', () => {
  const result = withoutPath(() =>
    runScriptInSandbox({
      script: 'validate-awards.mjs',
      fixtures: { 'data/awards.json': AWARDS_FIXTURE },
    }),
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.deepEqual(
    result.requests,
    [],
    'a child that never started cannot have issued a fetch',
  );
});

test('runScriptInSandbox still reads outputs back after a failed spawn', () => {
  // Outputs are collected from the sandbox directory rather than from the
  // child, so a fixture written before the spawn is still readable and a path
  // nothing wrote is still null. That is what keeps "the harness could not run
  // it" distinguishable from "the script produced nothing".
  const result = withoutPath(() =>
    runScriptInSandbox({
      script: 'validate-awards.mjs',
      fixtures: { 'data/awards.json': AWARDS_FIXTURE },
      outputs: ['data/awards.json', 'data/never-written.json'],
    }),
  );

  assert.equal(result.status, 1);
  assert.equal(result.outputs['data/awards.json'], AWARDS_FIXTURE);
  assert.equal(result.outputs['data/never-written.json'], null);
});

test('runScriptInSandbox reports an unproduced output as null on a normal run', () => {
  // The same null contract on the path tests actually use: the child ran and
  // exited, and a declared output it never wrote is null, not ''.
  const result = runScriptInSandbox({
    script: 'validate-awards.mjs',
    fixtures: { 'data/awards.json': AWARDS_FIXTURE },
    outputs: ['data/awards.json', 'data/never-written.json'],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs['data/never-written.json'], null);
  assert.equal(
    typeof result.outputs['data/awards.json'],
    'string',
    'an output that exists must be read back as its contents, not as null',
  );
});

test('runScriptInSandbox falls back to /usr/bin/git when no git is on PATH', () => {
  // realGitPath resolves the real binary before the git shim is prepended to
  // PATH, so the shim delegates instead of recursing into itself. With nothing
  // resolvable it must still hand the child a concrete path rather than an
  // empty ENDUSERS_REAL_GIT, which the shim would expand to a bare `exec ""`.
  const result = withEmptyPath(() =>
    runScriptInSandbox({
      script: 'validate-awards.mjs',
      fixtures: { 'data/awards.json': AWARDS_FIXTURE },
      outputs: ['data/awards.json'],
    }),
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.equal(result.outputs['data/awards.json'], AWARDS_FIXTURE);
});
