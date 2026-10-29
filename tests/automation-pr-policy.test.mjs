// The pull-request policy `.github/actions/open-automation-pr` fixes on behalf
// of every automation workflow.
//
// The action's description states the arrangement: each workflow "only has to
// supply its branch name and PR text", and the action supplies the rest by
// pinning `delete-branch: true`, `labels: automated` and `signoff: true` on the
// inner `peter-evans/create-pull-request` step, and forwarding its own declared
// inputs to it. Five workflows route through it -- architecture-submission,
// refresh-community-people, refresh-members, refresh-metrics,
// refresh-radar-reports -- and none uses the action directly, so that one
// `with:` block is the whole of the policy.
//
// Nothing read it. ./composite-action-supply-chain.test.mjs is the only test
// that opens `.github/actions/**`, and it asserts the supply-chain and wiring
// shape -- SHA pinning, the version comment Dependabot needs, `shell:` on a
// composite `run:`, `npm run` targets that exist, interpolation of untrusted
// event text. A step's `with:` values are outside all of it, and no coverage
// gate can stand in: SOURCE_ROOTS in ./tools/coverage-report.mjs is `scripts/`,
// `src/` and `tests/tools/`, so `.github/` is scored by nothing.
//
// Two guards already reason *from* this block without asserting it:
//
//   * ./helpers-workflow-ordering.mjs's `opensPullRequest()` recognises an
//     automation PR step by descending into the composite and finding the
//     inner `uses:`.
//   * ./ci-concurrency.test.mjs requires a branch-keyed `concurrency:` group on
//     these workflows *because* `delete-branch: true` lets one run's cleanup
//     delete the ref another just opened a pull request from -- and reads the
//     branch from `with.branch` on the *wrapper* step, on the stated premise
//     that the action "forwards `branch:` unchanged".
//
// So four edits to the action stay green on every check in the repository.
// Dropping `signoff: true` opens every scheduled refresh PR with no
// `Signed-off-by` trailer and fails the required DCO check, discovered at the
// next refresh rather than in the change that caused it. Dropping
// `labels: automated` drops the label the action itself calls required.
// Dropping `delete-branch: true` leaves ci-concurrency demanding a group for a
// hazard that no longer exists. And hardcoding, renaming or dropping the
// `branch:` forward leaves `pullRequestBranches()` matching a concurrency key
// against a value the inner action never receives: the guard passes and guards
// nothing. That last one is why the forwarding is asserted here and not only
// the three constants -- a guard whose premise has quietly become false is
// worse than no guard, because it still reports green.
//
// What this file deliberately does not assert is that a workflow *must* reach
// the action through the wrapper. `opensPullRequest()` handles the direct use
// on purpose, and requiring the wrapper would be a new policy rather than a
// contract over the existing one.
//
// The scanners below are pure functions of a parsed document so the fixtures at
// the bottom can prove each one goes red. A contract nobody has seen fail is
// indistinguishable from one with nothing to look at.

import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'yaml';

import { loadLocalActions } from './helpers-workflows.mjs';
import { CREATE_PR_ACTION } from './helpers-workflow-ordering.mjs';

const ACTION_NAME = 'open-automation-pr';

// The values the action supplies so no workflow has to. Keyed as
// peter-evans/create-pull-request spells them.
const FIXED_POLICY = {
  'delete-branch': true,
  labels: 'automated',
  signoff: true,
};

// The inner steps that open the pull request. Returned as a list rather than a
// single step so "exactly one" can be asserted: a second create-pull-request
// step would open a second PR from the same branch, and a scanner that took
// the first match would describe only half of what the action does.
export function createPullRequestSteps(doc) {
  return (doc?.runs?.steps ?? []).filter(
    (step) =>
      typeof step?.uses === 'string' && step.uses.startsWith(CREATE_PR_ACTION),
  );
}

// Fixed policy values that are absent or no longer what they were.
export function policyOffences(doc) {
  const steps = createPullRequestSteps(doc);
  if (steps.length !== 1) {
    return [
      `expected exactly one ${CREATE_PR_ACTION} step, found ${steps.length}`,
    ];
  }
  const supplied = steps[0].with ?? {};
  return Object.entries(FIXED_POLICY)
    .filter(([key, expected]) => supplied[key] !== expected)
    .map(
      ([key, expected]) =>
        `${key}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(supplied[key] ?? null)}`,
    );
}

// Required inputs the action declares but does not hand to the inner step under
// the same key. Scoped to the required ones: an optional input the action
// chooses not to forward is a decision, whereas a required one the caller must
// supply and the action then discards is the premise ci-concurrency reads.
export function unforwardedInputs(doc) {
  const steps = createPullRequestSteps(doc);
  // Shape faults are policyOffences()' to report; reporting them twice would
  // name the same edit in two failures.
  if (steps.length !== 1) return [];
  const supplied = steps[0].with ?? {};
  return Object.entries(doc?.inputs ?? {})
    .filter(([, spec]) => spec?.required === true)
    .filter(([name]) => supplied[name] !== `\${{ inputs.${name} }}`)
    .map(
      ([name]) =>
        `${name}: expected \${{ inputs.${name} }}, found ${JSON.stringify(supplied[name] ?? null)}`,
    );
}

export function requiredInputNames(doc) {
  return Object.entries(doc?.inputs ?? {})
    .filter(([, spec]) => spec?.required === true)
    .map(([name]) => name)
    .sort();
}

const action = loadLocalActions().get(ACTION_NAME);

// --- the contract, over the real action -------------------------------------

