// Guards where the one network-dependent gate is allowed to run.
//
// `npm run check:links` resolves every outbound URL in the root-level `*.md`
// files against the live internet. `.github/workflows/check-links.yml` runs it
// weekly on a schedule and on demand, and its header states the reason it is
// kept off the pull_request lane: a third-party outage would otherwise fail
// unrelated contributor PRs. tests/issue-template-contract.test.mjs:196-204
// repeats that reasoning in prose, and CONTRIBUTING describes the split.
//
// Nothing in the suite asserts any of it. `check-links.yml` is the only
// workflow in the repository with no contract test of its own:
// tests/workflow-scripts.test.mjs only asks whether *some* workflow runs each
// `validate:*`/`check:*` gate, so deleting the schedule block, retargeting the
// workflow at `pull_request`, or adding `npm test` to a PR-triggered job all
// leave the suite green while reversing the policy. The first silently stops
// link rot being caught at all; the other two put a third party's uptime
// between a contributor and a green check.
//
// The second contract is the one that is easiest to break by accident, because
// it does not need anybody to type `check:links`. The gate is a member of the
// `check` aggregate (`_list:check:*`, see tests/check-aggregate-contract.mjs),
// and `npm test` is `npm run check && npm run test:unit`, so a PR job that
// runs either aggregate runs the network gate transitively. ci.yml avoids this
// today by invoking `check:format`, `check:spelling`, `check:markdown` and
// `check:audit` individually rather than running the aggregate; that is a
// deliberate choice no test currently records.
//
// The reachability walk below is therefore transitive and reads the aggregate
// through npm's own expansion rather than re-implementing the grep that
// defines it, for the reason given in tests/check-aggregate-contract.test.mjs:
// a second copy of the pattern can agree with itself while disagreeing with
// the shell.
//
// NETWORK_GATES_ON_PR follows the retiring-baseline convention used by
// KNOWN_PERSISTING_CHECKOUTS in tests/ci-supply-chain.test.mjs and
// SERIALISED_WORKFLOWS in tests/ci-concurrency.test.mjs: a deliberate
// exception stays possible, but it has to be argued for here, and the
// staleness guard forces the entry out once it stops being needed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { loadWorkflows, repoRoot as root } from './helpers-workflows.mjs';

const LINK_GATE = 'check:links';
const LINK_WORKFLOW = 'check-links.yml';
const LIST_HELPER = '_list:check:*';

const scripts =
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};

const workflows = loadWorkflows();

// Workflows allowed to reach the network gate from a pull_request trigger,
// keyed by file name with the reason. Empty on purpose.
const NETWORK_GATES_ON_PR = new Map([]);

// `on` is parsed as the boolean true by YAML 1.1 compatibility rules, so the
// trigger block is read back through both keys. Mirrors the helpers in
// tests/ci-supply-chain.test.mjs and tests/ci-concurrency.test.mjs.
export function triggers(doc) {
  const on = doc?.on ?? doc?.[true];
  if (!on) return [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on);
}

const PR_TRIGGERS = ['pull_request', 'pull_request_target'];

export function isPullRequestTriggered(doc) {
  return triggers(doc).some((trigger) => PR_TRIGGERS.includes(trigger));
}

export function runCommands(doc) {
  const commands = [];
  for (const job of Object.values(doc?.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.run === 'string') commands.push(step.run);
    }
  }
  return commands;
}

/**
 * Script names a shell command invokes directly.
 *
 * Covers `npm run foo`, `npm run foo -- --bar`, `npm run -s foo` and
 * `npm -s run foo` as tests/workflow-scripts.test.mjs does, and additionally
 * the `npm test` lifecycle alias. The alias matters here and not there: it is
 * the shortest way to pull the whole `check` aggregate — and with it the
 * network gate — into a job without the string `check` appearing anywhere.
 *
 * @param {string} command shell command from a workflow `run:` step
 * @returns {string[]} script names the command invokes
 */
export function npmRunTargets(command) {
  const targets = [];
  // A bare `npm run --loglevel=warn` lists scripts rather than running one, so
  // the captured target must not itself look like a flag.
  const runPattern = /\bnpm\s+(?:-\S+\s+)*run\s+(?:-\S+\s+)*((?!-)[\w:*.-]+)/g;
  for (const match of command.matchAll(runPattern)) targets.push(match[1]);
  // `npm test` and its `npm t` alias. `npm run test` is already matched above.
  const lifecyclePattern = /\bnpm\s+(?:-\S+\s+)*(test|t)\b/g;
  for (const match of command.matchAll(lifecyclePattern)) {
    targets.push(match[1] === 't' ? 'test' : match[1]);
  }
  return targets;
}

