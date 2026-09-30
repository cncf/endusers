import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const workflowDir = new URL('../.github/workflows/', import.meta.url).pathname;

const workflows = readdirSync(workflowDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => {
    const source = readFileSync(join(workflowDir, name), 'utf8');
    return { name, source, doc: parse(source) };
  });

// `on` is parsed as the boolean true by YAML 1.1 compatibility rules, so the
// trigger block is read back through both keys.
function triggers(doc) {
  const on = doc.on ?? doc[true];
  if (!on) return [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on);
}

function jobs(doc) {
  return Object.entries(doc.jobs ?? {});
}

function steps(doc) {
  return jobs(doc).flatMap(([jobName, job]) =>
    (job?.steps ?? []).map((step, index) => ({
      jobName,
      index,
      step,
    })),
  );
}

const SHA_PINNED = /^[^@]+@[0-9a-f]{40}$/;

test('every workflow parses and declares at least one job', () => {
  assert.ok(workflows.length > 0, 'no workflow files found');
  for (const { name, doc } of workflows) {
    assert.ok(doc && typeof doc === 'object', `${name}: did not parse`);
    assert.ok(jobs(doc).length > 0, `${name}: declares no jobs`);
  }
});

test('every third-party action is pinned to a full commit SHA', () => {
  const unpinned = [];
  for (const { name, doc } of workflows) {
    for (const { jobName, step } of steps(doc)) {
      const uses = step?.uses;
      if (!uses) continue;
      // Local composite actions and reusable workflows in this repository are
      // resolved from the checked-out tree, so they carry no external ref.
      if (uses.startsWith('./')) continue;
      if (uses.startsWith('docker://')) continue;
      if (!SHA_PINNED.test(uses)) {
        unpinned.push(`${name} (${jobName}): ${uses}`);
      }
    }
  }
  assert.deepEqual(
    unpinned,
    [],
    `actions must be pinned to a 40-character commit SHA, not a tag or branch:\n${unpinned.join('\n')}`,
  );
});

test('every pinned action records the human-readable version in a comment', () => {
  const missing = [];
  for (const { name, source } of workflows) {
    for (const line of source.split('\n')) {
      const match = line.match(/^\s*(?:-\s*)?uses:\s*(\S+)/);
      if (!match) continue;
      const uses = match[1];
      if (uses.startsWith('./') || uses.startsWith('docker://')) continue;
      if (!/#\s*\S/.test(line)) {
        missing.push(`${name}: ${uses}`);
      }
    }
  }
  assert.deepEqual(
    missing,
    [],
    `each SHA-pinned action needs a trailing '# vX' comment so the pin stays reviewable:\n${missing.join('\n')}`,
  );
});

test('every workflow constrains GITHUB_TOKEN permissions', () => {
  const unconstrained = [];
  for (const { name, doc } of workflows) {
    if (doc.permissions) continue;
    for (const [jobName, job] of jobs(doc)) {
      if (!job?.permissions) unconstrained.push(`${name}: job ${jobName}`);
    }
  }
  assert.deepEqual(
    unconstrained,
    [],
    `declare 'permissions:' at workflow or job level so GITHUB_TOKEN is not left at the repository default:\n${unconstrained.join('\n')}`,
  );
});

test('no workflow grants blanket write-all permissions', () => {
  for (const { name, doc } of workflows) {
    const scopes = [
      doc.permissions,
      ...jobs(doc).map(([, job]) => job?.permissions),
    ];
    for (const scope of scopes) {
      assert.notEqual(
        scope,
        'write-all',
        `${name}: 'permissions: write-all' defeats least privilege`,
      );
    }
  }
});

test('no workflow uses the pull_request_target trigger', () => {
  for (const { name, doc } of workflows) {
    assert.ok(
      !triggers(doc).includes('pull_request_target'),
      `${name}: pull_request_target runs with a writable token in the base repository context`,
    );
  }
});

test('every Node setup step pins the same Node major version', () => {
  const versions = new Set();
  for (const { name, doc } of workflows) {
    for (const { jobName, step } of steps(doc)) {
      if (!step?.uses?.startsWith('actions/setup-node@')) continue;
      const declared = step.with?.['node-version'];
      assert.ok(
        declared !== undefined,
        `${name} (${jobName}): setup-node must declare node-version rather than inherit a default`,
      );
      const raw = String(declared);
      const fromEnv = raw.match(
        /\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/,
      );
      if (fromEnv) {
        const resolved = doc.env?.[fromEnv[1]];
        assert.ok(
          resolved !== undefined,
          `${name} (${jobName}): node-version references env.${fromEnv[1]}, which the workflow does not define`,
        );
        versions.add(String(resolved).split('.')[0]);
      } else {
        versions.add(raw.split('.')[0]);
      }
    }
  }
  assert.ok(versions.size > 0, 'no setup-node step found in any workflow');
  assert.equal(
    versions.size,
    1,
    `workflows must build on one Node major version, found: ${[...versions].sort().join(', ')}`,
  );
});

