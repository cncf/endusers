// Unit tests for the mutation runner.
//
// The runner is exercised twice over: with a fake spawn that decides killed
// versus survived deterministically, and once end to end against a fixture
// whose mutants really do run under `node --test`, so the selection, the
// file rewrite and the restore are verified against a real child process.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  listTestFiles,
  main,
  mutationScore,
  parseArgs,
  runMutation,
  selectTestFiles,
} from './tools/mutation-run.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function fixtureRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'endusers-mutation-run-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

function recordedLogs() {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
}

const SOURCE = 'export const both = (a, b) => a && b;\n';
const NAMING_TEST = {
  path: 'tests/sample.test.mjs',
  content: "import { both } from '../sample.mjs';\n",
};

const E2E_SOURCE =
  'export const both = (a, b) => a && b;\n' +
  'export const either = (a, b) => a || b;\n' +
  'export const decide = (x) => (x > 10 ? true : false);\n';

test('parseArgs defaults to no floor and the stock timeout', () => {
  assert.deepEqual(parseArgs(['sample.mjs']), {
    sourcePath: 'sample.mjs',
    minScore: null,
    timeoutMs: 120_000,
    help: false,
  });
});

test('parseArgs takes the flags and strips a ./ prefix', () => {
  assert.deepEqual(
    parseArgs([
      '--min-score',
      '80',
      '--timeout-ms',
      '5000',
      './scripts/lib/x.mjs',
    ]),
    {
      sourcePath: 'scripts/lib/x.mjs',
      minScore: 80,
      timeoutMs: 5000,
      help: false,
    },
  );
});

test('parseArgs accepts fractional scores and both help spellings', () => {
  assert.equal(parseArgs(['--min-score', '99.5', 'x.mjs']).minScore, 99.5);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs rejects malformed invocations', () => {
  for (const [argv, message] of [
    [['--min-score'], '--min-score requires a value'],
    [['--timeout-ms'], '--timeout-ms requires a value'],
    [
      ['--min-score', 'abc', 'x.mjs'],
      "--min-score must be a number, got 'abc'",
    ],
    [
      ['--timeout-ms', 'abc', 'x.mjs'],
      "--timeout-ms must be a number, got 'abc'",
    ],
    [
      ['--min-score', '-1', 'x.mjs'],
      '--min-score must be between 0 and 100, got -1',
    ],
    [
      ['--min-score', '101', 'x.mjs'],
      '--min-score must be between 0 and 100, got 101',
    ],
    [['--bogus', 'x.mjs'], "unknown option '--bogus'"],
    [['a.mjs', 'b.mjs'], "unexpected argument 'b.mjs'"],
  ]) {
    assert.throws(
      () => parseArgs(argv),
      new Error(message),
      JSON.stringify(argv),
    );
  }
});

test('mutationScore counts killed and survived and survives an empty run', () => {
  assert.deepEqual(mutationScore([]), {
    total: 0,
    killed: 0,
    survived: 0,
    score: 1,
  });
  assert.deepEqual(
    mutationScore([{ killed: true }, { killed: false }, { killed: true }]),
    { total: 3, killed: 2, survived: 1, score: 2 / 3 },
  );
});

test('selectTestFiles matches the repo-relative path wherever it is named', () => {
  const files = [
    NAMING_TEST,
    {
      path: 'tests/other.test.mjs',
      content: "import { x } from '../other.mjs';\n",
    },
    {
      path: 'tests/string-arg.test.mjs',
      content: "importSource('sample.mjs');\n",
    },
  ];
  assert.deepEqual(selectTestFiles('sample.mjs', files), [
    'tests/sample.test.mjs',
    'tests/string-arg.test.mjs',
  ]);
});

test('selectTestFiles matches harness modules without the tests/ prefix', () => {
  const files = [
    {
      path: 'tests/mutation-run.test.mjs',
      content: "import { main } from './tools/mutation-run.mjs';\n",
    },
    { path: 'tests/unrelated.test.mjs', content: "import './helpers.mjs';\n" },
  ];
  assert.deepEqual(selectTestFiles('tests/tools/mutation-run.mjs', files), [
    'tests/mutation-run.test.mjs',
  ]);
});

