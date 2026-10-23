// Records which end-to-end spec flaked, in a form something other than a
// human with a trace viewer can read.
//
// playwright.config.js sets `retries: 1` in CI, so a spec that fails and then
// passes on the retry exits the job green. The 'github' reporter annotates
// the run, but annotations are not artifacts and are not queryable; the trace
// of the failed first attempt survives only because ci.yml's "Upload
// Playwright traces" step runs on green runs too (guarded by
// tests/ci-playwright-trace-evidence.test.mjs). That trace is a binary blob
// in a directory of hashed names: it proves *a* flake happened, and says
// nothing about which spec it was without downloading the artifact and
// opening each trace. tests/ci-playwright-trace-evidence.test.mjs states the
// gap in so many words -- "nothing in the repository records which spec
// flaked or why".
//
// This reporter closes that half. It names every flaky test, writes the list
// beside the traces so the existing upload carries it, and -- when
// GITHUB_STEP_SUMMARY is set, which it is for every step of a GitHub Actions
// job -- renders the same list onto the run summary page, where it is visible
// without downloading anything. No workflow change is needed for either:
// the file lands in Playwright's own output directory, which ci.yml already
// uploads, and the summary is written by the step that runs the suite.
//
// Nothing is written when no test flaked. That is deliberate rather than
// tidiness: property 3 of tests/ci-playwright-trace-evidence.test.mjs is that
// a green, non-flaky run leaves the output directory empty, so that the
// upload step does not have to turn clean runs red or noisy. A report file
// emitted unconditionally would populate that directory on every run and
// quietly undo it.
//
// The reporter is additive -- playwright.config.js lists it beside 'github'
// rather than instead of it -- so the annotations and the exit status are
// untouched. It cannot fail a run: `onEnd` returns nothing, which leaves
// Playwright's own status in place. Surfacing a flake is evidence for a
// human, not a gate; making a retried pass fail the job is a separate
// decision that belongs to the maintainers.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

/**
 * Where the report lands when playwright.config.js names no path.
 *
 * Inside Playwright's default `outputDir`, so the default is uploaded by the
 * same ci.yml step as the traces. playwright.config.js passes the path
 * explicitly and tests/playwright-config.test.mjs checks that what it passes
 * is still inside the configured output directory, so this default is a
 * fallback for a hand-run reporter rather than the value CI depends on.
 */
export const DEFAULT_OUTPUT_FILE = 'test-results/flaky-specs.json';

/**
 * Playwright's own name for "failed, was retried, then passed".
 *
 * Read from `TestCase.outcome()` rather than recomputed from the result list:
 * the runner already decides this, and a second rule here could disagree with
 * the status the job reported.
 */
const FLAKY_OUTCOME = 'flaky';

/**
 * Describes one flaky test in terms a reader can act on without the trace.
 *
 * `titlePath()` starts with the root suite's empty title and includes the
 * project name, so the empty segments are dropped and the rest joined; the
 * file is made relative to the run's root so the record does not carry a
 * runner's absolute paths.
 *
 * @param {import('@playwright/test/reporter').TestCase} test
 * @param {string} rootDir directory test file paths are reported against
 * @returns {{title: string, file: string, line: number, attempts: number}}
 */
function describe(test, rootDir) {
  return {
    title: test.titlePath().filter(Boolean).join(' > '),
    file: relative(rootDir, test.location.file),
    line: test.location.line,
    attempts: test.results.length,
  };
}

/**
 * Every flaky test among `tests`, in the order Playwright enumerated them.
 *
 * Exported so tests/flaky-reporter.test.mjs can assert the selection without
 * standing up a Playwright run.
 *
 * @param {import('@playwright/test/reporter').TestCase[]} tests
 * @param {string} rootDir directory test file paths are reported against
 * @returns {Array<{title: string, file: string, line: number, attempts: number}>}
 */
export function flakyRecords(tests, rootDir) {
  return tests
    .filter((test) => test.outcome() === FLAKY_OUTCOME)
    .map((test) => describe(test, rootDir));
}

/**
 * The run-summary section for a non-empty list of flaky tests.
 *
 * Markdown rather than JSON because GITHUB_STEP_SUMMARY is rendered, and a
 * reader looking at a green job needs to see the spec name without opening an
 * artifact.
 *
 * @param {Array<{title: string, file: string, line: number, attempts: number}>} records
 * @returns {string} markdown ending in a newline
 */
export function summaryMarkdown(records) {
  const rows = records.map(
    (record) =>
      `- \`${record.file}:${record.line}\` — ${record.title} (passed on attempt ${record.attempts})`,
  );
  return [
    '## Flaky end-to-end specs',
    '',
    'These specs failed and then passed on retry, so the job is green and the',
    'failure is real. The trace of each failed first attempt is in the',
    '`playwright-traces` artifact.',
    '',
    ...rows,
    '',
  ].join('\n');
}

/**
 * A Playwright reporter that names the run's flaky specs.
 *
 * The filesystem and environment are injectable so the unit tests can observe
 * what would be written without writing it, following the dependency-seam
 * convention of tests/tools/e2e-coverage-builds.mjs.
 */
export default class FlakyReporter {
  /**
   * @param {object} [options]
   * @param {string} [options.outputFile] where the JSON report is written
   * @param {Function} [options.writeFile] `writeFileSync`-shaped writer
   * @param {Function} [options.appendFile] `appendFileSync`-shaped appender
   * @param {Function} [options.mkdir] `mkdirSync`-shaped directory maker
   * @param {NodeJS.ProcessEnv} [options.env] environment to read the summary
   *   path from
   */
  constructor(options = {}) {
    this.outputFile = options.outputFile ?? DEFAULT_OUTPUT_FILE;
    this.writeFile = options.writeFile ?? writeFileSync;
    this.appendFile = options.appendFile ?? appendFileSync;
    this.mkdir = options.mkdir ?? mkdirSync;
    this.env = options.env ?? process.env;
    // Stryker disable next-line StringLiteral: onBegin assigns both rootDir and this.tests, and onEnd reads rootDir only when this.tests is non-empty, so the seed is never read
    this.rootDir = '';
    this.tests = [];
  }

  /**
   * @param {import('@playwright/test/reporter').FullConfig} config
   * @param {import('@playwright/test/reporter').Suite} suite
   * @returns {void}
   */
  onBegin(config, suite) {
    this.rootDir = config.rootDir;
    this.tests = suite.allTests();
  }

  /**
   * Writes the report, if there is anything to report.
   *
   * @returns {void}
   */
  onEnd() {
    const records = flakyRecords(this.tests, this.rootDir);
    if (records.length === 0) return;
    this.mkdir(dirname(this.outputFile), { recursive: true });
    this.writeFile(
      this.outputFile,
      `${JSON.stringify({ flaky: records }, null, 2)}\n`,
    );
    const summaryPath = this.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) return;
    this.appendFile(summaryPath, summaryMarkdown(records));
  }
}