// Checkout leaves GITHUB_TOKEN in .git/config unless credential persistence is
// disabled, so every later step in the job -- including `npm ci` and any build
// that executes third-party dependency code -- can read a token scoped to this
// repository. All workflows now opt out (see #598, fixed in #657).
//
// KNOWN_PERSISTING_CHECKOUTS is a retiring baseline, not an allowance. The
// companion test below fails once an entry becomes compliant, so fixing a
// workflow forces the exception to be removed in the same change.
const KNOWN_PERSISTING_CHECKOUTS = new Set([]);

function checkoutSteps(doc) {
  return steps(doc).filter(({ step }) =>
    step?.uses?.startsWith('actions/checkout@'),
  );
}

function persistsCredentials(step) {
  return step?.with?.['persist-credentials'] !== false;
}

test('every checkout step disables credential persistence', () => {
  const offenders = [];
  for (const { name, doc } of workflows) {
    if (KNOWN_PERSISTING_CHECKOUTS.has(name)) continue;
    for (const { jobName, index, step } of checkoutSteps(doc)) {
      if (persistsCredentials(step)) {
        offenders.push(`${name} (${jobName}, step ${index})`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `actions/checkout must set 'persist-credentials: false' so GITHUB_TOKEN is not left in .git/config:\n${offenders.join('\n')}`,
  );
});

test('the persist-credentials baseline retires itself', () => {
  for (const name of KNOWN_PERSISTING_CHECKOUTS) {
    const entry = workflows.find((workflow) => workflow.name === name);
    assert.ok(
      entry,
      `${name} is listed as a known persist-credentials gap but no such workflow exists; remove the entry`,
    );
    const offending = checkoutSteps(entry.doc).filter(({ step }) =>
      persistsCredentials(step),
    );
    assert.notEqual(
      offending.length,
      0,
      `${name} now sets persist-credentials: false on every checkout; remove it from KNOWN_PERSISTING_CHECKOUTS so the gap cannot reopen`,
    );
  }
});

// A job without `timeout-minutes` inherits GitHub's 6-hour default. The commands
// these workflows run are network-bound -- markdown-link-check walks every link
// in every root Markdown file, and the scheduled jobs call the GitHub API -- so
// an unreachable host makes a step hang rather than fail, and the job then holds
// a runner for six hours. Only deploy-gh-pages declares a concurrency group, so
// the next run does not supersede a stuck one either.
//
// KNOWN_UNBOUNDED_JOBS is a retiring baseline, not an allowance: it records the
// jobs unbounded as of #743. The companion test below fails once an entry
// gains a timeout, so bounding a job forces its exception to be removed in the
// same change.
const KNOWN_UNBOUNDED_JOBS = new Set([
  'ci.yml: validate',
  'ci.yml: lint',
  'codeql.yml: analyze',
  'create-milestones.yml: create-milestones',
  'deploy-gh-pages.yml: build',
  'deploy-gh-pages.yml: deploy',
  'import-architectures.yml: import',
  'pr-queue-hygiene.yml: hygiene',
  'refresh-community-people.yml: refresh',
  'refresh-radar-reports.yml: refresh',
]);

// `timeout-minutes` is not accepted on a job that delegates to a reusable
// workflow, so those jobs are outside this contract.
function boundableJobs(doc) {
  return jobs(doc).filter(([, job]) => !job?.uses);
}

function timeoutOf(job) {
  return job?.['timeout-minutes'];
}

test('every workflow job bounds its runtime with timeout-minutes', () => {
  const unbounded = [];
  for (const { name, doc } of workflows) {
    for (const [jobName, job] of boundableJobs(doc)) {
      const label = `${name}: ${jobName}`;
      if (KNOWN_UNBOUNDED_JOBS.has(label)) continue;
      if (timeoutOf(job) === undefined) unbounded.push(label);
    }
  }
  assert.deepEqual(
    unbounded,
    [],
    `declare 'timeout-minutes:' on each job so a hung step cannot hold a runner for the 6-hour default:\n${unbounded.join('\n')}`,
  );
});

// Describes why a declared timeout-minutes value is unusable, or null when the
// value is fine. A quoted YAML scalar parses as a string and a fractional value
// is silently floored by the runner, so neither is accepted; a value at or above
// 360 restates the 6-hour default this contract exists to replace.
function timeoutProblem(declared) {
  if (typeof declared !== 'number') {
    return `timeout-minutes must be a number, got ${JSON.stringify(declared)}`;
  }
  if (!Number.isInteger(declared) || declared <= 0) {
    return `timeout-minutes must be a positive whole number of minutes, got ${declared}`;
  }
  if (declared >= 360) {
    return `timeout-minutes of ${declared} is at or above the 6-hour default it exists to replace`;
  }
  return null;
}

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

test('every declared timeout-minutes is a positive number below the 6-hour default', () => {
  const faults = [];
  for (const { name, doc } of workflows) {
    for (const [jobName, job] of boundableJobs(doc)) {
      const declared = timeoutOf(job);
      if (declared === undefined) continue;
      const problem = timeoutProblem(declared);
      if (problem) faults.push(`${name} (${jobName}): ${problem}`);
    }
  }
  assert.deepEqual(faults, [], faults.join('\n'));
});

test('the timeout-minutes baseline retires itself', () => {
  for (const label of KNOWN_UNBOUNDED_JOBS) {
    const [name, jobName] = label.split(': ');
    const entry = workflows.find((workflow) => workflow.name === name);
    assert.ok(
      entry,
      `${label} is listed as a known timeout gap but ${name} does not exist; remove the entry`,
    );
    const job = boundableJobs(entry.doc).find(([id]) => id === jobName);
    assert.ok(
      job,
      `${label} is listed as a known timeout gap but ${name} declares no boundable job '${jobName}'; remove the entry`,
    );
    assert.equal(
      timeoutOf(job[1]),
      undefined,
      `${label} now declares timeout-minutes; remove it from KNOWN_UNBOUNDED_JOBS so the gap cannot reopen`,
    );
  }
});

// A `*-latest` runner label is re-pointed by GitHub at a new image on its own
// schedule, so a workflow that names one is rebuilt on an OS the repository
// never chose: the toolchain under it (glibc, the Playwright system
// dependencies installed by `playwright install --with-deps`, the preinstalled
// package set) changes without a commit, and the resulting break lands on an
// unrelated PR. Every other job in this repository pins `ubuntu-24.04`, which
// is what makes a green run reproducible from the same tree.
//
// KNOWN_FLOATING_RUNNERS is a retiring baseline, not an allowance: it records
// the jobs still on a floating label. The companion test below fails once an
// entry gains a pinned runner, so pinning a job forces its exception to be
// removed in the same change.
const KNOWN_FLOATING_RUNNERS = new Set(['refresh-radar-reports.yml: refresh']);

// Only jobs that request a GitHub-hosted runner directly are in scope: a job
// delegating to a reusable workflow declares no `runs-on`, and a self-hosted
// label set is the repository's own choice of image rather than a floating one.
function runnerLabels(job) {
  const declared = job?.['runs-on'];
  if (declared === undefined) return [];
  if (typeof declared === 'string') return [declared];
  if (Array.isArray(declared)) return declared;
  if (Array.isArray(declared?.labels)) return declared.labels;
  return [declared];
}

// Names the reason a runner label is unpinned, or null when the label is fine.
// A non-string label cannot be checked for a version, and `self-hosted` opts the
// job out of GitHub's image rotation entirely.
function floatingRunnerProblem(labels) {
  if (labels.some((label) => label === 'self-hosted')) return null;
  const faults = labels.filter(
    (label) => typeof label !== 'string' || /-latest$/.test(label),
  );
  if (faults.length === 0) return null;
  return `pins no runner image version: ${faults.map((label) => JSON.stringify(label)).join(', ')}`;
}

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

test('every job pins a versioned runner image', () => {
  const floating = [];
  for (const { name, doc } of workflows) {
    for (const [jobName, job] of jobs(doc)) {
      const label = `${name}: ${jobName}`;
      if (KNOWN_FLOATING_RUNNERS.has(label)) continue;
      const problem = floatingRunnerProblem(runnerLabels(job));
      if (problem) floating.push(`${label} ${problem}`);
    }
  }
  assert.deepEqual(
    floating,
    [],
    `name a versioned runner image (for example 'ubuntu-24.04') so a GitHub image rotation cannot change the build without a commit:\n${floating.join('\n')}`,
  );
});

test('every non-reusable job declares a runner', () => {
  const missing = [];
  for (const { name, doc } of workflows) {
    for (const [jobName, job] of jobs(doc)) {
      if (job?.uses) continue;
      if (runnerLabels(job).length === 0) missing.push(`${name}: ${jobName}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `declare 'runs-on:' on each job so the runner-pinning contract cannot be sidestepped by omitting it:\n${missing.join('\n')}`,
  );
});

test('the runner pinning baseline retires itself', () => {
  for (const label of KNOWN_FLOATING_RUNNERS) {
    const [name, jobName] = label.split(': ');
    const entry = workflows.find((workflow) => workflow.name === name);
    assert.ok(
      entry,
      `${label} is listed as a known floating-runner gap but ${name} does not exist; remove the entry`,
    );
    const job = jobs(entry.doc).find(([id]) => id === jobName);
    assert.ok(
      job,
      `${label} is listed as a known floating-runner gap but ${name} declares no job '${jobName}'; remove the entry`,
    );
    assert.notEqual(
      floatingRunnerProblem(runnerLabels(job[1])),
      null,
      `${label} now pins a versioned runner image; remove it from KNOWN_FLOATING_RUNNERS so the gap cannot reopen`,
    );
  }
});
