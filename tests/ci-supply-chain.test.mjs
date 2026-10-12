// The workflow supply-chain contract, asserted over the real
// .github/workflows/** tree.
//
// The scanners live in ./helpers-ci-supply-chain.mjs and are pinned
// independently by ./ci-supply-chain-helpers.test.mjs: every workflow here is
// compliant and every retiring baseline below is empty, so nothing in this file
// executes a scanner's violation arm or a baseline guard's body. Driving them
// from there is what keeps a green run here evidence that the contract was
// checked rather than evidence that it found nothing to look at.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  actionsMissingVersionComment,
  blanketWriteScopes,
  credentialPersistingCheckouts,
  floatingRunnerBaselineProblems,
  floatingRunnerJobs,
  jobs,
  jobsWithUnconstrainedToken,
  jobsWithoutRunner,
  persistingCheckoutBaselineProblems,
  steps,
  timeoutBaselineProblems,
  timeoutFaults,
  triggers,
  unboundedJobs,
  unpinnedActions,
} from './helpers-ci-supply-chain.mjs';

const workflowDir = new URL('../.github/workflows/', import.meta.url).pathname;

const workflows = readdirSync(workflowDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => {
    const source = readFileSync(join(workflowDir, name), 'utf8');
    return { name, source, doc: parse(source) };
  });

test('every workflow parses and declares at least one job', () => {
  assert.ok(workflows.length > 0, 'no workflow files found');
  for (const { name, doc } of workflows) {
    assert.ok(doc && typeof doc === 'object', `${name}: did not parse`);
    assert.ok(jobs(doc).length > 0, `${name}: declares no jobs`);
  }
});

test('every third-party action is pinned to a full commit SHA', () => {
  const unpinned = unpinnedActions(workflows);
  assert.deepEqual(
    unpinned,
    [],
    `actions must be pinned to a 40-character commit SHA, not a tag or branch:\n${unpinned.join('\n')}`,
  );
});

test('every pinned action records the human-readable version in a comment', () => {
  const missing = actionsMissingVersionComment(workflows);
  assert.deepEqual(
    missing,
    [],
    `each SHA-pinned action needs a trailing '# vX' comment so the pin stays reviewable:\n${missing.join('\n')}`,
  );
});

test('every workflow constrains GITHUB_TOKEN permissions', () => {
  const unconstrained = jobsWithUnconstrainedToken(workflows);
  assert.deepEqual(
    unconstrained,
    [],
    `declare 'permissions:' at workflow or job level so GITHUB_TOKEN is not left at the repository default:\n${unconstrained.join('\n')}`,
  );
});

test('no workflow grants blanket write-all permissions', () => {
  const blanket = blanketWriteScopes(workflows);
  assert.deepEqual(
    blanket,
    [],
    `'permissions: write-all' defeats least privilege:\n${blanket.join('\n')}`,
  );
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

test('every checkout step disables credential persistence', () => {
  const offenders = credentialPersistingCheckouts(
    workflows,
    KNOWN_PERSISTING_CHECKOUTS,
  );
  assert.deepEqual(
    offenders,
    [],
    `actions/checkout must set 'persist-credentials: false' so GITHUB_TOKEN is not left in .git/config:\n${offenders.join('\n')}`,
  );
});

test('the persist-credentials baseline retires itself', () => {
  const problems = persistingCheckoutBaselineProblems(
    workflows,
    KNOWN_PERSISTING_CHECKOUTS,
  );
  assert.deepEqual(problems, [], problems.join('\n'));
});

// A job without `timeout-minutes` inherits GitHub's 6-hour default. The commands
// these workflows run are network-bound -- markdown-link-check walks every link
// in every root Markdown file, and the scheduled jobs call the GitHub API -- so
// an unreachable host makes a step hang rather than fail, and the job then holds
// a runner for six hours. Only deploy-gh-pages declares a concurrency group, so
// the next run does not supersede a stuck one either.
//
// KNOWN_UNBOUNDED_JOBS is a retiring baseline, not an allowance: it recorded
// the jobs unbounded as of #743, and the companion test below fails once an
// entry gains a timeout, so bounding a job forces its exception to be removed
// in the same change. The baseline retired fully in #969: every boundable job
// now declares timeout-minutes, and this set stays empty so the gap cannot
// reopen silently.
const KNOWN_UNBOUNDED_JOBS = new Set([]);

test('every workflow job bounds its runtime with timeout-minutes', () => {
  const unbounded = unboundedJobs(workflows, KNOWN_UNBOUNDED_JOBS);
  assert.deepEqual(
    unbounded,
    [],
    `declare 'timeout-minutes:' on each job so a hung step cannot hold a runner for the 6-hour default:\n${unbounded.join('\n')}`,
  );
});

test('every declared timeout-minutes is a positive number below the 6-hour default', () => {
  const faults = timeoutFaults(workflows);
  assert.deepEqual(faults, [], faults.join('\n'));
});

test('the timeout-minutes baseline retires itself', () => {
  const problems = timeoutBaselineProblems(workflows, KNOWN_UNBOUNDED_JOBS);
  assert.deepEqual(problems, [], problems.join('\n'));
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
const KNOWN_FLOATING_RUNNERS = new Set([]);

test('every job pins a versioned runner image', () => {
  const floating = floatingRunnerJobs(workflows, KNOWN_FLOATING_RUNNERS);
  assert.deepEqual(
    floating,
    [],
    `name a versioned runner image (for example 'ubuntu-24.04') so a GitHub image rotation cannot change the build without a commit:\n${floating.join('\n')}`,
  );
});

test('every non-reusable job declares a runner', () => {
  const missing = jobsWithoutRunner(workflows);
  assert.deepEqual(
    missing,
    [],
    `declare 'runs-on:' on each job so the runner-pinning contract cannot be sidestepped by omitting it:\n${missing.join('\n')}`,
  );
});

test('the runner pinning baseline retires itself', () => {
  const problems = floatingRunnerBaselineProblems(
    workflows,
    KNOWN_FLOATING_RUNNERS,
  );
  assert.deepEqual(problems, [], problems.join('\n'));
});