// Only the enumerating helper runs here. It shells out to `npm run` for its
// listing and greps it -- no gate, no network, no file written.
let memoizedMembers;
function checkAggregateMembers() {
  memoizedMembers ??= execFileSync('npm', ['run', '-s', LIST_HELPER], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return memoizedMembers;
}

/**
 * Every script name reachable from `entries`, following `npm run` edges
 * through script bodies and expanding the `check` aggregate.
 *
 * The aggregate names no members -- it is `npm run seq -- $(npm run -s
 * _list:check:*)` -- so a body that mentions the listing helper stands in for
 * every gate the helper enumerates.
 *
 * @param {string[]} entries script names to start from
 * @param {Record<string, string>} [scriptMap] package.json `scripts`
 * @param {string[]} [members] expansion of the listing helper
 * @returns {Set<string>} reachable script names, including `entries`
 */
export function reachableScripts(
  entries,
  scriptMap = scripts,
  members = checkAggregateMembers(),
) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    if (name === LIST_HELPER) {
      queue.push(...members);
      continue;
    }
    const body = scriptMap[name];
    if (typeof body !== 'string') continue;
    if (body.includes(LIST_HELPER)) queue.push(...members);
    queue.push(...npmRunTargets(body));
  }
  return seen;
}

function workflow(name) {
  return workflows.find((entry) => entry.name === name);
}

function gatesReachedBy(doc) {
  const invoked = runCommands(doc).flatMap((command) => npmRunTargets(command));
  return reachableScripts(invoked);
}

test('the link gate still exists and is still the networked one', () => {
  // Pins every guard below to evidence rather than to spelling: renaming the
  // gate would otherwise leave them all passing over a name nothing runs.
  assert.equal(
    typeof scripts[LINK_GATE],
    'string',
    `package.json no longer declares ${LINK_GATE}; this file is about where ` +
      'that gate is allowed to run and must be updated with it',
  );
  assert.ok(
    checkAggregateMembers().includes(LINK_GATE),
    `${LINK_GATE} is no longer a member of the check aggregate; the ` +
      'transitive contract below was written because it is',
  );
});

test(`${LINK_WORKFLOW} runs the link gate on a weekly schedule`, () => {
  const found = workflow(LINK_WORKFLOW);
  assert.ok(
    found,
    `${LINK_WORKFLOW} is missing; link rot is no longer checked`,
  );

  const on = found.doc?.on ?? found.doc?.[true];
  const schedule = on?.schedule ?? [];
  assert.ok(
    Array.isArray(schedule) &&
      schedule.some((entry) => typeof entry?.cron === 'string'),
    `${LINK_WORKFLOW} declares no schedule.cron; the gate runs on no ` +
      'pull request, so a schedule is the only thing that runs it at all',
  );
  assert.ok(
    triggers(found.doc).includes('workflow_dispatch'),
    `${LINK_WORKFLOW} cannot be dispatched; without it the only way to ` +
      'confirm a link fix is to wait for the next scheduled run',
  );
  assert.ok(
    gatesReachedBy(found.doc).has(LINK_GATE),
    `${LINK_WORKFLOW} no longer runs ${LINK_GATE}; the workflow that exists ` +
      'to run the gate is the one place it must be invoked',
  );
});

test(`${LINK_WORKFLOW} is not itself attached to a pull request`, () => {
  const found = workflow(LINK_WORKFLOW);
  const attached = triggers(found.doc).filter((trigger) =>
    [...PR_TRIGGERS, 'push'].includes(trigger),
  );
  assert.deepEqual(
    attached,
    [],
    `${LINK_WORKFLOW} resolves third-party URLs over the network; running it ` +
      'per change makes an unrelated outage fail the change',
  );
});

test('no pull-request-triggered workflow reaches the network gate', () => {
  const offenders = workflows
    .filter(({ doc }) => isPullRequestTriggered(doc))
    .filter(({ name }) => !NETWORK_GATES_ON_PR.has(name))
    .filter(({ doc }) => gatesReachedBy(doc).has(LINK_GATE))
    .map(({ name }) => name)
    .sort();
  assert.deepEqual(
    offenders,
    [],
    `PR-triggered workflows that run ${LINK_GATE}, directly or through the ` +
      '`check` aggregate or `npm test`. Run the individual gates the job ' +
      'needs instead, or record the exception in NETWORK_GATES_ON_PR with a ' +
      'reason',
  );
});

