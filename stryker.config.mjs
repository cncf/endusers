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
  'coverage-report-file-region-floor',
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

// The `break` threshold applies to the pull_request lane, which mutates only
// the files a pull request changes and gates them. The workflow_dispatch lane
// mutates the whole tree for a maintainer who asks for the report (see
// .github/workflows/mutation.yml), so the standing backlog must not fail it:
// a red full-tree run gates nothing and trains everyone to ignore the lane
// (issue #1743). Actions sets GITHUB_EVENT_NAME on every run; a local run has
// no event name and keeps the gate.
export function breakThreshold(eventName) {
  return !eventName || eventName === 'pull_request' ? 90 : null;
}

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
  // Replacing an empty literal with `["Stryker was here"]` is the only mutation
  // of this kind that survives on main: every surviving instance was an
  // accumulator or fallback whose seed contents are unobservable. The mutants
  // that did pin behavior are already covered by the type checks and
  // assertions on the populated arrays, so the whole kind is excluded instead
  // of annotating each site.
  mutator: { excludedMutations: ['ArrayDeclaration'] },
  concurrency: 4,
  reporters: ['clear-text', 'progress', 'html', 'json'],
  // `break` fails the run below this mutation score. It was set from the full
  // baseline on main (83.81% when the gate was added; 96.24% after the
  // surviving-mutant backlog was cleared in #1788) and must never sit above
  // the score main actually has. The pull_request lane scores only the files a
  // change touches, so it also has to clear the weakest file on main.
  thresholds: {
    high: 95,
    low: 90,
    break: breakThreshold(process.env.GITHUB_EVENT_NAME),
  },
};
