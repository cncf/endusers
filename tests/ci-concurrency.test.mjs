// Guards the property that keeps the pull_request lane from racing itself:
// that every PR-triggered workflow supersedes its own stale runs instead of
// letting them finish.
//
// Without a `concurrency` group, pushing three times to a branch leaves three
// full runs of `.github/workflows/ci.yml` alive at once. Each one holds its
// runners for the whole matrix, and the two that are already obsolete report
// their results onto the same commit status as the one that matters. On a
// saturated queue that is the difference between a PR being checked and a PR
// waiting behind its own superseded attempts.
//
// The group expression matters as much as the flag. `concurrency: ci` is a
// single constant key for the whole repository, so it does not cancel a stale
// run of the same PR — it serialises *every* PR into one lane and cancels
// other people's work. The per-PR keying tested below is what makes
// `cancel-in-progress: true` safe.
//
// Nothing else in the suite sees any of this. tests/ci-supply-chain.test.mjs
// covers pinning, permissions, runners and timeouts, and its timeout rationale
// only mentions concurrency in passing as the reason a stuck job is not
// superseded. tests/workflow-scripts.test.mjs asks which commands a workflow
// runs. tests/automation-workflow-ordering.test.mjs covers step ordering in the
// generator workflows, which are not PR-triggered. A new PR-triggered workflow
// can be added today with no concurrency block at all and the suite stays
// green.
//
// SERIALISED_WORKFLOWS below follows the retiring-baseline convention used by
// KNOWN_PERSISTING_CHECKOUTS and KNOWN_UNBOUNDED_JOBS in
// tests/ci-supply-chain.test.mjs: a workflow that genuinely must not be
// cancelled mid-flight stays possible, but it has to be argued for here, and
// the companion staleness test forces the entry to be deleted once the
// workflow stops needing it.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const workflowDir = new URL('../.github/workflows/', import.meta.url).pathname;

