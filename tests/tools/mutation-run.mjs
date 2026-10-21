#!/usr/bin/env node
// Mutation runner for the unit suite: `npm run test:mutation -- <path>`.
//
// Running the whole unit suite per mutant is not viable -- `TZ=UTC node
// --test` takes about a minute. The runner relies on a convention of this
// suite instead: a unit test names the module under test by repo-relative
// path, either as an import specifier (`from '../scripts/lib/foo.mjs'`) or
// as a string argument (`importSource('src/components/shared/bar.js')`), so
// the tests worth running against a mutant of `foo` are exactly the test
// files that name `foo`'s path. Harness modules under tests/tools/ are
// imported as `./tools/foo.mjs`, so the path minus its `tests/` prefix is a
// candidate too.
//
// Each mutant is written to the source file, the selected tests run, and the
// file is restored before the next mutant -- and on any failure, via
// try/finally. A mutant is killed when the selected tests fail; a mutant
// that hangs the suite past --timeout-ms is counted killed, because the
// suite demonstrably noticed the change.
//
// Usage:
//   node tests/tools/mutation-run.mjs <source-path> [--min-score <0-100>]
//     [--timeout-ms <ms>]
//
// Exit status: 0 when the run scored and the score clears --min-score (or no
// floor was given), 1 when it falls below, and 2 when the file cannot be
// scored at all -- unreadable, unparseable, or named by no test file.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applyMutant, findMutants } from './mutation-operators.mjs';

const USAGE = `Usage: node tests/tools/mutation-run.mjs <source-path> [--min-score <0-100>] [--timeout-ms <ms>]

Mutates <source-path> (a repo-relative path such as scripts/lib/foo.mjs) one
operator at a time, runs the unit test files that name the file after each
mutation, and reports which mutants the suite killed. Without --min-score the
score is reported but not gated.`;

const DEFAULT_TIMEOUT_MS = 120_000;

export function parseArgs(argv) {
  const options = {
    sourcePath: null,
    minScore: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    help: false,
  };
  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--min-score' || arg === '--timeout-ms') {
      const value = args.shift();
      if (value === undefined) throw new Error(`${arg} requires a value`);
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${arg} must be a number, got '${value}'`);
      }
      if (arg === '--min-score') {
        if (parsed < 0 || parsed > 100) {
          throw new Error(
            `--min-score must be between 0 and 100, got ${parsed}`,
          );
        }
        options.minScore = parsed;
      } else {
        options.timeoutMs = parsed;
      }
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option '${arg}'`);
    } else if (options.sourcePath === null) {
      options.sourcePath = arg.replace(/^\.\//, '');
    } else {
      throw new Error(`unexpected argument '${arg}'`);
    }
  }
  return options;
}

export function listTestFiles(testsDir, found = []) {
  for (const entry of readdirSync(testsDir, { withFileTypes: true })) {
    const full = join(testsDir, entry.name);
    if (entry.isDirectory()) listTestFiles(full, found);
    else if (entry.name.endsWith('.test.mjs')) found.push(full);
  }
  return found.sort();
}

// A test file selects a source file by naming its repo-relative path
// anywhere -- import specifier or string argument. Harness modules also
// match without their `tests/` prefix, because tests import those as
// `./tools/<name>.mjs`.
export function selectTestFiles(sourcePath, testFiles) {
  const candidates = [sourcePath];
  if (sourcePath.startsWith('tests/')) {
    candidates.push(sourcePath.slice('tests/'.length));
  }
  return testFiles
    .filter(({ content }) =>
      candidates.some((candidate) => content.includes(candidate)),
    )
    .map(({ path }) => path)
    .sort();
}

export function mutationScore(results) {
  const killed = results.filter(({ killed }) => killed).length;
  return {
    total: results.length,
    killed,
    survived: results.length - killed,
    score: results.length === 0 ? 1 : killed / results.length,
  };
}

export function runMutation({
  sourcePath,
  repoRoot,
  testsDir = join(repoRoot, 'tests'),
  minScore = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = spawnSync,
  log = console.log,
}) {
  const absoluteSource = join(repoRoot, sourcePath);
  let source;
  try {
    source = readFileSync(absoluteSource, 'utf8');
  } catch {
    log(`error: cannot read ${sourcePath}`);
    return 2;
  }
  let mutants;
  try {
    mutants = findMutants(source, { fileName: sourcePath });
  } catch (error) {
    log(`error: cannot parse ${sourcePath}: ${error.message}`);
    return 2;
  }
  if (mutants.length === 0) {
    log(`${sourcePath}: no mutable constructs; nothing to score`);
    return 0;
  }
  const testFiles = listTestFiles(testsDir).map((path) => ({
    path,
    content: readFileSync(path, 'utf8'),
  }));
  const selected = selectTestFiles(sourcePath, testFiles);
  if (selected.length === 0) {
    log(
      `error: no test file names ${sourcePath}; ` +
        'a mutant cannot be killed by a suite that never loads the file',
    );
    return 2;
  }
  log(
    `${sourcePath}: ${mutants.length} mutants, ` +
      `${selected.length} test file(s) selected`,
  );
  const results = [];
  // A suite run under `node --test` (as the coverage gate runs it) carries
  // NODE_TEST_CONTEXT, and a child spawned with it refuses to run at all:
  // "run() is being called recursively within a test file. skipping running
  // files." Strip the markers so each per-mutant run is a real run.
  const childEnv = { ...process.env, TZ: 'UTC' };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_TEST_WORKER_ID;
  try {
    for (const mutant of mutants) {
      writeFileSync(absoluteSource, applyMutant(source, mutant));
      const run = spawnImpl(process.execPath, ['--test', ...selected], {
        cwd: repoRoot,
        stdio: 'ignore',
        env: childEnv,
        timeout: timeoutMs,
      });
      if (run.error && run.error.code !== 'ETIMEDOUT') throw run.error;
      const killed = run.status !== 0;
      results.push({ mutant, killed });
      log(
        `${killed ? 'KILLED  ' : 'SURVIVED'} ` +
          `${sourcePath}:${mutant.line}:${mutant.column} ${mutant.description}`,
      );
    }
  } finally {
    writeFileSync(absoluteSource, source);
  }
  const summary = mutationScore(results);
  log(
    `mutation score: ${summary.killed}/${summary.total} killed ` +
      `(${(summary.score * 100).toFixed(1)}%), ${summary.survived} survived`,
  );
  if (minScore !== null && summary.score * 100 < minScore) {
    log(
      `error: mutation score ${(summary.score * 100).toFixed(1)}% ` +
        `is below --min-score ${minScore}`,
    );
    return 1;
  }
  return 0;
}

export function main(argv = process.argv.slice(2), overrides = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`error: ${error.message}`);
    console.error(USAGE);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.sourcePath === null) {
    console.error(USAGE);
    return 2;
  }
  return runMutation({
    sourcePath: options.sourcePath,
    repoRoot: fileURLToPath(new URL('../..', import.meta.url)),
    minScore: options.minScore,
    timeoutMs: options.timeoutMs,
    // Tests pass a fixture root and a fake spawn through this seam.
    ...overrides,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
