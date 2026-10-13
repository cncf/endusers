// Covers tests/tools/flaky-reporter.mjs, the reporter that records which
// end-to-end spec flaked.
//
// The reporter is driven through the two Reporter methods Playwright calls --
// onBegin(config, suite) and onEnd() -- against hand-built stand-ins for
// TestCase and Suite rather than a real Playwright run. The shapes asserted
// here are the documented ones (node_modules/playwright/types/
// testReporter.d.ts): `Suite.allTests()`, `TestCase.outcome()`,
// `TestCase.titlePath()`, `TestCase.location` and `TestCase.results`.
// tests/playwright-config.test.mjs checks the other half -- that the config
// actually registers this module, and at a path inside the output directory
// ci.yml uploads.
import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';

import FlakyReporter, {
  DEFAULT_OUTPUT_FILE,
  flakyRecords,
  summaryMarkdown,
} from './tools/flaky-reporter.mjs';

const ROOT = '/repo';

/**
 * A TestCase stand-in.
 *
 * `titlePath()` carries the leading empty root-suite title Playwright emits,
 * so the record builder's drop-empty-segments step is exercised by every case
 * rather than by a special one.
 */
function makeTest({
  outcome,
  titles = ['navigation.spec.js', 'loads the home page'],
  file = join(ROOT, 'tests/e2e/navigation.spec.js'),
  line = 12,
  attempts = 2,
}) {
  return {
    outcome: () => outcome,
    titlePath: () => ['', 'chromium', ...titles],
    location: { file, line },
    results: Array.from({ length: attempts }, (_, index) => ({ retry: index })),
  };
}

/** Collects every write the reporter would make. */
function makeSink() {
  const sink = { dirs: [], files: [], appends: [] };
  return {
    sink,
    mkdir: (path, options) => sink.dirs.push([path, options]),
    writeFile: (path, contents) => sink.files.push([path, contents]),
    appendFile: (path, contents) => sink.appends.push([path, contents]),
  };
}

function run(tests, { env = {}, ...options } = {}) {
  const { sink, mkdir, writeFile, appendFile } = makeSink();
  const reporter = new FlakyReporter({
    mkdir,
    writeFile,
    appendFile,
    env,
    ...options,
  });
  reporter.onBegin({ rootDir: ROOT }, { allTests: () => tests });
  reporter.onEnd();
  return { reporter, sink };
}

test('selects only the tests Playwright calls flaky', () => {
  const records = flakyRecords(
    [
      makeTest({ outcome: 'expected', titles: ['a.spec.js', 'passes'] }),
      makeTest({ outcome: 'flaky', titles: ['b.spec.js', 'flakes'] }),
      makeTest({ outcome: 'unexpected', titles: ['c.spec.js', 'fails'] }),
      makeTest({ outcome: 'skipped', titles: ['d.spec.js', 'skipped'] }),
    ],
    ROOT,
  );

  assert.deepEqual(
    records.map((record) => record.title),
    ['chromium > b.spec.js > flakes'],
  );
});

test('reports the spec file relative to the run root, with its line', () => {
  const [record] = flakyRecords(
    [
      makeTest({
        outcome: 'flaky',
        file: join(ROOT, 'tests/e2e/search.spec.js'),
        line: 47,
        attempts: 2,
      }),
    ],
    ROOT,
  );

  assert.equal(record.file, 'tests/e2e/search.spec.js');
  assert.equal(record.line, 47);
  assert.equal(record.attempts, 2);
});

