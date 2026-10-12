// Unit coverage for the scanners in ./helpers-ci-supply-chain.mjs.
//
// ./ci-supply-chain.test.mjs drives these scanners over the real
// .github/workflows/** tree only, and that tree is fully compliant: no action
// is unpinned, no job is missing `permissions:` or `timeout-minutes`, no
// checkout persists credentials, no runner label floats, and all three
// retiring baselines are empty. So every offence-recording arm and every
// baseline-guard body is unreachable from there, and a scanner that stopped
// detecting -- a swallowed step list, a regex that stopped matching -- would
// leave the contract green over a tree it was no longer checking.
//
// These tests supply the offending documents the repository does not, so the
// contract's own machinery is pinned independently of what it happens to run
// against.

import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'yaml';

import {
  actionsMissingVersionComment,
  blanketWriteScopes,
  boundableJobs,
  checkoutSteps,
  credentialPersistingCheckouts,
  floatingRunnerBaselineProblems,
  floatingRunnerJobs,
  floatingRunnerProblem,
  jobs,
  jobsWithUnconstrainedToken,
  jobsWithoutRunner,
  persistingCheckoutBaselineProblems,
  persistsCredentials,
  runnerLabels,
  steps,
  timeoutBaselineProblems,
  timeoutFaults,
  timeoutOf,
  timeoutProblem,
  triggers,
  unboundedJobs,
  unpinnedActions,
} from './helpers-ci-supply-chain.mjs';

const SHA = 'a'.repeat(40);

// The scanners take the same `{ name, source, doc }` records the contract
// builds from disk, so the fixtures are written as YAML and parsed the same
// way rather than hand-built as objects.
function workflow(name, source) {
  return { name, source, doc: parse(source) };
}

const NONE = new Set([]);

test('triggers reads the block back through both of YAML\u2019s "on" keys', () => {
  // `on:` parses as the boolean true under YAML 1.1 compatibility rules, which
  // is the whole reason this reader exists.
  assert.deepEqual(triggers(parse('on:\n  push:\n    branches: [main]\n')), [
    'push',
  ]);
  assert.deepEqual(triggers(parse('on: push\n')), ['push']);
  assert.deepEqual(triggers(parse('on: [push, pull_request]\n')), [
    'push',
    'pull_request',
  ]);
  assert.deepEqual(
    triggers(parse('"on":\n  schedule:\n    - cron: "0 0 * * *"\n')),
    ['schedule'],
  );
  assert.deepEqual(triggers({}), []);
  assert.deepEqual(triggers({ on: null }), []);
});

test('jobs and steps tolerate a workflow that declares neither', () => {
  assert.deepEqual(jobs({}), []);
  assert.deepEqual(steps({}), []);
  assert.deepEqual(steps({ jobs: { build: null } }), []);
  assert.deepEqual(steps({ jobs: { build: {} } }), []);
  assert.deepEqual(
    steps({
      jobs: { build: { steps: [{ run: 'a' }, { run: 'b' }] } },
    }).map(({ jobName, index }) => `${jobName}:${index}`),
    ['build:0', 'build:1'],
  );
});

test('unpinnedActions names every action not pinned to a 40-character SHA', () => {
  const offending = workflow(
    'bad.yml',
    `jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@main
      - uses: actions/cache@${SHA.slice(0, 39)}
`,
  );
  assert.deepEqual(unpinnedActions([offending]), [
    'bad.yml (build): actions/checkout@v4',
    'bad.yml (build): actions/setup-node@main',
    `bad.yml (build): actions/cache@${SHA.slice(0, 39)}`,
  ]);
});

test('unpinnedActions exempts local actions, docker refs and steps that run a command', () => {
  const fine = workflow(
    'fine.yml',
    `jobs:
  build:
    steps:
      - run: npm ci
      - uses: ./.github/actions/setup
      - uses: docker://alpine:3.20
      - uses: actions/checkout@${SHA}
`,
  );
  assert.deepEqual(unpinnedActions([fine]), []);
});

