// Contract for tests/tools/mutation-run.mjs.
//
// Three properties matter most here and each is asserted against a fixture
// repository rather than this one:
//
//   - the source file is restored even when a run throws, because the runner
//     edits the working tree in place;
//   - a suite spawned for a mutant writes its coverage somewhere other than an
//     enclosing coverage run, so broken source never reaches the gate's report;
//   - a source file that no test names is reported by name instead of being
//     scored, because that is a missing test rather than a weak one.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SOURCE_ROOTS,
  STATUS,
  USAGE,
  formatReport,
  isParsable,
  listSourceFiles,
  listTestFiles,
  main,
  mutateFile,
  parseArgs,
  runTests,
  selectTests,
  summarize,
} from './tools/mutation-run.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// A miniature repository with the same shape as this one: a source root, a
// tests/ directory, and a unit test that names its subject by path.
const SOURCE = 'src/lib/compare.mjs';
const SOURCE_TEXT = [
  'export function withinBudget(value, budget) {',
  '  return value <= budget && budget > 0;',
  '}',
  '',
].join('\n');
const TEST_TEXT = [
  "import assert from 'node:assert/strict';",
  "import test from 'node:test';",
  "import { withinBudget } from '../src/lib/compare.mjs';",
  '',
  "test('the budget boundary is inclusive', () => {",
  '  assert.equal(withinBudget(2, 2), true);',
  '  assert.equal(withinBudget(3, 2), false);',
  '  assert.equal(withinBudget(0, 0), false);',
  '});',
  '',
].join('\n');

function fixtureRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'mutation-fixture-'));
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

function defaultFixture() {
  return fixtureRepo({
    [SOURCE]: SOURCE_TEXT,
    'tests/compare.test.mjs': TEST_TEXT,
    'tests/unrelated.test.mjs': "import 'node:test';\n",
    'tests/notes.md': 'src/lib/compare.mjs\n',
  });
}

test('the default source roots are the production trees', () => {
  assert.deepEqual(DEFAULT_SOURCE_ROOTS, ['src', 'scripts/lib']);
});