test('renders the summary as a list naming each flaky spec', () => {
  const markdown = summaryMarkdown([
    {
      title: 'chromium > a.spec.js > one',
      file: 'a.spec.js',
      line: 3,
      attempts: 2,
    },
    {
      title: 'chromium > b.spec.js > two',
      file: 'b.spec.js',
      line: 9,
      attempts: 3,
    },
  ]);

  assert.match(markdown, /^## Flaky end-to-end specs\n/);
  assert.match(
    markdown,
    /- `a\.spec\.js:3` — chromium > a\.spec\.js > one \(passed on attempt 2\)/,
  );
  assert.match(
    markdown,
    /- `b\.spec\.js:9` — chromium > b\.spec\.js > two \(passed on attempt 3\)/,
  );
  assert.ok(markdown.endsWith('\n'));
});

// Property 3 of tests/ci-playwright-trace-evidence.test.mjs: a green,
// non-flaky run leaves Playwright's output directory empty, so the upload
// step can stay tolerant of an empty directory. A report written
// unconditionally would populate it on every run and undo that.
test('writes nothing when no test flaked', () => {
  const { sink } = run([makeTest({ outcome: 'expected' })], {
    env: { GITHUB_STEP_SUMMARY: '/summary.md' },
  });

  assert.deepEqual(sink.dirs, []);
  assert.deepEqual(sink.files, []);
  assert.deepEqual(sink.appends, []);
});

test('writes nothing when the run had no tests at all', () => {
  const { sink } = run([]);

  assert.deepEqual(sink.files, []);
});

test('writes the report into its output file, creating the directory', () => {
  const { sink } = run([makeTest({ outcome: 'flaky' })], {
    outputFile: 'out/dir/flaky-specs.json',
  });

  assert.deepEqual(sink.dirs, [['out/dir', { recursive: true }]]);
  assert.equal(sink.files.length, 1);
  const [path, contents] = sink.files[0];
  assert.equal(path, 'out/dir/flaky-specs.json');
  assert.deepEqual(JSON.parse(contents), {
    flaky: [
      {
        title: 'chromium > navigation.spec.js > loads the home page',
        file: 'tests/e2e/navigation.spec.js',
        line: 12,
        attempts: 2,
      },
    ],
  });
  assert.ok(contents.endsWith('\n'));
});

test('falls back to a path inside the default output directory', () => {
  const { reporter, sink } = run([makeTest({ outcome: 'flaky' })]);

  assert.equal(reporter.outputFile, DEFAULT_OUTPUT_FILE);
  assert.equal(sink.files[0][0], DEFAULT_OUTPUT_FILE);
  assert.ok(DEFAULT_OUTPUT_FILE.startsWith('test-results/'));
});

test('appends the summary when GITHUB_STEP_SUMMARY is set', () => {
  const { sink } = run([makeTest({ outcome: 'flaky' })], {
    env: { GITHUB_STEP_SUMMARY: '/github/summary.md' },
  });

  assert.equal(sink.appends.length, 1);
  const [path, contents] = sink.appends[0];
  assert.equal(path, '/github/summary.md');
  assert.match(contents, /navigation\.spec\.js:12/);
});

test('skips the summary when GITHUB_STEP_SUMMARY is unset', () => {
  const { sink } = run([makeTest({ outcome: 'flaky' })], { env: {} });

  assert.equal(sink.files.length, 1);
  assert.deepEqual(sink.appends, []);
});

// An empty value is as unusable as an absent one: appendFileSync('') throws,
// which would turn a flaky run into a reporter crash.
test('treats an empty GITHUB_STEP_SUMMARY as unset', () => {
  const { sink } = run([makeTest({ outcome: 'flaky' })], {
    env: { GITHUB_STEP_SUMMARY: '' },
  });

  assert.deepEqual(sink.appends, []);
});

// The real filesystem and process.env are the defaults, so a reporter
// constructed the way Playwright constructs it -- with the options object
// from the config, carrying no seams -- still has every collaborator bound.
test('defaults its collaborators to the real filesystem and environment', () => {
  const reporter = new FlakyReporter();

  assert.equal(typeof reporter.writeFile, 'function');
  assert.equal(typeof reporter.appendFile, 'function');
  assert.equal(typeof reporter.mkdir, 'function');
  assert.equal(reporter.env, process.env);
});

// onEnd returns undefined rather than a status, which is what leaves
// Playwright's own exit status alone. A reporter that returned
// { status: 'failed' } here would turn every retried pass into a red job --
// a policy decision that is not this reporter's to make.
test('does not alter the run status', () => {
  const { sink, reporter } = run([makeTest({ outcome: 'flaky' })]);

  assert.equal(sink.files.length, 1);
  assert.equal(reporter.onEnd(), undefined);
});