test('actionsMissingVersionComment reads the raw source, not the parsed document', () => {
  // The trailing `# v4` is a YAML comment, so it is gone by the time the
  // document is parsed; this scanner is the only one that must work from text.
  const offending = workflow(
    'bad.yml',
    `jobs:
  build:
    steps:
      - uses: actions/checkout@${SHA}
      - uses: actions/setup-node@${SHA} # v4
      - uses: actions/cache@${SHA} #
`,
  );
  assert.deepEqual(actionsMissingVersionComment([offending]), [
    `bad.yml: actions/checkout@${SHA}`,
    `bad.yml: actions/cache@${SHA}`,
  ]);
});

test('actionsMissingVersionComment ignores lines that declare no action', () => {
  const fine = workflow(
    'fine.yml',
    `name: "uses: not really"
jobs:
  build:
    steps:
      - run: 'echo "uses: actions/checkout@v4"'
      - uses: ./.github/actions/setup
      - uses: docker://alpine:3.20
`,
  );
  assert.deepEqual(actionsMissingVersionComment([fine]), []);
});

test('jobsWithUnconstrainedToken reports per job, and a workflow-level grant covers them all', () => {
  const offending = workflow(
    'bad.yml',
    `jobs:
  build:
    runs-on: ubuntu-24.04
  deploy:
    permissions:
      contents: read
    runs-on: ubuntu-24.04
  lint:
    runs-on: ubuntu-24.04
`,
  );
  assert.deepEqual(jobsWithUnconstrainedToken([offending]), [
    'bad.yml: job build',
    'bad.yml: job lint',
  ]);

  const covered = workflow(
    'fine.yml',
    `permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-24.04
`,
  );
  assert.deepEqual(jobsWithUnconstrainedToken([covered]), []);
});

test('blanketWriteScopes catches write-all at either level', () => {
  const atWorkflow = workflow(
    'workflow.yml',
    `permissions: write-all
jobs:
  build:
    runs-on: ubuntu-24.04
`,
  );
  const atJob = workflow(
    'job.yml',
    `jobs:
  build:
    permissions: write-all
    runs-on: ubuntu-24.04
`,
  );
  const fine = workflow(
    'fine.yml',
    `permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-24.04
`,
  );
  assert.deepEqual(blanketWriteScopes([atWorkflow, atJob, fine]), [
    'workflow.yml',
    'job.yml',
  ]);
});

test('checkoutSteps and persistsCredentials read the opt-out exactly', () => {
  const doc = parse(
    `jobs:
  build:
    steps:
      - uses: actions/setup-node@${SHA}
      - uses: actions/checkout@${SHA}
      - uses: actions/checkout@${SHA}
        with:
          persist-credentials: false
`,
  );
  assert.equal(checkoutSteps(doc).length, 2);
  // Only an explicit `false` opts out: an absent `with:` block, an absent key
  // and a truthy value all leave the token in .git/config.
  assert.equal(persistsCredentials(undefined), true);
  assert.equal(persistsCredentials({}), true);
  assert.equal(persistsCredentials({ with: {} }), true);
  assert.equal(
    persistsCredentials({ with: { 'persist-credentials': true } }),
    true,
  );
  assert.equal(
    persistsCredentials({ with: { 'persist-credentials': false } }),
    false,
  );
});

test('credentialPersistingCheckouts names the job and step index, and honours the baseline', () => {
  const offending = workflow(
    'bad.yml',
    `jobs:
  build:
    steps:
      - run: echo hi
      - uses: actions/checkout@${SHA}
  deploy:
    steps:
      - uses: actions/checkout@${SHA}
        with:
          persist-credentials: false
`,
  );
  assert.deepEqual(credentialPersistingCheckouts([offending], NONE), [
    'bad.yml (build, step 1)',
  ]);
  assert.deepEqual(
    credentialPersistingCheckouts([offending], new Set(['bad.yml'])),
    [],
  );
});