test('the automation pull-request action is on disk and composite', () => {
  assert.ok(action, `.github/actions/${ACTION_NAME} is missing`);
  assert.equal(action.runs?.using, 'composite');
});

test('it opens the pull request through exactly one create-pull-request step', () => {
  assert.equal(createPullRequestSteps(action).length, 1);
});

test('it fixes delete-branch, the automated label and DCO signoff', () => {
  assert.deepEqual(policyOffences(action), []);
});

// Without this, unforwardedInputs() below would pass over an action that had
// stopped requiring anything, which is the shape the forwarding contract is
// least able to notice on its own.
test('it requires the branch and the pull request text from its caller', () => {
  assert.deepEqual(requiredInputNames(action), [
    'body',
    'branch',
    'commit-message',
    'title',
  ]);
});

test('it forwards every required input to the create-pull-request step', () => {
  assert.deepEqual(unforwardedInputs(action), []);
});

// --- proofs, over documents that do offend ----------------------------------

const PINNED = `${CREATE_PR_ACTION}@${'a'.repeat(40)}`;

function composite({ inputs = '', steps }) {
  return parse(
    [
      'name: Fixture',
      'description: A fixture composite action.',
      ...(inputs === '' ? [] : ['inputs:', inputs]),
      'runs:',
      '  using: composite',
      '  steps:',
      steps,
    ].join('\n'),
  );
}

const REQUIRED_BRANCH = [
  '  branch:',
  '    description: Branch name.',
  '    required: true',
  '  note:',
  '    description: Not required, so not forwarded.',
  '    required: false',
].join('\n');

test('createPullRequestSteps ignores steps that open no pull request', () => {
  const doc = composite({
    steps: [
      '    - run: npm ci',
      '      shell: bash',
      '    - uses: actions/checkout@v5',
      `    - uses: ${PINNED}`,
    ].join('\n'),
  });
  assert.equal(createPullRequestSteps(doc).length, 1);
});

test('createPullRequestSteps treats an action with no steps as an absence', () => {
  assert.deepEqual(createPullRequestSteps(parse('name: Fixture\n')), []);
  assert.deepEqual(createPullRequestSteps(null), []);
});

test('policyOffences names an action that opens no pull request at all', () => {
  const doc = composite({ steps: '    - uses: actions/checkout@v5' });
  assert.deepEqual(policyOffences(doc), [
    `expected exactly one ${CREATE_PR_ACTION} step, found 0`,
  ]);
});

test('policyOffences names a second create-pull-request step', () => {
  const doc = composite({
    steps: [`    - uses: ${PINNED}`, `    - uses: ${PINNED}`].join('\n'),
  });
  assert.deepEqual(policyOffences(doc), [
    `expected exactly one ${CREATE_PR_ACTION} step, found 2`,
  ]);
});

test('policyOffences names every fixed value a bare step omits', () => {
  const doc = composite({ steps: `    - uses: ${PINNED}` });
  assert.deepEqual(policyOffences(doc), [
    'delete-branch: expected true, found null',
    'labels: expected "automated", found null',
    'signoff: expected true, found null',
  ]);
});

test('policyOffences names a weakened value rather than a missing one', () => {
  const doc = composite({
    steps: [
      `    - uses: ${PINNED}`,
      '      with:',
      '        delete-branch: false',
      '        labels: automated',
      '        signoff: true',
    ].join('\n'),
  });
  assert.deepEqual(policyOffences(doc), [
    'delete-branch: expected true, found false',
  ]);
});

test('unforwardedInputs names a required input the step never receives', () => {
  const doc = composite({
    inputs: REQUIRED_BRANCH,
    steps: [
      `    - uses: ${PINNED}`,
      '      with:',
      '        signoff: true',
    ].join('\n'),
  });
  assert.deepEqual(unforwardedInputs(doc), [
    'branch: expected ${{ inputs.branch }}, found null',
  ]);
});

// A step with no `with:` at all, over an action that declares no inputs: the
// two absences the scanner reads as "nothing supplied" and "nothing required",
// which no other fixture reaches because each supplies one of them.
test('unforwardedInputs reads a bare step and an input-less action', () => {
  const doc = composite({ steps: `    - uses: ${PINNED}` });
  assert.deepEqual(unforwardedInputs(doc), []);
});

test('unforwardedInputs names a required input the step hardcodes', () => {
  const doc = composite({
    inputs: REQUIRED_BRANCH,
    steps: [
      `    - uses: ${PINNED}`,
      '      with:',
      '        branch: automation/fixed',
    ].join('\n'),
  });
  assert.deepEqual(unforwardedInputs(doc), [
    'branch: expected ${{ inputs.branch }}, found "automation/fixed"',
  ]);
});

test('unforwardedInputs accepts a forwarded input and skips optional ones', () => {
  const doc = composite({
    inputs: REQUIRED_BRANCH,
    steps: [
      `    - uses: ${PINNED}`,
      '      with:',
      '        branch: ${{ inputs.branch }}',
    ].join('\n'),
  });
  assert.deepEqual(unforwardedInputs(doc), []);
});

test('unforwardedInputs defers to policyOffences on a shape fault', () => {
  const doc = composite({
    inputs: REQUIRED_BRANCH,
    steps: '    - uses: actions/checkout@v5',
  });
  assert.deepEqual(unforwardedInputs(doc), []);
});

test('requiredInputNames reads an action that declares no inputs', () => {
  assert.deepEqual(
    requiredInputNames(composite({ steps: `    - uses: ${PINNED}` })),
    [],
  );
});
