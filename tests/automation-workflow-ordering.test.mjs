// Guards the ordering contract for workflows that generate data: regenerate,
// then format, then validate, then test. The existing wiring guards in
// workflow-scripts.test.mjs ask whether a gate is run by *some* workflow, and
// ci.yml runs every one of them, so those guards stay green no matter how the
// automation jobs are ordered. That is not enough cover, because the jobs that
// actually produce data never reach ci.yml: they open their pull requests with
// `peter-evans/create-pull-request` under `github.token`, and GitHub refuses to
// start `on: pull_request` runs for a token-authored pull request. The steps a
// generating workflow runs itself are therefore the only pre-merge gate its
// output ever passes, and the deploy job is the only post-merge one.
//
// The failures that follow are all silent. A generator that emits unformatted
// JSON produces a pull request no `check:format` ever reads. A unit suite run
// before the generator tests the old data and passes while the new data is
// broken. A dataset refreshed without its validator lands unchecked. A deploy
// job that runs part of the validator set publishes whatever the rest would
// have caught.
//
// Violations that exist today are recorded in KNOWN_ORDERING_VIOLATIONS with
// the issue tracking them, following the GATES_NOT_RUN_BY_CI convention in
// workflow-scripts.test.mjs: the contract binds any workflow added from here
// on, and the staleness guard at the bottom forces each entry to be deleted as
// its workflow is fixed, so the table cannot quietly outlive the problem.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  commitsGeneratedOutput,
  currentViolations,
  isGenerator,
  npmRunTargets,
  orderedTargets,
  publishesSite,
  validatorFor,
} from './helpers-workflow-ordering.mjs';
import { loadWorkflows, repoRoot } from './helpers-workflows.mjs';

const scripts =
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).scripts ??
  {};

// Every violation the repository is currently carrying, keyed
// `<workflow>:<rule>`. Delete an entry when its workflow is fixed; the
// staleness guard below fails if one is left behind.
const KNOWN_ORDERING_VIOLATIONS = new Map([]);

// The detectors live in ./helpers-workflow-ordering.mjs so they can be driven
// over violating fixtures as well as over this tree. The repository complies,
// so every reporting arm in them is unreachable from here;
// ./workflow-ordering-helpers.test.mjs is what proves they can still fire.
const workflows = loadWorkflows();

function violationsHere() {
  return currentViolations(workflows, scripts);
}

function unrecorded(rule) {
  return [...violationsHere()]
    .filter(([key]) => key.endsWith(`:${rule}`))
    .filter(([key]) => !KNOWN_ORDERING_VIOLATIONS.has(key))
    .map(([key, detail]) => `${key} (${detail})`)
    .sort();
}

test('the unit suite runs after the generators, not before them', () => {
  assert.deepEqual(
    unrecorded('unit-suite-after-generators'),
    [],
    'workflows running the unit suite before the data it guards is ' +
      'regenerated; move the suite after the generator steps',
  );
});

test('generated output is formatted before it is committed', () => {
  assert.deepEqual(
    unrecorded('format-generated-output'),
    [],
    'workflows opening a pull request out of generated files without ' +
      'running check:format or fix:format after generating them',
  );
});

test('every regenerated dataset is validated in the same job', () => {
  assert.deepEqual(
    unrecorded('validate-generated-dataset'),
    [],
    'workflows regenerating a dataset without running its validator ' +
      'afterwards',
  );
});

test('the publishing workflow runs every validator gate', () => {
  assert.deepEqual(
    unrecorded('publish-runs-every-gate'),
    [],
    'the deploy job publishes data that only it can gate, because ' +
      'token-authored automation pull requests never trigger ci.yml',
  );
});

test('every recorded violation still describes a real one', () => {
  // Without this the table would absorb the fix as well as the fault: an
  // entry left behind after its workflow was corrected would keep excusing a
  // regression that reintroduced it.
  const current = violationsHere();
  const stale = [...KNOWN_ORDERING_VIOLATIONS.keys()]
    .filter((key) => !current.has(key))
    .sort();
  assert.deepEqual(
    stale,
    [],
    'KNOWN_ORDERING_VIOLATIONS entries whose workflow no longer violates the ' +
      'contract; delete these entries',
  );
});

test('every recorded violation carries a reason', () => {
  const unexplained = [...KNOWN_ORDERING_VIOLATIONS.entries()]
    .filter(([, reason]) => typeof reason !== 'string' || reason.trim() === '')
    .map(([key]) => key)
    .sort();
  assert.deepEqual(
    unexplained,
    [],
    'violations recorded without saying what is wrong or what tracks it',
  );
});

test('the generator and validator detection is not vacuous', () => {
  // Pins the guards above to evidence rather than to spelling. Every check in
  // this file is driven by these two predicates, so if either stopped matching
  // anything the whole suite would pass while asserting nothing.
  const generators = Object.keys(scripts)
    .filter((name) => isGenerator(name, scripts))
    .sort();
  assert.ok(
    generators.includes('collect:metrics') &&
      generators.includes('fetch:community-people') &&
      generators.includes('generate:members') &&
      generators.includes('collect:enduser-members'),
    `expected the known generators to be recognised, got ${generators.join(', ')}`,
  );
  assert.equal(validatorFor('collect:metrics', scripts), 'validate:metrics');
  assert.equal(
    validatorFor('fetch:community-people', scripts),
    'validate:community-people',
  );
  assert.equal(
    validatorFor('collect:enduser-members', scripts),
    'validate:enduser-members',
  );
  assert.equal(validatorFor('generate:members', scripts), 'validate:members');
});

test('members validation runs before the ci.yml production build', () => {
  for (const [file, jobName] of [['ci.yml', 'validate']]) {
    const doc = workflows.find((entry) => entry.name === file).doc;
    const targets = orderedTargets(doc.jobs[jobName]);
    const members = targets.indexOf('validate:members');
    const build = targets.findIndex(
      (target) => target === 'build:production' || target === 'build',
    );
    assert.ok(members >= 0, `${file}:${jobName} omits validate:members`);
    assert.ok(
      build > members,
      `${file}:${jobName} must validate members before building`,
    );
  }
});

test('members validation runs before the Netlify build', () => {
  // netlify.toml runs build:netlify, whose step list lives in
  // scripts/netlify-build.mjs rather than in a workflow; validate:all is the
  // validator set and build:production the build, so the same ordering holds
  // across the two scripts.
  const buildTargets = npmRunTargets(scripts['build:netlify'] ?? '');
  assert.deepEqual(buildTargets, [], 'build:netlify delegates to a script');
  assert.equal(scripts['build:netlify'], 'node scripts/netlify-build.mjs');

  const validators = npmRunTargets(scripts['validate:all'] ?? '');
  assert.ok(
    validators.includes('validate:members'),
    'validate:all omits validate:members',
  );
  assert.ok(
    !validators.some((target) => target.startsWith('build')),
    'validate:all must not build; build:production follows it in the script',
  );
});

test('the workflows this contract applies to are actually detected', () => {
  // The rules are scoped by what a workflow does, so a detector that silently
  // matched nothing would narrow the contract to the empty set.
  assert.deepEqual(
    workflows.filter(({ doc }) => publishesSite(doc)).map(({ name }) => name),
    [],
  );
  assert.deepEqual(
    workflows
      .filter(({ doc }) => commitsGeneratedOutput(doc))
      .map(({ name }) => name),
    [
      'architecture-submission.yml',
      'audit-fix.yml',
      'format-documents.yml',
      'refresh-community-people.yml',
      'refresh-members.yml',
      'refresh-metrics.yml',
      'refresh-radar-reports.yml',
    ],
  );
});