test('persistingCheckoutBaselineProblems retires an entry that is fixed or gone', () => {
  const stillOffending = workflow(
    'offending.yml',
    `jobs:
  build:
    steps:
      - uses: actions/checkout@${SHA}
`,
  );
  const fixed = workflow(
    'fixed.yml',
    `jobs:
  build:
    steps:
      - uses: actions/checkout@${SHA}
        with:
          persist-credentials: false
`,
  );
  const workflows = [stillOffending, fixed];

  // An entry that still describes a real gap is the only one that stays.
  assert.deepEqual(
    persistingCheckoutBaselineProblems(workflows, new Set(['offending.yml'])),
    [],
  );
  assert.match(
    persistingCheckoutBaselineProblems(workflows, new Set(['fixed.yml']))[0],
    /now sets persist-credentials: false/,
  );
  assert.match(
    persistingCheckoutBaselineProblems(workflows, new Set(['gone.yml']))[0],
    /no such workflow exists/,
  );
});

test('boundableJobs excludes jobs that delegate to a reusable workflow', () => {
  const doc = parse(
    `jobs:
  build:
    runs-on: ubuntu-24.04
  call:
    uses: ./.github/workflows/other.yml
`,
  );
  assert.deepEqual(
    boundableJobs(doc).map(([name]) => name),
    ['build'],
  );
  assert.equal(timeoutOf(undefined), undefined);
  assert.equal(timeoutOf({ 'timeout-minutes': 10 }), 10);
});

test('unboundedJobs names each job without a timeout, and honours the baseline', () => {
  const offending = workflow(
    'bad.yml',
    `jobs:
  build:
    runs-on: ubuntu-24.04
  lint:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
  call:
    uses: ./.github/workflows/other.yml
`,
  );
  assert.deepEqual(unboundedJobs([offending], NONE), ['bad.yml: build']);
  assert.deepEqual(unboundedJobs([offending], new Set(['bad.yml: build'])), []);
});

test('timeoutProblem accepts usable values and names the fault in the rest', () => {
  for (const usable of [1, 15, 30, 359]) {
    assert.equal(timeoutProblem(usable), null, `${usable} should be usable`);
  }
  assert.match(timeoutProblem('30'), /must be a number/);
  assert.match(timeoutProblem(null), /must be a number/);
  assert.match(timeoutProblem(true), /must be a number/);
  assert.match(timeoutProblem(2.5), /positive whole number/);
  assert.match(timeoutProblem(0), /positive whole number/);
  assert.match(timeoutProblem(-5), /positive whole number/);
  assert.match(timeoutProblem(360), /6-hour default/);
  assert.match(timeoutProblem(600), /6-hour default/);
});

test('timeoutFaults reports only jobs that declared an unusable value', () => {
  const offending = workflow(
    'bad.yml',
    `jobs:
  quoted:
    timeout-minutes: "30"
  huge:
    timeout-minutes: 600
  fine:
    timeout-minutes: 10
  absent:
    runs-on: ubuntu-24.04
`,
  );
  assert.deepEqual(timeoutFaults([offending]), [
    'bad.yml (quoted): timeout-minutes must be a number, got "30"',
    'bad.yml (huge): timeout-minutes of 600 is at or above the 6-hour default it exists to replace',
  ]);
});

test('timeoutBaselineProblems retires an entry whose workflow, job or gap is gone', () => {
  const entry = workflow(
    'app.yml',
    `jobs:
  unbounded:
    runs-on: ubuntu-24.04
  bounded:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
  call:
    uses: ./.github/workflows/other.yml
`,
  );
  const workflows = [entry];

  assert.deepEqual(
    timeoutBaselineProblems(workflows, new Set(['app.yml: unbounded'])),
    [],
  );
  assert.match(
    timeoutBaselineProblems(workflows, new Set(['app.yml: bounded']))[0],
    /now declares timeout-minutes/,
  );
  // A reusable-workflow job is not boundable, so an entry naming one can never
  // retire on its own and has to be reported as unresolvable.
  assert.match(
    timeoutBaselineProblems(workflows, new Set(['app.yml: call']))[0],
    /declares no boundable job 'call'/,
  );
  assert.match(
    timeoutBaselineProblems(workflows, new Set(['gone.yml: build']))[0],
    /does not exist/,
  );
});

