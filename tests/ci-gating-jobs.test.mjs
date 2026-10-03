// Guards the one property that makes every other gate in this repository
// worth running: that a failing gate actually fails its job.
//
// `.github/workflows/ci.yml` is the only `pull_request`-triggered workflow, so
// its `validate`, `lint` and `e2e` jobs are the entire pre-merge gate. Adding
// `continue-on-error: true` to any of them leaves every step running and every
// step reporting, and makes the job report success regardless. The same line on
// the `Run unit tests with coverage` step discards the unit suite and all four
// coverage thresholds on its own.
//
// Nothing else in the suite sees that. tests/coverage-gate-thresholds.test.mjs
// pins the threshold values and that ci.yml runs the gate command; both survive
// the exit code being ignored. tests/workflow-scripts.test.mjs asks whether a
// command is *run* by some workflow, and `continue-on-error` does not stop it
// being run. Its `browser coverage is isolated in a visible non-gating job`
// test asserts the relationship in one direction only — that `e2e-coverage`
// *is* opted out — and says nothing about the jobs that must not be.
//
// The allowlist below follows the FLOORS convention in
// coverage-gate-thresholds.test.mjs: a legitimate future non-gating job stays
// possible, but it has to be argued for here rather than slipped in as one line
// of YAML. The staleness guard forces an entry to be deleted once its job stops
// opting out, so the allowlist cannot quietly outlive the exemption.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workflowDir = join(repoRoot, '.github', 'workflows');

// `<workflow>#<job>` → why that job is allowed to swallow its own failure.
const NON_GATING_JOBS = new Map([
  [
    'ci.yml#e2e-coverage',
    'Browser coverage is published for information only; the required signal ' +
      'is the separate e2e job. Pinned from the other side by the "browser ' +
      'coverage is isolated in a visible non-gating job" test in ' +
      'tests/workflow-scripts.test.mjs.',
  ],
]);

// Jobs of ci.yml that are the pull_request gate. Named rather than derived so
// that deleting one fails as loudly as disarming one.
const REQUIRED_CI_JOBS = ['validate', 'lint', 'e2e'];

