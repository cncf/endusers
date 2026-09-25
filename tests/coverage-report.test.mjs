// tests/tools/coverage-report.mjs produces the only trustworthy coverage
// number this repository has. `node --test --experimental-test-coverage`
// discards every sandboxed script run -- helpers.mjs copies a script out of
// scripts/ into a temp directory so it reads fixture data through its own
// import.meta.url, and V8 records that execution under a
// file:///tmp/<sandbox>/scripts/<name> URL outside the project directory.
// The reporter rewrites those URLs back onto the real source tree and merges
// the runs, so a silent regression in that rewrite does not fail anything: it
// just makes the reported percentage wrong in whichever direction the bug
// happens to point.
//
// Nothing exercised this file before. Its three exports exist purely so the
// mapping, the V8 range arithmetic and the line-classification rules can be
// pinned, and the `--check` gate -- the part that is supposed to turn the
// number into a CI failure -- had never been run at all.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  countsForScript,
  summarizeLines,
  toRepoRelativePath,
} from './tools/coverage-report.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORTER = fileURLToPath(
  new URL('./tools/coverage-report.mjs', import.meta.url),
);

const ROOT = '/repo/';

function ranges(...triples) {
  return {
    functions: [
      {
        ranges: triples.map(([startOffset, endOffset, count]) => ({
          startOffset,
          endOffset,
          count,
        })),
      },
    ],
  };
}

test('toRepoRelativePath maps a file inside the repository to a repo-relative path', () => {
  assert.equal(
    toRepoRelativePath(
      `${pathToFileURL(REPO_ROOT).href}scripts/lib/github.mjs`,
    ),
    'scripts/lib/github.mjs',
  );
});

test('toRepoRelativePath rejects a URL that is not a file: URL', () => {
  assert.equal(toRepoRelativePath('https://example.com/scripts/x.mjs'), null);
  assert.equal(toRepoRelativePath('data:text/javascript,0'), null);
});

test('toRepoRelativePath rejects a file: URL that does not convert to a path', () => {
  // A non-localhost host makes fileURLToPath throw rather than return; the
  // reporter must skip the entry instead of aborting the whole report.
  assert.equal(toRepoRelativePath('file://nothost/scripts/x.mjs'), null);
});

test('toRepoRelativePath rejects dependencies even when they sit inside the repo', () => {
  assert.equal(
    toRepoRelativePath(
      `${pathToFileURL(REPO_ROOT).href}node_modules/react/index.js`,
    ),
    null,
  );
});

test('toRepoRelativePath folds a sandbox copy back onto the real source tree', () => {
  // This is the case the whole reporter exists for: the same script executed
  // from a temp directory must be attributed to scripts/, not discarded.
  assert.equal(
    toRepoRelativePath(
      'file:///tmp/endusers-fixture-a1b2/scripts/validate-metrics.mjs',
      ROOT,
    ),
    'scripts/validate-metrics.mjs',
  );
  assert.equal(
    toRepoRelativePath(
      'file:///tmp/endusers-fixture-a1b2/src/components/MemberDirectory/index.js',
      ROOT,
    ),
    'src/components/MemberDirectory/index.js',
  );
  assert.equal(
    toRepoRelativePath('file:///tmp/sandbox-9/tests/helpers.mjs', ROOT),
    'tests/helpers.mjs',
  );
});

test('toRepoRelativePath folds onto the deepest mirrored directory, not the first', () => {
  // A sandbox rooted under a directory that happens to be called "scripts"
  // must still resolve against the mirrored copy nearest the file.
  assert.equal(
    toRepoRelativePath(
      'file:///tmp/scripts/sandbox/scripts/validate-awards.mjs',
      ROOT,
    ),
    'scripts/validate-awards.mjs',
  );
});

test('toRepoRelativePath rejects a path outside the repo with no mirrored directory', () => {
  assert.equal(
    toRepoRelativePath('file:///tmp/sandbox-9/other/x.mjs', ROOT),
    null,
  );
  assert.equal(toRepoRelativePath('file:///etc/passwd', ROOT), null);
});

test('toRepoRelativePath does not mistake a directory name for the file itself', () => {
  // The scan starts one segment in from the end, so a file literally named
  // "scripts" is not treated as the mirrored directory.
  assert.equal(toRepoRelativePath('file:///tmp/sandbox-9/scripts', ROOT), null);
});

test('countsForScript marks offsets outside every range as non-executable', () => {
  const counts = countsForScript(ranges([2, 5, 1]), 8);
  assert.deepEqual([...counts], [-1, -1, 1, 1, 1, -1, -1, -1]);
});

test('countsForScript lets an inner range override the region it covers', () => {
  // V8 reports nested ranges outermost-first: the function body ran 3 times,
  // the branch inside it never did.
  const counts = countsForScript(ranges([0, 10, 3], [4, 7, 0]), 10);
  assert.deepEqual([...counts], [3, 3, 3, 3, 0, 0, 0, 3, 3, 3]);
});