test('listSourceFiles walks nested directories and skips non-source files', () => {
  const root = fixtureRepo({
    'src/a.js': '',
    'src/nested/b.jsx': '',
    'src/nested/c.mjs': '',
    'src/nested/styles.module.css': '',
    'scripts/lib/d.mjs': '',
  });
  try {
    assert.deepEqual(listSourceFiles(root), [
      'scripts/lib/d.mjs',
      'src/a.js',
      'src/nested/b.jsx',
      'src/nested/c.mjs',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listTestFiles returns unit suites only', () => {
  const root = defaultFixture();
  try {
    assert.deepEqual(listTestFiles(root), [
      'tests/compare.test.mjs',
      'tests/unrelated.test.mjs',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listTestFiles finds this repository own suites', () => {
  // The selector only works because unit tests here live directly under
  // tests/ and end in .test.mjs. If that ever changes, every mutation run
  // would silently select nothing.
  const found = listTestFiles(REPO_ROOT);
  assert.ok(found.includes('tests/uri-safety.test.mjs'), found.length);
});

test('selectTests picks the suites that name the source file', () => {
  const root = defaultFixture();
  try {
    assert.deepEqual(selectTests(root, SOURCE, listTestFiles(root)), [
      'tests/compare.test.mjs',
    ]);
    assert.deepEqual(
      selectTests(root, 'src/lib/absent.mjs', listTestFiles(root)),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('selectTests resolves the paths this repository own tests name', () => {
  // Both spellings in use here must resolve: a relative import specifier and
  // the repository-relative string importSource() takes.
  const tests = listTestFiles(REPO_ROOT);
  assert.ok(
    selectTests(REPO_ROOT, 'scripts/lib/uri-safety.mjs', tests).length > 0,
    'an import specifier must select its suite',
  );
  assert.ok(
    selectTests(REPO_ROOT, 'src/components/shared/useFilterToolbar.js', tests)
      .length > 0,
    'an importSource() argument must select its suite',
  );
});

test('isParsable accepts JSX and rejects a mutant the parser refuses', () => {
  assert.equal(isParsable('const a = <div className="b">{c}</div>;'), true);
  // `??` may not be mixed with `||` without parentheses, which is the one
  // mutant this repository's source actually produces that cannot compile.
  assert.equal(isParsable('const a = b ?? c || d;'), false);
});

test('runTests reports a passing and a failing suite', () => {
  const root = defaultFixture();
  try {
    assert.equal(
      runTests({
        repoRoot: root,
        testFiles: ['tests/compare.test.mjs'],
        timeoutMs: 120000,
      }).passed,
      true,
    );
    writeFileSync(
      join(root, SOURCE),
      SOURCE_TEXT.replace('value <= budget', 'value < budget'),
    );
    const failed = runTests({
      repoRoot: root,
      testFiles: ['tests/compare.test.mjs'],
      timeoutMs: 120000,
    });
    assert.equal(failed.passed, false);
    assert.match(failed.output, /fail 1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a suite spawned for a mutant does not write into an enclosing coverage run', () => {
  const root = defaultFixture();
  const coverageDir = mkdtempSync(join(tmpdir(), 'mutation-enclosing-'));
  const previous = process.env.NODE_V8_COVERAGE;
  process.env.NODE_V8_COVERAGE = coverageDir;
  try {
    runTests({
      repoRoot: root,
      testFiles: ['tests/compare.test.mjs'],
      timeoutMs: 120000,
    });
    assert.deepEqual(
      readdirSync(coverageDir),
      [],
      'coverage from a mutated run must not land in the enclosing directory',
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_V8_COVERAGE;
    else process.env.NODE_V8_COVERAGE = previous;
    rmSync(coverageDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('runTests reports a spawn failure rather than throwing', () => {
  // spawnSync returns null for status, stdout and stderr when the child
  // never starts, which the empty-string fallbacks have to absorb.
  const result = runTests({
    repoRoot: join(tmpdir(), 'mutation-absent-repo'),
    testFiles: ['tests/compare.test.mjs'],
    timeoutMs: 120000,
  });
  assert.equal(result.passed, false);
  assert.equal(result.output, '');
});

test('the module runs as a CLI with no injected context', () => {
  // main()'s defaults -- the repository root derived from import.meta.url and
  // the console-backed log and error sinks -- and the entry-point guard below
  // it are only reached when the file is the process entry point.
  const env = { ...process.env, TZ: 'UTC' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./tools/mutation-run.mjs', import.meta.url)),
      '--help',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8', env },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), USAGE.trim());
});

test('mutateFile classifies killed, survived and unparsable mutants', () => {
  const root = fixtureRepo({
    [SOURCE]: 'export const a = (b, c, d) => b ?? c || d;\n',
    'tests/compare.test.mjs': TEST_TEXT,
  });
  const seen = [];
  try {
    const { results } = mutateFile({
      repoRoot: root,
      sourceFile: SOURCE,
      testFiles: ['tests/compare.test.mjs'],
      io: {
        isParsable: (text) => !text.includes('?? c &&'),
        runTests: ({ testFiles }) => {
          assert.deepEqual(testFiles, ['tests/compare.test.mjs']);
          return { passed: seen.length === 0, output: '' };
        },
        onResult: (result) => seen.push(result.status),
      },
    });
    assert.deepEqual(
      results.map((result) => [result.operator, result.status]),
      [
        ['nullish-to-or', STATUS.survived],
        ['or-to-and', STATUS.invalid],
      ],
    );
    assert.deepEqual(seen, [STATUS.survived, STATUS.invalid]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mutateFile stops at --max-mutants', () => {
  const root = defaultFixture();
  try {
    const { results } = mutateFile({
      repoRoot: root,
      sourceFile: SOURCE,
      testFiles: ['tests/compare.test.mjs'],
      maxMutants: 1,
      io: { runTests: () => ({ passed: false, output: '' }) },
    });
    assert.equal(results.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mutateFile restores the source file even when the run throws', () => {
  const root = defaultFixture();
  try {
    assert.throws(
      () =>
        mutateFile({
          repoRoot: root,
          sourceFile: SOURCE,
          testFiles: ['tests/compare.test.mjs'],
          io: {
            runTests: () => {
              throw new Error('spawn failed');
            },
          },
        }),
      /spawn failed/,
    );
    assert.equal(readFileSync(join(root, SOURCE), 'utf8'), SOURCE_TEXT);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mutateFile really kills a mutant through a spawned suite', () => {
  // The injected-io cases above never touch the filesystem or a child
  // process. This one does both, so the default io wiring is exercised.
  const root = defaultFixture();
  try {
    const { results } = mutateFile({
      repoRoot: root,
      sourceFile: SOURCE,
      testFiles: ['tests/compare.test.mjs'],
      maxMutants: 1,
    });
    assert.deepEqual(
      results.map((result) => result.status),
      [STATUS.killed],
    );
    assert.equal(readFileSync(join(root, SOURCE), 'utf8'), SOURCE_TEXT);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('summarize scores killed over testable mutants and lists survivors', () => {
  const summary = summarize([
    {
      file: 'src/a.mjs',
      tests: ['tests/a.test.mjs'],
      results: [
        { file: 'src/a.mjs', status: STATUS.killed },
        { file: 'src/a.mjs', status: STATUS.survived, line: 1, column: 2 },
        { file: 'src/a.mjs', status: STATUS.invalid },
      ],
    },
    { file: 'src/b.mjs', tests: [], results: [] },
  ]);
  assert.equal(summary.killed, 1);
  assert.equal(summary.survived, 1);
  assert.equal(summary.invalid, 1);
  assert.equal(summary.score, 50);
  assert.deepEqual(summary.unselected, ['src/b.mjs']);
  assert.equal(summary.survivors.length, 1);
});

test('summarize reports no score when nothing testable was produced', () => {
  const summary = summarize([
    { file: 'src/a.mjs', tests: ['tests/a.test.mjs'], results: [] },
  ]);
  assert.equal(summary.score, null);
});

test('the report names survivors, unselected files and the score', () => {
  const report = formatReport(
    summarize([
      {
        file: 'src/a.mjs',
        tests: ['tests/a.test.mjs'],
        results: [
          {
            file: 'src/a.mjs',
            status: STATUS.survived,
            line: 3,
            column: 4,
            original: '&&',
            replacement: '||',
            operator: 'and-to-or',
          },
          { file: 'src/a.mjs', status: STATUS.killed },
        ],
      },
      { file: 'src/b.mjs', tests: [], results: [] },
    ]),
  );
  assert.match(report, /src\/a\.mjs:3:4 && -> \|\| \(and-to-or\)/);
  assert.match(report, /No unit test names these source files/);
  assert.match(report, /^ {2}src\/b\.mjs$/m);
  assert.match(report, /killed 1, survived 1, unparsable 0/);
  assert.match(report, /Mutation score: 50\.00%/);
});

test('the report says so when no score could be computed', () => {
  const report = formatReport(summarize([]));
  assert.match(report, /Mutation score: n\/a/);
  assert.doesNotMatch(report, /Surviving mutants/);
  assert.doesNotMatch(report, /No unit test names/);
});

test('parseArgs reads every documented flag', () => {
  assert.deepEqual(
    parseArgs([
      '--files',
      'src/a.mjs,src/b.mjs',
      '--max-mutants',
      '3',
      '--min-score',
      '80',
      '--timeout',
      '5000',
      '--json',
      'out.json',
      '--quiet',
    ]),
    {
      files: ['src/a.mjs', 'src/b.mjs'],
      maxMutants: 3,
      minScore: 80,
      timeoutMs: 5000,
      json: 'out.json',
      quiet: true,
      help: false,
    },
  );
});

test('parseArgs defaults every flag and recognises --help', () => {
  assert.deepEqual(parseArgs([]), {
    files: null,
    maxMutants: Infinity,
    minScore: null,
    timeoutMs: 120000,
    json: null,
    quiet: false,
    help: false,
  });
  assert.equal(parseArgs(['--help']).help, true);
});

test('parseArgs rejects an unrecognised argument with the usage text', () => {
  assert.throws(() => parseArgs(['--what']), /Unrecognized argument: --what/);
});

test('every flag the usage text documents is accepted', () => {
  const documented = [...USAGE.matchAll(/^\s{2}(--[a-z-]+)/gm)].map(
    ([, flag]) => flag,
  );
  assert.ok(documented.length > 0, USAGE);
  for (const flag of documented) {
    // Value-taking and bare flags are both documented the same way, so a
    // flag counts as parsed if either form is accepted.
    const accepted = [[flag], [flag, '1']].some((argv) => {
      try {
        parseArgs(argv);
        return true;
      } catch {
        return false;
      }
    });
    assert.ok(accepted, `${flag} is documented but not parsed`);
  }
});

function run(root, argv) {
  const out = [];
  const err = [];
  const code = main(argv, {
    repoRoot: root,
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('main prints the usage text and stops', () => {
  const root = defaultFixture();
  try {
    const result = run(root, ['--help']);
    assert.equal(result.code, 0);
    assert.equal(result.out, USAGE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('main mutates the default roots, reports progress and passes a met floor', () => {
  const root = defaultFixture();
  try {
    const result = run(root, ['--min-score', '100']);
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /src\/lib\/compare\.mjs \(1 suite\(s\)\)/);
    assert.match(result.out, /killed src\/lib\/compare\.mjs:2:/);
    assert.match(result.out, /Mutation score: 100\.00%/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('main exits non-zero when the score is below --min-score', () => {
  const root = fixtureRepo({
    [SOURCE]: SOURCE_TEXT,
    // Asserts nothing about the boundary, so the `<=` mutant survives.
    'tests/compare.test.mjs': [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "import { withinBudget } from '../src/lib/compare.mjs';",
      '',
      "test('it returns a boolean', () => {",
      "  assert.equal(typeof withinBudget(1, 2), 'boolean');",
      '});',
      '',
    ].join('\n'),
  });
  try {
    const result = run(root, ['--quiet', '--min-score', '100']);
    assert.equal(result.code, 1);
    assert.match(result.out, /Surviving mutants/);
    assert.match(result.err, /is below the required 100%/);
    // --quiet suppressed the per-mutant lines but not the report.
    assert.doesNotMatch(result.out, /suite\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('main refuses a floor it could not measure, and writes the JSON record', () => {
  const root = fixtureRepo({
    [SOURCE]: 'export const value = 1;\n',
    'tests/compare.test.mjs': TEST_TEXT,
  });
  try {
    const result = run(root, [
      '--files',
      SOURCE,
      '--quiet',
      '--json',
      'report.json',
      '--min-score',
      '50',
    ]);
    assert.equal(result.code, 1);
    assert.match(result.err, /no testable mutant was produced/);
    const record = JSON.parse(readFileSync(join(root, 'report.json'), 'utf8'));
    assert.equal(record.summary.score, null);
    assert.deepEqual(record.files[0].tests, ['tests/compare.test.mjs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('main reports a source file no test names instead of scoring it', () => {
  const root = fixtureRepo({
    [SOURCE]: SOURCE_TEXT,
    'tests/unrelated.test.mjs': "import 'node:test';\n",
  });
  try {
    const result = run(root, ['--quiet']);
    assert.equal(result.code, 0);
    assert.match(result.out, /No unit test names these source files/);
    assert.match(result.out, /src\/lib\/compare\.mjs/);
    assert.match(result.out, /Mutation score: n\/a/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
