// StrykerJS mutation testing over src/ and scripts/lib/. See the "Mutation
// testing" section of CONTRIBUTING.md for what the gate does and how to read
// its report.
//
// The tap runner starts one `node <test file>` process per test file, which is
// what `node --test` does too, so the hooks tests/helpers-jsx.mjs registers for
// JSX sources keep working unchanged. Each test file counts as one "test" for
// per-test coverage, so a mutant only reruns the files that executed it.

// Test files that read src/ or scripts/lib/ as text, or run the coverage
// harness over the whole tree, fail against Stryker's instrumented copy for
// reasons unrelated to any mutant. They assert on source shape rather than
// behaviour, so they cannot kill a mutant either. tests/stryker-config.test.mjs
// keeps both lists naming tests that exist.
export const SOURCE_TEXT_TEST_FILES = [
  'content-security-contract',
  'coverage-report',
  'coverage-report-cli',
  'coverage-report-source-files',
  'dev-environment',
];

// Single source-text tests inside files whose other tests are behavioural.
export const SOURCE_TEXT_TEST_NAMES = [
  'WinnerCard renders no entry field this contract does not cover',
  'every character reference unescapeMdx matches has an ESCAPES entry',
  'every ESCAPES entry is reachable from the unescapeMdx regex',
  'unescapeMdx decodes every entry in the ESCAPES table',
];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'tap',
  tap: {
    testFiles: [`tests/!(${SOURCE_TEXT_TEST_FILES.join('|')}).test.mjs`],
    nodeArgs: [
      // Node 23+ uses the spec reporter even off a TTY; Stryker parses TAP.
      '--test-reporter=tap',
      ...SOURCE_TEXT_TEST_NAMES.map(
        (name) => `--test-skip-pattern=/^${escapeRegExp(name)}$/`,
      ),
      '-r',
      '{{hookFile}}',
      '{{testFile}}',
    ],
  },
  coverageAnalysis: 'perTest',
  mutate: ['src/**/*.{js,mjs}', 'scripts/lib/**/*.mjs'],
  concurrency: 4,
  reporters: ['clear-text', 'progress', 'html', 'json'],
  // `break` fails the run below this mutation score. It was set from the full
  // baseline on main (83.81% when the gate was added) and must never sit above
  // the score main actually has.
  thresholds: { high: 90, low: 83, break: 83 },
};
