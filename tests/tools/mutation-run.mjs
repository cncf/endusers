// The runner half of the mutation gate. `./mutation-operators.mjs` decides
// what to change; this decides what to change it in, which tests to run
// against it, and what the result means.
//
// Two things make a per-mutant run affordable here. First, the whole unit
// suite is far too slow to run once per mutant, so only the test files that
// name the source file under mutation are run. Unit tests in this repository
// always name the module they cover by repository-relative path -- either as
// an import specifier (`from '../scripts/lib/url-safety.mjs'`) or as the
// argument to `importSource('src/components/.../index.js')` -- so the path
// literal is a sound selector, and a source file no test names is reported as
// unselected rather than silently scored.
//
// Second, every spawned suite gets its own NODE_V8_COVERAGE directory. Without
// that override a mutation run nested inside the coverage gate would merge
// counts gathered from deliberately broken source into the gate's report.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseSync } from '@swc/core';

import {
  applyMutant,
  describeMutant,
  mutantsFor,
} from './mutation-operators.mjs';

export const DEFAULT_SOURCE_ROOTS = ['src', 'scripts/lib'];
export const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs'];
export const TEST_ROOT = 'tests';

// A mutant that leaves source the parser rejects proves nothing: no test could
// have asserted it. Those are reported separately and kept out of the score.
export const STATUS = {
  killed: 'killed',
  survived: 'survived',
  invalid: 'invalid',
};

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else found.push(full);
  }
  return found;
}

// Repository-relative, forward-slashed, so a path compares equal to the
// literal a test file spells out regardless of the host separator.
function toPosix(path) {
  return path.split(sep).join('/');
}

/**
 * Every mutable source file under `roots`, repository-relative. A root that
 * does not exist contributes nothing rather than failing the run, so the
 * default roots stay usable in a tree that only has one of them.
 *
 * @param {string} repoRoot
 * @param {string[]} roots
 * @returns {string[]}
 */
export function listSourceFiles(repoRoot, roots = DEFAULT_SOURCE_ROOTS) {
  const files = [];
  for (const root of roots) {
    const absolute = join(repoRoot, root);
    if (!existsSync(absolute)) continue;
    for (const full of walk(absolute)) {
      if (SOURCE_EXTENSIONS.some((ext) => full.endsWith(ext))) {
        files.push(toPosix(relative(repoRoot, full)));
      }
    }
  }
  return files.sort();
}

/**
 * Every unit-test file, repository-relative. End-to-end specs are excluded:
 * they need a production build, which no per-mutant run can afford.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function listTestFiles(repoRoot) {
  return readdirSync(join(repoRoot, TEST_ROOT))
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => `${TEST_ROOT}/${name}`)
    .sort();
}

/**
 * The test files that name `sourceFile`, which are the ones a mutant of it
 * could plausibly fail.
 *
 * @param {string} repoRoot
 * @param {string} sourceFile repository-relative
 * @param {string[]} testFiles repository-relative
 * @returns {string[]}
 */
export function selectTests(repoRoot, sourceFile, testFiles) {
  return testFiles.filter((testFile) =>
    readFileSync(join(repoRoot, testFile), 'utf8').includes(sourceFile),
  );
}

/**
 * Whether a mutated source string still parses. JSX is enabled because the
 * component files under src/ are .js files containing JSX.
 *
 * @param {string} source
 * @returns {boolean}
 */