test('runnerLabels normalises every form runs-on can take', () => {
  assert.deepEqual(runnerLabels({}), []);
  assert.deepEqual(runnerLabels(undefined), []);
  assert.deepEqual(runnerLabels({ 'runs-on': 'ubuntu-24.04' }), [
    'ubuntu-24.04',
  ]);
  assert.deepEqual(runnerLabels({ 'runs-on': ['self-hosted', 'linux'] }), [
    'self-hosted',
    'linux',
  ]);
  assert.deepEqual(
    runnerLabels({ 'runs-on': { group: 'ci', labels: ['ubuntu-24.04'] } }),
    ['ubuntu-24.04'],
  );
  // A group without labels names no image, so the raw value is surfaced and the
  // contract below reports it rather than silently passing an empty list.
  assert.deepEqual(runnerLabels({ 'runs-on': { group: 'ci' } }), [
    { group: 'ci' },
  ]);
});

test('floatingRunnerProblem accepts pinned runners and names the fault in the rest', () => {
  assert.equal(floatingRunnerProblem(['ubuntu-24.04']), null);
  assert.equal(floatingRunnerProblem(['windows-2022']), null);
  assert.equal(floatingRunnerProblem(['self-hosted', 'linux']), null);
  assert.equal(floatingRunnerProblem([]), null);
  assert.match(floatingRunnerProblem(['ubuntu-latest']), /no runner image/);
  assert.match(floatingRunnerProblem(['macos-latest']), /no runner image/);
  assert.match(
    floatingRunnerProblem(['ubuntu-24.04', 'windows-latest']),
    /"windows-latest"/,
  );
  assert.match(floatingRunnerProblem([null]), /no runner image/);
  assert.match(floatingRunnerProblem([{ group: 'ci' }]), /no runner image/);
});

test('floatingRunnerJobs names each floating job, and honours the baseline', () => {
  const offending = workflow(
    'bad.yml',
    `jobs:
  floating:
    runs-on: ubuntu-latest
  pinned:
    runs-on: ubuntu-24.04
`,
  );
  assert.deepEqual(floatingRunnerJobs([offending], NONE), [
    'bad.yml: floating pins no runner image version: "ubuntu-latest"',
  ]);
  assert.deepEqual(
    floatingRunnerJobs([offending], new Set(['bad.yml: floating'])),
    [],
  );
});

test('jobsWithoutRunner catches an omitted runs-on but not a reusable-workflow job', () => {
  const offending = workflow(
    'bad.yml',
    `jobs:
  silent:
    steps:
      - run: npm ci
  call:
    uses: ./.github/workflows/other.yml
  pinned:
    runs-on: ubuntu-24.04
`,
  );
  assert.deepEqual(jobsWithoutRunner([offending]), ['bad.yml: silent']);
});

test('floatingRunnerBaselineProblems retires an entry whose workflow, job or gap is gone', () => {
  const entry = workflow(
    'app.yml',
    `jobs:
  floating:
    runs-on: ubuntu-latest
  pinned:
    runs-on: ubuntu-24.04
`,
  );
  const workflows = [entry];

  assert.deepEqual(
    floatingRunnerBaselineProblems(workflows, new Set(['app.yml: floating'])),
    [],
  );
  assert.match(
    floatingRunnerBaselineProblems(workflows, new Set(['app.yml: pinned']))[0],
    /now pins a versioned runner image/,
  );
  assert.match(
    floatingRunnerBaselineProblems(workflows, new Set(['app.yml: absent']))[0],
    /declares no job 'absent'/,
  );
  assert.match(
    floatingRunnerBaselineProblems(workflows, new Set(['gone.yml: build']))[0],
    /does not exist/,
  );
});