test('countsForScript applies nesting by containment, not by arrival order', () => {
  const counts = countsForScript(ranges([4, 7, 0], [0, 10, 3]), 10);
  assert.deepEqual([...counts], [3, 3, 3, 3, 0, 0, 0, 3, 3, 3]);
});

test('countsForScript keeps the innermost of three nested ranges', () => {
  const counts = countsForScript(ranges([0, 9, 5], [2, 8, 2], [4, 6, 0]), 9);
  assert.deepEqual([...counts], [5, 5, 2, 2, 0, 0, 2, 2, 5]);
});

test('countsForScript clamps ranges that fall outside the source', () => {
  const counts = countsForScript(ranges([-4, 20, 7]), 3);
  assert.deepEqual([...counts], [7, 7, 7]);
});

test('countsForScript tolerates a script with no functions or no ranges', () => {
  assert.deepEqual([...countsForScript({}, 3)], [-1, -1, -1]);
  assert.deepEqual([...countsForScript({ functions: [{}] }, 3)], [-1, -1, -1]);
});

test('summarizeLines counts a line as covered when any executed character is on it', () => {
  const source = 'a\nb\nc';
  const counts = countsForScript(ranges([0, 5, 1], [2, 3, 0]), source.length);
  const summary = summarizeLines(source, counts);
  assert.equal(summary.executable, 3);
  assert.equal(summary.covered, 2);
  assert.deepEqual(summary.uncovered, [2]);
});

test('summarizeLines ignores whitespace-only lines', () => {
  const source = 'a\n   \n\t\nb';
  const counts = countsForScript(ranges([0, source.length, 0]), source.length);
  const summary = summarizeLines(source, counts);
  assert.equal(summary.executable, 2);
  assert.deepEqual(summary.uncovered, [1, 4]);
});

test('summarizeLines ignores carriage returns so CRLF sources are not double-counted', () => {
  const source = 'a\r\nb\r\n';
  const counts = countsForScript(ranges([0, source.length, 1]), source.length);
  const summary = summarizeLines(source, counts);
  assert.equal(summary.executable, 2);
  assert.equal(summary.covered, 2);
});

test('summarizeLines flushes a final line that has no trailing newline', () => {
  const source = 'a\nb';
  const counts = countsForScript(ranges([0, 1, 1]), source.length);
  const summary = summarizeLines(source, counts);
  assert.equal(summary.executable, 1);
  assert.deepEqual(summary.uncovered, []);
});

test('summarizeLines treats source outside any recorded range as non-executable', () => {
  const source = 'a\nb';
  const summary = summarizeLines(source, countsForScript({}, source.length));
  assert.deepEqual(summary, { executable: 0, covered: 0, uncovered: [] });
});

test('summarizeLines reports 0 executable lines for an empty source', () => {
  assert.deepEqual(summarizeLines('', countsForScript({}, 0)), {
    executable: 0,
    covered: 0,
    uncovered: [],
  });
});

function runReporter(args) {
  // The reporter spawns its own `node --test`, which refuses to run when it
  // inherits this file's test-runner context, and it manages its own
  // NODE_V8_COVERAGE directory, so the child starts clean on both.
  const env = { ...process.env, TZ: 'UTC' };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_V8_COVERAGE;
  return spawnSync(process.execPath, [REPORTER, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
  });
}

// A single small suite keeps these end-to-end runs to about a second each and
// makes the reported total deterministic at 100%.
const NARROW = ['--', 'tests/validate-utils.test.mjs'];

test('the reporter exits 0 and prints a total when coverage clears --check', () => {
  const result = runReporter(['--check', '100', ...NARROW]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^all files\s+\|\s+100\.00 \|$/m);
  assert.match(result.stdout, /scripts\/lib\/validate-utils\.mjs/);
});

test('the reporter fails the run when coverage is below --check', () => {
  const result = runReporter(['--check', '100.5', ...NARROW]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Line coverage 100\.00% is below the required 100\.5%/,
  );
});

test('--check rejects a non-numeric threshold instead of silently disabling the gate', () => {
  const result = runReporter(['--check', 'ninety', ...NARROW]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--check requires a numeric percentage/);
});

test('--check rejects a missing threshold', () => {
  const result = runReporter(['--check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--check requires a numeric percentage/);
});

test('the reporter fails loudly rather than reporting 100% on no data', () => {
  // An empty merge must not be rounded up into a passing percentage: with no
  // recorded data the gate has nothing to assert and has to say so.
  const result = runReporter(['--check', '90', '--', 'tests/does-not-exist']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No coverage data was recorded\./);
  assert.doesNotMatch(result.stdout, /all files/);
});

test('without --check the reporter reports coverage and exits 0', () => {
  const result = runReporter(NARROW);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /all files/);
});