export function isParsable(source) {
  try {
    parseSync(source, { syntax: 'ecmascript', jsx: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `testFiles` in a child `node --test`, with coverage redirected away from
 * any enclosing coverage run.
 *
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {string[]} options.testFiles
 * @param {number} options.timeoutMs
 * @returns {{passed: boolean, output: string}}
 */
export function runTests({ repoRoot, testFiles, timeoutMs }) {
  const coverageDir = mkdtempSync(join(tmpdir(), 'mutation-coverage-'));
  try {
    const env = { ...process.env, TZ: 'UTC', NODE_V8_COVERAGE: coverageDir };
    // `node --test` refuses to start inside another test runner.
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', ...testFiles], {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
      timeout: timeoutMs,
    });
    return {
      passed: result.status === 0,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  } finally {
    rmSync(coverageDir, { recursive: true, force: true });
  }
}

/**
 * Mutate one source file, running the selected tests against each mutant.
 *
 * `io` is injected so the unit tests can drive every outcome without writing
 * to the repository or spawning a suite per case.
 *
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {string} options.sourceFile repository-relative
 * @param {string[]} options.testFiles repository-relative
 * @param {number} [options.maxMutants]
 * @param {number} [options.timeoutMs]
 * @param {object} [options.io]
 * @returns {{file: string, tests: string[], results: Array<object>}}
 */
export function mutateFile({
  repoRoot,
  sourceFile,
  testFiles,
  maxMutants = Infinity,
  timeoutMs = 120000,
  io = {},
}) {
  const read = io.read ?? ((path) => readFileSync(path, 'utf8'));
  const write = io.write ?? ((path, text) => writeFileSync(path, text));
  const run = io.runTests ?? runTests;
  const parsable = io.isParsable ?? isParsable;
  const onResult = io.onResult ?? (() => {});

  const absolute = join(repoRoot, sourceFile);
  const original = read(absolute);
  const mutants = mutantsFor(original).slice(0, maxMutants);
  const results = [];

  try {
    for (const mutant of mutants) {
      const mutated = applyMutant(original, mutant);
      let status;
      if (!parsable(mutated)) {
        status = STATUS.invalid;
      } else {
        write(absolute, mutated);
        status = run({ repoRoot, testFiles, timeoutMs }).passed
          ? STATUS.survived
          : STATUS.killed;
      }
      const result = { ...mutant, file: sourceFile, status };
      results.push(result);
      onResult(result);
    }
  } finally {
    write(absolute, original);
  }

  return { file: sourceFile, tests: testFiles, results };
}

/**
 * Collapse per-file results into counts and a score.
 *
 * The score is killed over the mutants that were actually testable, so files
 * with no selected tests lower nothing: they are reported by name instead,
 * because an unselected file is a gap in the suite rather than a weak test.
 *
 * @param {Array<{file: string, tests: string[], results: Array<object>}>} files
 * @returns {{killed: number, survived: number, invalid: number,
 *   score: number|null, survivors: Array<object>, unselected: string[]}}
 */
export function summarize(files) {
  const counts = { killed: 0, survived: 0, invalid: 0 };
  const survivors = [];
  const unselected = [];
  for (const file of files) {
    if (file.tests.length === 0) {
      unselected.push(file.file);
      continue;
    }
    for (const result of file.results) {
      counts[result.status] += 1;
      if (result.status === STATUS.survived) survivors.push(result);
    }
  }
  const scored = counts.killed + counts.survived;
  return {
    ...counts,
    score: scored === 0 ? null : (counts.killed / scored) * 100,
    survivors,
    unselected,
  };
}

/**
 * The human-readable report.
 *
 * @param {ReturnType<typeof summarize>} summary
 * @returns {string}
 */
export function formatReport(summary) {
  const lines = [];
  if (summary.survivors.length > 0) {
    lines.push('Surviving mutants (no test failed when the code changed):');
    for (const survivor of summary.survivors) {
      lines.push(`  ${describeMutant(survivor.file, survivor)}`);
    }
  }
  if (summary.unselected.length > 0) {
    lines.push(
      'No unit test names these source files, so they were not mutated:',
    );
    for (const file of summary.unselected) lines.push(`  ${file}`);
  }
  lines.push(
    `killed ${summary.killed}, survived ${summary.survived}, ` +
      `unparsable ${summary.invalid}`,
  );
  lines.push(
    summary.score === null
      ? 'Mutation score: n/a (no testable mutant was produced)'
      : `Mutation score: ${summary.score.toFixed(2)}%`,
  );
  return lines.join('\n');
}

export const USAGE = `Usage: node tests/tools/mutation-run.mjs [options]

  --files <a,b>        Repository-relative source files to mutate.
                       Defaults to every file under ${DEFAULT_SOURCE_ROOTS.join(
                         ' and ',
                       )}.
  --max-mutants <n>    Stop after n mutants per file.
  --min-score <n>      Exit non-zero when the score falls below n.
  --timeout <ms>       Per-suite timeout. Default 120000.
  --json <path>        Write the full result set as JSON.
  --quiet              Do not print per-mutant progress.
  --help               Print this message.`;

/**
 * @param {string[]} argv
 * @returns {{files: string[]|null, maxMutants: number, minScore: number|null,
 *   timeoutMs: number, json: string|null, quiet: boolean, help: boolean}}
 */
export function parseArgs(argv) {
  const options = {
    files: null,
    maxMutants: Infinity,
    minScore: null,
    timeoutMs: 120000,
    json: null,
    quiet: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') options.help = true;
    else if (argument === '--quiet') options.quiet = true;
    else if (argument === '--files')
      options.files = argv[(index += 1)].split(',').filter(Boolean);
    else if (argument === '--max-mutants')
      options.maxMutants = Number(argv[(index += 1)]);
    else if (argument === '--min-score')
      options.minScore = Number(argv[(index += 1)]);
    else if (argument === '--timeout')
      options.timeoutMs = Number(argv[(index += 1)]);
    else if (argument === '--json') options.json = argv[(index += 1)];
    else throw new Error(`Unrecognized argument: ${argument}\n\n${USAGE}`);
  }
  return options;
}

/**
 * @param {string[]} argv
 * @param {{repoRoot?: string, log?: (line: string) => void,
 *   error?: (line: string) => void}} [context]
 * @returns {number} the process exit code
 */
export function main(argv, context = {}) {
  const repoRoot =
    context.repoRoot ?? fileURLToPath(new URL('../..', import.meta.url));
  const log = context.log ?? ((line) => console.log(line));
  const error = context.error ?? ((line) => console.error(line));

  const options = parseArgs(argv);
  if (options.help) {
    log(USAGE);
    return 0;
  }

  const sourceFiles = options.files ?? listSourceFiles(repoRoot);
  const testFiles = listTestFiles(repoRoot);
  const files = [];

  for (const sourceFile of sourceFiles) {
    const selected = selectTests(repoRoot, sourceFile, testFiles);
    if (selected.length === 0) {
      files.push({ file: sourceFile, tests: [], results: [] });
      continue;
    }
    if (!options.quiet) log(`${sourceFile} (${selected.length} suite(s))`);
    files.push(
      mutateFile({
        repoRoot,
        sourceFile,
        testFiles: selected,
        maxMutants: options.maxMutants,
        timeoutMs: options.timeoutMs,
        io: {
          onResult: options.quiet
            ? undefined
            : (result) =>
                log(
                  `  ${result.status} ${describeMutant(result.file, result)}`,
                ),
        },
      }),
    );
  }

  const summary = summarize(files);
  log(formatReport(summary));

  if (options.json !== null) {
    writeFileSync(
      join(repoRoot, options.json),
      `${JSON.stringify({ summary, files }, null, 2)}\n`,
    );
  }

  if (options.minScore !== null) {
    if (summary.score === null) {
      error('--min-score was requested, but no testable mutant was produced.');
      return 1;
    }
    if (summary.score + 1e-9 < options.minScore) {
      error(
        `Mutation score ${summary.score.toFixed(2)}% is below the ` +
          `required ${options.minScore}%.`,
      );
      return 1;
    }
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