test('listTestFiles walks recursively and keeps only *.test.mjs', () => {
  const root = fixtureRoot({
    'a.test.mjs': '',
    'b.mjs': '',
    'nested/c.test.mjs': '',
    'nested/deeper/d.txt': '',
  });
  try {
    assert.deepEqual(listTestFiles(root), [
      join(root, 'a.test.mjs'),
      join(root, 'nested', 'c.test.mjs'),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runMutation reports an unreadable source as unscoreable', () => {
  const root = fixtureRoot({});
  try {
    const { lines, log } = recordedLogs();
    const code = runMutation({
      sourcePath: 'missing.mjs',
      repoRoot: root,
      log,
    });
    assert.equal(code, 2);
    assert.deepEqual(lines, ['error: cannot read missing.mjs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runMutation reports an unparseable source as unscoreable', () => {
  const root = fixtureRoot({ 'bad.mjs': 'const = ;\n' });
  try {
    const { lines, log } = recordedLogs();
    const code = runMutation({ sourcePath: 'bad.mjs', repoRoot: root, log });
    assert.equal(code, 2);
    assert.match(lines[0], /^error: cannot parse bad\.mjs: /);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runMutation passes vacuously when there is nothing to mutate', () => {
  const root = fixtureRoot({ 'plain.mjs': 'export const x = 1;\n' });
  try {
    const { lines, log } = recordedLogs();
    const code = runMutation({ sourcePath: 'plain.mjs', repoRoot: root, log });
    assert.equal(code, 0);
    assert.deepEqual(lines, [
      'plain.mjs: no mutable constructs; nothing to score',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runMutation refuses to score a file no test names', () => {
  const root = fixtureRoot({
    'sample.mjs': SOURCE,
    'tests/other.test.mjs': "import { x } from '../other.mjs';\n",
  });
  try {
    const { lines, log } = recordedLogs();
    const code = runMutation({ sourcePath: 'sample.mjs', repoRoot: root, log });
    assert.equal(code, 2);
    assert.match(lines[0], /^error: no test file names sample\.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A fake spawn that reads the mutated file back, proving the rewrite lands
// before the tests run, and decides killed by whether the mutation changed
// the content (every real mutation does).
function fakeSpawnObserving(root, sourcePath, observed = []) {
  return (command, args, options) => {
    observed.push({
      command,
      args,
      options,
      content: readFileSync(join(root, sourcePath), 'utf8'),
    });
    return { status: 0 };
  };
}

test('runMutation writes each mutant, runs the selected tests and restores the file', () => {
  const root = fixtureRoot({
    'sample.mjs': SOURCE,
    'tests/sample.test.mjs': NAMING_TEST.content,
  });
  const observed = [];
  const { lines, log } = recordedLogs();
  try {
    const code = runMutation({
      sourcePath: 'sample.mjs',
      repoRoot: root,
      spawnImpl: (command, args, options) => {
        observed.push(readFileSync(join(root, 'sample.mjs'), 'utf8'));
        assert.equal(command, process.execPath);
        assert.deepEqual(args.slice(0, 1), ['--test']);
        assert.ok(args.includes(join(root, 'tests', 'sample.test.mjs')));
        assert.equal(options.cwd, root);
        assert.equal(options.env.TZ, 'UTC');
        // The mutant flips the operator, so the suite fails: killed.
        return { status: 1 };
      },
      log,
    });
    assert.equal(code, 0);
    assert.deepEqual(observed, ['export const both = (a, b) => a || b;\n']);
    assert.equal(readFileSync(join(root, 'sample.mjs'), 'utf8'), SOURCE);
    assert.deepEqual(lines, [
      'sample.mjs: 1 mutants, 1 test file(s) selected',
      "KILLED   sample.mjs:1:33 replace '&&' with '||'",
      'mutation score: 1/1 killed (100.0%), 0 survived',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runMutation reports survivors and gates on --min-score', () => {
  const root = fixtureRoot({
    'sample.mjs': SOURCE,
    'tests/sample.test.mjs': NAMING_TEST.content,
  });
  const { lines, log } = recordedLogs();
  try {
    const code = runMutation({
      sourcePath: 'sample.mjs',
      repoRoot: root,
      minScore: 100,
      spawnImpl: () => ({ status: 0 }),
      log,
    });
    assert.equal(code, 1);
    assert.deepEqual(lines.slice(1), [
      "SURVIVED sample.mjs:1:33 replace '&&' with '||'",
      'mutation score: 0/1 killed (0.0%), 1 survived',
      'error: mutation score 0.0% is below --min-score 100',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runMutation clears the floor when the score meets --min-score', () => {
  const root = fixtureRoot({
    'sample.mjs': SOURCE,
    'tests/sample.test.mjs': NAMING_TEST.content,
  });
  const { log } = recordedLogs();
  try {
    const code = runMutation({
      sourcePath: 'sample.mjs',
      repoRoot: root,
      minScore: 100,
      spawnImpl: () => ({ status: 1 }),
      log,
    });
    assert.equal(code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a mutant that hangs the suite past the timeout counts as killed', () => {
  const root = fixtureRoot({
    'sample.mjs': SOURCE,
    'tests/sample.test.mjs': NAMING_TEST.content,
  });
  const { lines, log } = recordedLogs();
  try {
    const timeout = new Error('spawnSync ETIMEDOUT');
    timeout.code = 'ETIMEDOUT';
    const code = runMutation({
      sourcePath: 'sample.mjs',
      repoRoot: root,
      timeoutMs: 1000,
      spawnImpl: () => ({ status: null, error: timeout }),
      log,
    });
    assert.equal(code, 0);
    assert.match(lines[1], /^KILLED /);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a spawn failure restores the source and propagates', () => {
  const root = fixtureRoot({
    'sample.mjs': SOURCE,
    'tests/sample.test.mjs': NAMING_TEST.content,
  });
  const { log } = recordedLogs();
  try {
    assert.throws(
      () =>
        runMutation({
          sourcePath: 'sample.mjs',
          repoRoot: root,
          spawnImpl: () => ({
            status: null,
            error: new Error('spawn blew up'),
          }),
          log,
        }),
      /spawn blew up/,
    );
    assert.equal(readFileSync(join(root, 'sample.mjs'), 'utf8'), SOURCE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('main prints usage for bad arguments, help and a missing path', () => {
  const errors = [];
  const infos = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (line) => errors.push(line);
  console.log = (line) => infos.push(line);
  try {
    assert.equal(main(['--bogus']), 2);
    assert.equal(errors[0], "error: unknown option '--bogus'");
    assert.match(errors[1], /^Usage: /);
    assert.equal(main(['--help']), 0);
    assert.match(infos[0], /^Usage: /);
    assert.equal(main([]), 2);
    assert.equal(errors.length, 3);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});

test('main runs against the repository root unless a test overrides it', () => {
  const root = fixtureRoot({
    'sample.mjs': SOURCE,
    'tests/sample.test.mjs': NAMING_TEST.content,
  });
  const { lines, log } = recordedLogs();
  try {
    const code = main(['sample.mjs'], {
      repoRoot: root,
      spawnImpl: fakeSpawnObserving(root, 'sample.mjs'),
      log,
    });
    assert.equal(code, 0);
    assert.equal(lines.at(-1), 'mutation score: 0/1 killed (0.0%), 1 survived');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the CLI prints usage and exits 0 for --help', () => {
  const run = spawnSync(
    process.execPath,
    ['tests/tools/mutation-run.mjs', '--help'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  assert.equal(run.status, 0);
  assert.match(run.stdout, /^Usage: node tests\/tools\/mutation-run\.mjs/);
});

test('end to end: killed and survived mutants against a real node --test', () => {
  // `either` is tested only on (false, false), where || and && agree, so its
  // mutant survives; everything else is asserted at the boundary and dies.
  const root = fixtureRoot({
    'sample.mjs': E2E_SOURCE,
    'tests/sample.test.mjs': [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "import { both, decide, either } from '../sample.mjs';",
      "test('both', () => {",
      '  assert.equal(both(true, false), false);',
      '});',
      "test('either', () => {",
      '  assert.equal(either(false, false), false);',
      '});',
      "test('decide', () => {",
      '  assert.equal(decide(10), false);',
      '  assert.equal(decide(11), true);',
      '});',
      '',
    ].join('\n'),
  });
  const { lines, log } = recordedLogs();
  try {
    const code = runMutation({ sourcePath: 'sample.mjs', repoRoot: root, log });
    assert.equal(code, 0);
    assert.equal(
      lines.filter((line) => line.startsWith('KILLED')).length,
      4,
      lines.join('\n'),
    );
    assert.equal(
      lines.filter((line) => line.startsWith('SURVIVED')).length,
      1,
      lines.join('\n'),
    );
    assert.equal(
      lines.at(-1),
      'mutation score: 4/5 killed (80.0%), 1 survived',
    );
    assert.ok(
      lines.includes("SURVIVED sample.mjs:2:35 replace '||' with '&&'"),
      lines.join('\n'),
    );
    assert.equal(readFileSync(join(root, 'sample.mjs'), 'utf8'), E2E_SOURCE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