const workflowFiles = readdirSync(workflowDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const workflows = new Map(
  workflowFiles.map((file) => [
    file,
    parse(readFileSync(join(workflowDir, file), 'utf8')),
  ]),
);

// A `continue-on-error` is "declared" unless it is pinned off. The field
// accepts an expression, so anything that is not literally false — including
// `${{ ... }}`, which can evaluate to true at run time — counts as opting out.
function optsOutOfFailure(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  return String(value).trim().toLowerCase() !== 'false';
}

// The three scanners below take the parsed workflows as an argument rather
// than closing over the repository's own, so the violation each one exists to
// report can be exercised against a fixture. A guard whose failure path never
// runs is a guard nobody has checked.
function jobEntries(parsedWorkflows) {
  const entries = [];
  for (const [file, workflow] of parsedWorkflows) {
    for (const [name, job] of Object.entries(workflow?.jobs ?? {})) {
      entries.push({ key: `${file}#${name}`, file, name, job });
    }
  }
  return entries;
}

function optedOutJobs(parsedWorkflows) {
  return jobEntries(parsedWorkflows)
    .filter(({ job }) => optsOutOfFailure(job?.['continue-on-error']))
    .map(({ key }) => key)
    .sort();
}

function suppressingSteps(parsedWorkflows, allowlist) {
  const offenders = [];
  for (const { key, job } of jobEntries(parsedWorkflows)) {
    if (allowlist.has(key)) continue;
    for (const step of job?.steps ?? []) {
      if (!optsOutOfFailure(step?.['continue-on-error'])) continue;
      offenders.push(`${key} → ${step.name ?? step.uses ?? step.run ?? '?'}`);
    }
  }
  return offenders;
}

function staleAllowlistEntries(parsedWorkflows, allowlist) {
  const stale = [];
  for (const key of allowlist.keys()) {
    const [file, name] = key.split('#');
    const job = parsedWorkflows.get(file)?.jobs?.[name];
    if (!job) {
      stale.push(`${key} (no such job)`);
      continue;
    }
    if (!optsOutOfFailure(job['continue-on-error'])) {
      stale.push(`${key} (no longer opts out — delete this entry)`);
    }
  }
  return stale;
}

// Smallest shape the scanners read: one workflow, one job, optional steps.
function fixture(jobs) {
  return new Map([['fixture.yml', { jobs }]]);
}

test('every workflow parses and ci.yml still defines its gating jobs', () => {
  assert.ok(
    workflowFiles.length > 0,
    'no workflows found under .github/workflows',
  );

  const ci = workflows.get('ci.yml');
  assert.ok(ci, 'ci.yml is missing; it is the only pull_request gate');
  assert.deepEqual(
    Object.keys(ci.on ?? ci.true ?? {}).includes('pull_request'),
    true,
    'ci.yml must stay triggered by pull_request',
  );

  const missing = REQUIRED_CI_JOBS.filter((name) => !ci.jobs?.[name]);
  assert.deepEqual(missing, [], 'gating jobs removed from ci.yml');
});

test('only allowlisted jobs opt out of failing', () => {
  assert.deepEqual(
    optedOutJobs(workflows),
    [...NON_GATING_JOBS.keys()].sort(),
    'a job gained or lost continue-on-error; a gating job that swallows its ' +
      'own failure reports success no matter what its steps do',
  );
});

test("ci.yml's gating jobs are gating", () => {
  // Redundant with the allowlist comparison by construction, but it names the
  // three jobs explicitly so the failure message points straight at the gate
  // that was disarmed rather than at a set difference.
  const ci = workflows.get('ci.yml');
  for (const name of REQUIRED_CI_JOBS) {
    assert.equal(
      optsOutOfFailure(ci.jobs[name]?.['continue-on-error']),
      false,
      `ci.yml job "${name}" must fail the run when it fails`,
    );
  }
});

test('no step inside a gating job suppresses its own failure', () => {
  // A step-level opt-out is the narrower version of the same hole: one line on
  // "Run unit tests with coverage" discards the unit suite and all four
  // coverage thresholds while the job still reports success.
  assert.deepEqual(
    suppressingSteps(workflows, NON_GATING_JOBS),
    [],
    'steps of gating jobs that ignore failure',
  );
});

test('the non-gating allowlist does not outlive its jobs', () => {
  for (const [key, reason] of NON_GATING_JOBS) {
    assert.ok(
      typeof reason === 'string' && reason.length > 0,
      `allowlist entry ${key} must record why the job is exempt`,
    );
  }
  assert.deepEqual(
    staleAllowlistEntries(workflows, NON_GATING_JOBS),
    [],
    'stale entries in NON_GATING_JOBS',
  );
});

test('optsOutOfFailure reads an absent, pinned-off and expression value', () => {
  // `continue-on-error` accepts an expression, so only a literal false is a
  // guarantee. Anything else can evaluate to true at run time and has to count
  // as opting out, or the guard is bypassed by writing `${{ true }}`.
  assert.equal(optsOutOfFailure(undefined), false);
  assert.equal(optsOutOfFailure(null), false);
  assert.equal(optsOutOfFailure(false), false);
  assert.equal(optsOutOfFailure('false'), false);
  assert.equal(optsOutOfFailure(' FALSE '), false);
  assert.equal(optsOutOfFailure(true), true);
  assert.equal(optsOutOfFailure("${{ github.event_name == 'push' }}"), true);
});

test('optedOutJobs reports a job that gained continue-on-error', () => {
  assert.deepEqual(optedOutJobs(fixture({ gate: {} })), []);
  assert.deepEqual(
    optedOutJobs(fixture({ gate: { 'continue-on-error': true }, other: {} })),
    ['fixture.yml#gate'],
  );
});

test('suppressingSteps names the step, and skips allowlisted jobs', () => {
  const jobs = {
    gate: {
      steps: [
        { name: 'Install dependencies' },
        { name: 'Run unit tests with coverage', 'continue-on-error': true },
        { uses: 'actions/upload-artifact@v7', 'continue-on-error': 'true' },
        { run: 'npm run build', 'continue-on-error': true },
        { 'continue-on-error': true },
      ],
    },
  };
  assert.deepEqual(suppressingSteps(fixture(jobs), new Map()), [
    'fixture.yml#gate → Run unit tests with coverage',
    'fixture.yml#gate → actions/upload-artifact@v7',
    'fixture.yml#gate → npm run build',
    'fixture.yml#gate → ?',
  ]);

  // An allowlisted job is non-gating as a whole, so its steps are its own
  // business; scanning them would force an exemption to be written twice.
  assert.deepEqual(
    suppressingSteps(fixture(jobs), new Map([['fixture.yml#gate', 'why']])),
    [],
  );

  // A job with no steps at all must not throw.
  assert.deepEqual(suppressingSteps(fixture({ gate: {} }), new Map()), []);
});

test('staleAllowlistEntries catches a deleted job and a revoked opt-out', () => {
  const allowlist = new Map([['fixture.yml#advisory', 'why']]);
  assert.deepEqual(
    staleAllowlistEntries(
      fixture({ advisory: { 'continue-on-error': true } }),
      allowlist,
    ),
    [],
  );
  assert.deepEqual(
    staleAllowlistEntries(fixture({ advisory: {} }), allowlist),
    ['fixture.yml#advisory (no longer opts out — delete this entry)'],
  );
  assert.deepEqual(staleAllowlistEntries(fixture({}), allowlist), [
    'fixture.yml#advisory (no such job)',
  ]);
});