test('the PR-triggered scan is not vacuous', () => {
  // Three ways the guard above could pass while seeing nothing: no workflow
  // classified as PR-triggered, no `run:` command read out of the one that
  // matters, and a walk that never reaches a gate.
  const prTriggered = workflows
    .filter(({ doc }) => isPullRequestTriggered(doc))
    .map(({ name }) => name);
  assert.ok(
    prTriggered.includes('ci.yml'),
    `expected ci.yml among the PR-triggered workflows, got ${prTriggered.join(', ')}`,
  );
  const reached = gatesReachedBy(workflow('ci.yml').doc);
  assert.ok(
    reached.has('check:format') && reached.has('validate:members'),
    "expected ci.yml's own gates to be read out of its run steps",
  );
});

test('the walk reaches the gate through both aggregates', () => {
  // The point of making the walk transitive. If either edge were lost the
  // contract above would still pass over a job that ran the whole aggregate.
  assert.ok(
    reachableScripts(['check']).has(LINK_GATE),
    `\`npm run check\` no longer reaches ${LINK_GATE} through this walk`,
  );
  assert.ok(
    reachableScripts(['test']).has(LINK_GATE),
    `\`npm test\` no longer reaches ${LINK_GATE} through this walk`,
  );
});

test('npmRunTargets reads the lifecycle alias as well as `npm run`', () => {
  assert.deepEqual(npmRunTargets('npm run check:links'), ['check:links']);
  assert.deepEqual(npmRunTargets('npm run -s _list:check:*'), [
    '_list:check:*',
  ]);
  assert.deepEqual(npmRunTargets('npm ci && npm test'), ['test']);
  assert.deepEqual(npmRunTargets('npm t'), ['test']);
  assert.deepEqual(npmRunTargets('npm run test -- --watch=false'), ['test']);
  // `npm ci` installs; it must not be read as the `ci` script, and the `t`
  // alias must not be found inside an unrelated word.
  assert.deepEqual(npmRunTargets('npm ci'), []);
  assert.deepEqual(npmRunTargets('npm run --loglevel=warn'), []);
});

test('the walk follows a chain and survives an unknown script', () => {
  const scriptMap = {
    outer: 'npm run middle',
    middle: 'npm run inner && npm run missing',
    inner: 'node tool.mjs',
  };
  const reached = reachableScripts(['outer'], scriptMap, []);
  assert.deepEqual([...reached].sort(), [
    'inner',
    'middle',
    'missing',
    'outer',
  ]);
});

test('the walk expands the aggregate and terminates on a cycle', () => {
  const scriptMap = {
    aggregate: `npm run seq -- $(npm run -s ${LIST_HELPER})`,
    loop: 'npm run loop',
  };
  assert.ok(
    reachableScripts(['aggregate'], scriptMap, [LINK_GATE]).has(LINK_GATE),
    'a body that mentions the listing helper must stand in for its members',
  );
  assert.deepEqual([...reachableScripts(['loop'], scriptMap, [])], ['loop']);
});

test('the scanners report the violation they exist to catch', () => {
  // The guards above assert absence, so each needs a positive control: a
  // document shaped like the regression must be reported.
  const offending = parse(`
on:
  pull_request:
jobs:
  gate:
    steps:
      - run: npm ci
      - run: npm test
`);
  assert.ok(isPullRequestTriggered(offending));
  assert.ok(
    gatesReachedBy(offending).has(LINK_GATE),
    'a PR job running `npm test` must be reported as reaching the gate',
  );

  const compliant = parse(`
on:
  pull_request:
jobs:
  gate:
    steps:
      - run: npm run check:format
`);
  assert.equal(gatesReachedBy(compliant).has(LINK_GATE), false);
});

test('every recorded exception is live and carries a reason', () => {
  const stale = [...NETWORK_GATES_ON_PR.entries()]
    .filter(([name, reason]) => {
      const found = workflow(name);
      if (!found || !isPullRequestTriggered(found.doc)) return true;
      if (!gatesReachedBy(found.doc).has(LINK_GATE)) return true;
      return typeof reason !== 'string' || reason.trim() === '';
    })
    .map(([name]) => name)
    .sort();
  assert.deepEqual(
    stale,
    [],
    'NETWORK_GATES_ON_PR entries naming a workflow that is gone, is no ' +
      'longer PR-triggered, no longer reaches the gate, or carries no ' +
      'reason; delete these entries',
  );
});