const workflows = readdirSync(workflowDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort()
  .map((name) => ({
    name,
    doc: parse(readFileSync(join(workflowDir, name), 'utf8')),
  }));

// `on` is parsed as the boolean true by YAML 1.1 compatibility rules, so the
// trigger block is read back through both keys. Mirrors the helper in
// tests/ci-supply-chain.test.mjs.
function triggers(doc) {
  const on = doc?.on ?? doc?.[true];
  if (!on) return [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on);
}

// `pull_request_target` is banned outright by ci-supply-chain.test.mjs, but it
// is included here so that this contract does not become the hole through
// which an uncancelled PR-triggered workflow arrives if that ban is ever
// relaxed.
const PR_TRIGGERS = ['pull_request', 'pull_request_target'];

function isPullRequestTriggered(doc) {
  return triggers(doc).some((trigger) => PR_TRIGGERS.includes(trigger));
}

// Workflows that declare a concurrency group but must NOT cancel the run in
// flight, with the reason. Keyed by file name.
const SERIALISED_WORKFLOWS = new Map([
  [
    'deploy-gh-pages.yml',
    'Publishes the live site. Cancelling a deploy halfway can leave GitHub ' +
      'Pages serving a partially uploaded artifact, so overlapping runs are ' +
      'queued behind the constant "pages" group rather than cancelled. Not ' +
      'PR-triggered, so it is outside the cancel-in-progress contract below ' +
      'and only needs the constant-group exemption.',
  ],
]);

// A group is per-PR if it varies with the event. `${{ ... }}` referencing any
// of these contexts gives each pull request its own key; a group with no
// expression at all is a single repository-wide lane.
const PER_PR_CONTEXTS = [
  'github.event.pull_request.number',
  'github.head_ref',
  'github.ref',
];

function groupExpression(doc) {
  const group = doc?.concurrency;
  if (group === undefined || group === null) return undefined;
  // `concurrency:` accepts either a bare string or a map with `group:`.
  const raw = typeof group === 'string' ? group : group.group;
  if (typeof raw !== 'string') return undefined;
  // Prettier wraps long expressions across lines; YAML folds them back with
  // newlines that would otherwise break substring matching.
  return raw.replace(/\s+/g, ' ').trim();
}

function cancelsInProgress(doc) {
  const group = doc?.concurrency;
  if (typeof group !== 'object' || group === null) return false;
  return group['cancel-in-progress'] === true;
}

function isPerPullRequest(expression) {
  if (typeof expression !== 'string') return false;
  if (!expression.includes('${{')) return false;
  return PER_PR_CONTEXTS.some((context) => expression.includes(context));
}

// The scanners below take the parsed workflows as an argument rather than
// closing over the repository's own, so each failure path can be exercised
// against a fixture. A guard whose failure branch never runs is a guard nobody
// has checked.
function withoutConcurrency(parsedWorkflows) {
  return parsedWorkflows
    .filter(({ doc }) => isPullRequestTriggered(doc))
    .filter(({ doc }) => groupExpression(doc) === undefined)
    .map(({ name }) => name)
    .sort();
}

function withoutCancellation(parsedWorkflows, allowlist) {
  return parsedWorkflows
    .filter(({ doc }) => isPullRequestTriggered(doc))
    .filter(({ name }) => !allowlist.has(name))
    .filter(({ doc }) => groupExpression(doc) !== undefined)
    .filter(({ doc }) => !cancelsInProgress(doc))
    .map(({ name }) => name)
    .sort();
}

function withConstantGroup(parsedWorkflows, allowlist) {
  return parsedWorkflows
    .filter(({ doc }) => isPullRequestTriggered(doc))
    .filter(({ name }) => !allowlist.has(name))
    .filter(({ doc }) => groupExpression(doc) !== undefined)
    .filter(({ doc }) => !isPerPullRequest(groupExpression(doc)))
    .map(({ name, doc }) => `${name}: ${groupExpression(doc)}`)
    .sort();
}

// The constant-group rule applies to every workflow, not just PR-triggered
// ones: a repository-wide key queues unrelated scheduled runs behind each
// other just as effectively.
function unexplainedConstantGroups(parsedWorkflows, allowlist) {
  return parsedWorkflows
    .filter(({ name }) => !allowlist.has(name))
    .filter(({ doc }) => groupExpression(doc) !== undefined)
    .filter(({ doc }) => !isPerPullRequest(groupExpression(doc)))
    .map(({ name }) => name)
    .sort();
}

// An entry in SERIALISED_WORKFLOWS is still earning its place while the
// workflow either refuses to cancel or keys its group on something constant.
// Once it does both of the things the contract asks for, the exemption is
// describing nothing and has to go.
function stillNeedsSerialisation(doc) {
  return !cancelsInProgress(doc) || !isPerPullRequest(groupExpression(doc));
}

test('the pull_request trigger detection is not vacuous', () => {
  assert.ok(workflows.length > 0, 'no workflow files found');
  const prWorkflows = workflows
    .filter(({ doc }) => isPullRequestTriggered(doc))
    .map(({ name }) => name);
  assert.ok(
    prWorkflows.length > 0,
    'no PR-triggered workflow was detected, so every test below would pass over an empty set',
  );
});

test('every PR-triggered workflow declares a concurrency group', () => {
  const offenders = withoutConcurrency(workflows);
  assert.deepEqual(
    offenders,
    [],
    `a pull_request workflow without 'concurrency:' leaves every superseded push running to completion and reporting onto the same commit:\n${offenders.join('\n')}`,
  );
});

test('every PR-triggered concurrency group cancels the superseded run', () => {
  const offenders = withoutCancellation(workflows, SERIALISED_WORKFLOWS);
  assert.deepEqual(
    offenders,
    [],
    `set 'cancel-in-progress: true', or record the workflow in SERIALISED_WORKFLOWS with the reason it must finish:\n${offenders.join('\n')}`,
  );
});

test('every PR-triggered concurrency group is keyed per pull request', () => {
  const offenders = withConstantGroup(workflows, SERIALISED_WORKFLOWS);
  assert.deepEqual(
    offenders,
    [],
    `a constant group serialises every pull request into one lane and cancels unrelated work; key the group on one of ${PER_PR_CONTEXTS.join(', ')}:\n${offenders.join('\n')}`,
  );
});

test('every workflow with a constant concurrency group is recorded as deliberate', () => {
  const unexplained = unexplainedConstantGroups(
    workflows,
    SERIALISED_WORKFLOWS,
  );
  assert.deepEqual(
    unexplained,
    [],
    `a repository-wide constant group queues unrelated runs behind each other; key it per event or record it in SERIALISED_WORKFLOWS with the reason:\n${unexplained.join('\n')}`,
  );
});

test('the serialised-workflow baseline retires itself', () => {
  for (const [name, reason] of SERIALISED_WORKFLOWS) {
    const entry = workflows.find((workflow) => workflow.name === name);
    assert.ok(
      entry,
      `${name} is recorded in SERIALISED_WORKFLOWS but no such workflow exists; remove the entry`,
    );
    assert.ok(
      typeof reason === 'string' && reason.trim().length > 0,
      `${name}: record why this workflow must not be cancelled`,
    );
    assert.notEqual(
      groupExpression(entry.doc),
      undefined,
      `${name} no longer declares a concurrency group, so the exemption describes nothing; remove it from SERIALISED_WORKFLOWS`,
    );
    assert.ok(
      stillNeedsSerialisation(entry.doc),
      `${name} now cancels in progress on a per-PR group; remove it from SERIALISED_WORKFLOWS so the gap cannot reopen`,
    );
  }
});

// Fixtures. Each one drives a scanner down the branch the repository's own
// workflows never take, so the guards above cannot pass by never firing.
const fixture = (name, doc) => [{ name, doc }];

test('the concurrency scanners report the violations they exist to catch', () => {
  const missing = fixture('new-ci.yml', {
    on: { pull_request: null },
    jobs: {},
  });
  assert.deepEqual(withoutConcurrency(missing), ['new-ci.yml']);

  const uncancelled = fixture('new-ci.yml', {
    on: { pull_request: null },
    concurrency: { group: 'x-${{ github.ref }}' },
  });
  assert.deepEqual(withoutCancellation(uncancelled, new Map()), ['new-ci.yml']);
  assert.deepEqual(
    withoutCancellation(uncancelled, SERIALISED_WORKFLOWS),
    ['new-ci.yml'],
    'an unrelated allowlist entry must not excuse a different workflow',
  );

  const constant = fixture('new-ci.yml', {
    on: { pull_request: null },
    concurrency: { group: 'ci', 'cancel-in-progress': true },
  });
  assert.deepEqual(withConstantGroup(constant, new Map()), ['new-ci.yml: ci']);
  assert.deepEqual(withConstantGroup(constant, SERIALISED_WORKFLOWS), [
    'new-ci.yml: ci',
  ]);
});

test('the scanners accept a compliant workflow and skip non-PR triggers', () => {
  const compliant = fixture('new-ci.yml', {
    on: { pull_request: null },
    concurrency: {
      group: 'new-ci-${{ github.event.pull_request.number || github.ref }}',
      'cancel-in-progress': true,
    },
  });
  assert.deepEqual(withoutConcurrency(compliant), []);
  assert.deepEqual(withoutCancellation(compliant, new Map()), []);
  assert.deepEqual(withConstantGroup(compliant, new Map()), []);

  const scheduled = fixture('nightly.yml', {
    on: { schedule: [{ cron: '0 0 * * *' }] },
    jobs: {},
  });
  assert.deepEqual(withoutConcurrency(scheduled), []);
  assert.deepEqual(withoutCancellation(scheduled, new Map()), []);
  assert.deepEqual(withConstantGroup(scheduled, new Map()), []);
});

test('the trigger reader handles every form `on:` can take', () => {
  assert.ok(isPullRequestTriggered({ on: 'pull_request' }));
  assert.ok(isPullRequestTriggered({ on: ['push', 'pull_request'] }));
  assert.ok(isPullRequestTriggered({ on: { pull_request: { branches: [] } } }));
  // YAML 1.1 folds the bare key `on` to the boolean true.
  assert.ok(isPullRequestTriggered({ [true]: { pull_request: null } }));
  assert.ok(!isPullRequestTriggered({ on: { push: null } }));
  assert.ok(!isPullRequestTriggered({}));
});

test('the group reader normalises both concurrency spellings', () => {
  assert.equal(groupExpression({ concurrency: 'pages' }), 'pages');
  assert.equal(groupExpression({ concurrency: { group: 'pages' } }), 'pages');
  assert.equal(
    groupExpression({ concurrency: { group: 'ci-${{ github.ref\n }}' } }),
    'ci-${{ github.ref }}',
  );
  assert.equal(groupExpression({}), undefined);
  assert.equal(
    groupExpression({ concurrency: { 'cancel-in-progress': true } }),
    undefined,
  );
  // A bare-string concurrency cannot carry cancel-in-progress.
  assert.equal(cancelsInProgress({ concurrency: 'pages' }), false);
  assert.equal(
    cancelsInProgress({
      concurrency: { group: 'x', 'cancel-in-progress': false },
    }),
    false,
  );
  assert.equal(
    cancelsInProgress({
      concurrency: { group: 'x', 'cancel-in-progress': true },
    }),
    true,
  );
});

test('per-PR keying requires a real expression, not a literal context name', () => {
  assert.ok(isPerPullRequest('ci-${{ github.ref }}'));
  assert.ok(isPerPullRequest('ci-${{ github.event.pull_request.number }}'));
  assert.ok(isPerPullRequest('ci-${{ github.head_ref }}'));
  // Text that merely mentions a context is still one constant key.
  assert.ok(!isPerPullRequest('github.ref'));
  assert.ok(!isPerPullRequest('ci'));
  // An expression that varies with nothing PR-specific still serialises PRs.
  assert.ok(!isPerPullRequest('ci-${{ github.workflow }}'));
  assert.ok(!isPerPullRequest(undefined));
});

test('the constant-group scan names a workflow the allowlist does not cover', () => {
  const constant = fixture('nightly.yml', {
    on: { schedule: [{ cron: '0 0 * * *' }] },
    concurrency: { group: 'nightly', 'cancel-in-progress': true },
  });
  assert.deepEqual(unexplainedConstantGroups(constant, new Map()), [
    'nightly.yml',
  ]);
  assert.deepEqual(
    unexplainedConstantGroups(constant, SERIALISED_WORKFLOWS),
    ['nightly.yml'],
    'an unrelated allowlist entry must not excuse a different workflow',
  );
  assert.deepEqual(
    unexplainedConstantGroups(constant, new Map([['nightly.yml', 'because']])),
    [],
  );
  // A workflow with no concurrency block at all is the other contract's
  // problem, not this one's.
  assert.deepEqual(
    unexplainedConstantGroups(
      fixture('nightly.yml', { on: { schedule: [] }, jobs: {} }),
      new Map(),
    ),
    [],
  );
});

test('an exemption retires once the workflow satisfies both halves of the contract', () => {
  // Constant group, cancels: still exempt on the keying half.
  assert.ok(
    stillNeedsSerialisation({
      concurrency: { group: 'pages', 'cancel-in-progress': true },
    }),
  );
  // Per-PR group, refuses to cancel: still exempt on the cancellation half.
  assert.ok(
    stillNeedsSerialisation({
      concurrency: {
        group: 'x-${{ github.ref }}',
        'cancel-in-progress': false,
      },
    }),
  );
  // Both halves satisfied: the entry is describing nothing and must be removed.
  assert.ok(
    !stillNeedsSerialisation({
      concurrency: {
        group: 'x-${{ github.ref }}',
        'cancel-in-progress': true,
      },
    }),
  );
});
