// `main()` in tests/tools/coverage-report.mjs is the CLI that CI runs, but
// three of its paths had never been executed under coverage.
//
// tests/coverage-report.test.mjs drives the reporter as a subprocess with
// NODE_V8_COVERAGE deleted, so nothing that process does is recorded: the
// `--check` gates it exercises are pinned by their exit codes alone. The
// paths below carry no exit code of their own to assert on, so they need the
// reporter's own execution recorded. Keeping NODE_V8_COVERAGE in the child
// environment does that -- the reporter always overrides the variable for the
// `node --test` run it spawns, so its grandchild still writes to its own
// directory and the counts merged here only ever come from the reporter.
//
// The three paths:
//
//   - a bare `node --test` argument given without a `--` separator, which
//     parseArgs must pass through rather than treat as a flag
//   - the "Not reported" notice, the only signal that a file's coverage was
//     recorded against loader-generated text and is therefore missing from
//     the table above it
//   - the non-zero exit when the spawned suite fails, which must still print
//     the table and must propagate the suite's own status
//
// The merge and record-skip paths inside collect() are covered separately by
// tests/coverage-report-collect.test.mjs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORTER = fileURLToPath(
  new URL('./tools/coverage-report.mjs', import.meta.url),
);
// Absolute, because the one suite below is generated into a temporary
// directory from which no relative path reaches the repository.
const VALIDATE_UTILS = new URL(
  '../scripts/lib/validate-utils.mjs',
  import.meta.url,
).href;

// Unlike tests/coverage-report.test.mjs, NODE_V8_COVERAGE is left in place so
// the reporter's own run is recorded. NODE_TEST_CONTEXT still has to go: the
// `node --test` the reporter spawns refuses to run inside another runner.
function runReporter(args) {
  const env = { ...process.env, TZ: 'UTC' };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [REPORTER, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
  });
}

test('a test path given without a -- separator is passed to node --test', () => {
  const result = runReporter(['tests/validate-utils.test.mjs']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /scripts\/lib\/validate-utils\.mjs/);
  // The path reached the runner rather than being read as a flag, so exactly
  // that one suite ran: no other test file appears in the table.
  const listed = result.stdout.match(/^tests\/\S+\.test\.mjs/gm) ?? [];
  assert.deepEqual(listed, ['tests/validate-utils.test.mjs']);
});

test('files recorded against loader-generated text are named under the table', () => {
  // This suite imports data/awards.json as a module, so V8 records the JSON
  // module wrapper rather than the file on disk and the record is unmappable.
  const result = runReporter(['--', 'tests/awards-timeline.test.mjs']);
  assert.equal(result.status, 0, result.stderr);

  const notice = result.stdout.match(/\nNot reported \((\d+)\):([\s\S]*)$/);
  assert.ok(notice, `no "Not reported" notice in:\n${result.stdout}`);
  assert.match(notice[2], /offsets do not address the\nsource on disk\./);

  const named = notice[2].match(/^ {2}\S+$/gm) ?? [];
  assert.equal(
    named.length,
    Number(notice[1]),
    'the count in the notice must match the files it lists',
  );
  assert.ok(
    named.includes('  data/awards.json'),
    `data/awards.json missing from:\n${notice[2]}`,
  );
});

test('a failing suite still prints the table and fails the reporter', () => {
  // The failing suite lives outside the repository so it cannot be picked up
  // by a normal `node --test` run, and so its own coverage is never mapped
  // onto a source path. The passing suite alongside it is what makes the run
  // produce coverage at all, which keeps this on the "tests failed" exit
  // rather than the earlier "no coverage data" one.
  const dir = mkdtempSync(join(tmpdir(), 'endusers-reporter-cli-'));
  const failing = join(dir, 'failing.test.mjs');
  writeFileSync(
    failing,
    [
      "import test from 'node:test';",
      "test('fails on purpose', () => {",
      "  throw new Error('deliberate failure');",
      '});',
      '',
    ].join('\n'),
  );
  try {
    const result = runReporter([
      '--check',
      '100',
      '--',
      'tests/validate-utils.test.mjs',
      failing,
    ]);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Tests failed; coverage above is reported for context\./,
    );
    // Reported for context means the table is still there to read.
    assert.match(
      result.stdout,
      /^all files\s+\|\s+100\.00 \|\s+100\.00 \| \d+\/\d+ lines \| \d+\/\d+ regions$/m,
    );
    // The suite failure takes precedence: --check passed at 100% here, so the
    // exit code cannot have come from the gate.
    assert.doesNotMatch(result.stderr, /is below the required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a suite killed by a signal fails the reporter rather than passing it', () => {
  // `spawnSync` reports a child terminated by a signal as `status: null`, not
  // as a number, and `process.exit(null)` exits 0. Without the `?? 1` fallback
  // the reporter would therefore announce "Tests failed" and then report
  // success, so a run the OOM killer or a CI timeout cut short would satisfy
  // the coverage gate on no evidence at all.
  //
  // The suite kills `node --test` itself, not its own process: `process.ppid`
  // inside a test file is the runner the reporter spawned, one level below the
  // reporter. SIGKILL rather than SIGTERM because the runner handles SIGTERM
  // and exits 1, which is the numeric path the test above already covers.
  const dir = mkdtempSync(join(tmpdir(), 'endusers-reporter-signal-'));
  const killer = join(dir, 'killer.test.mjs');
  writeFileSync(
    killer,
    [
      "import test from 'node:test';",
      "import { takeCoverage } from 'node:v8';",
      `import { collectError } from ${JSON.stringify(VALIDATE_UTILS)};`,
      "test('kills the runner', async () => {",
      // Exercised so the run records coverage for a repository file: with an
      // empty profile the reporter stops at "No coverage data was recorded."
      // and never reaches the exit path under test.
      "  collectError([], 'x', 'error', 'recorded so the run is not empty');",
      // The runner dies without flushing, and the orphan is killed with it, so
      // this process has to write its own profile before pulling the trigger.
      '  takeCoverage();',
      "  process.kill(process.ppid, 'SIGKILL');",
      '  await new Promise((resolve) => setTimeout(resolve, 1000));',
      '});',
      '',
    ].join('\n'),
  );
  try {
    const result = runReporter(['--', killer]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /Tests failed; coverage above is reported for context\./,
    );
    // The earlier no-coverage exit is also 1, so the status alone would not
    // show which path ran.
    assert.doesNotMatch(result.stderr, /No coverage data was recorded\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
