// Guards that every data-refresh script is either run by a workflow or
// recorded here as a deliberate omission.
//
// tests/workflow-scripts.test.mjs already makes that demand of the
// `validate:*`/`check:*` gates, and keeps the exceptions in its
// GATES_NOT_RUN_BY_CI table so an unwired gate is distinguishable from one
// that was never meant to be wired. Nothing makes the same demand of the
// scripts on the other side of the contract -- the `collect:*`, `fetch:*`,
// `import:*` and `generate:*` scripts that write the datasets those gates
// then validate.
//
// tests/automation-workflow-ordering.test.mjs names the same four namespaces,
// but it only constrains the *order* of steps inside a workflow that already
// runs one of them. A refresh script no workflow runs at all never appears in
// any job, so that file has nothing to order and stays green. The result is
// the quietest failure in the set: the collector stops being scheduled, the
// dataset stops being refreshed, and its validator keeps passing -- because
// stale data is still valid data. The site just serves last year's numbers.
//
// `collect:case-studies` is in that state on purpose today. That decision
// currently lives only in prose (scripts/collect-case-studies.mjs,
// docs/resources/case-studies.md, CONTRIBUTING.md), where no test can tell it
// apart from an accident. The table below puts it on the record, and the
// staleness guards force each entry to be deleted as its collector is
// scheduled.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadWorkflows, repoRoot, runCommands } from './helpers-workflows.mjs';

const scripts =
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).scripts ??
  {};

const workflows = loadWorkflows();

// The namespaces package.json already uses for scripts that write data into
// the repository, matching GENERATOR_NAMESPACES in
// tests/automation-workflow-ordering.test.mjs so a new collector is bound by
// both contracts the moment it is added.
const REFRESH_NAMESPACES = ['collect:', 'fetch:', 'import:', 'generate:'];

// Refresh scripts no workflow runs, keyed by script name with the reason,
// following the GATES_NOT_RUN_BY_CI convention in
// tests/workflow-scripts.test.mjs. Delete an entry when its script joins a
// workflow; the staleness guards below fail if one is left behind.
const REFRESH_NOT_RUN_BY_CI = new Map([
  [
    'collect:case-studies',
    'mirrors cncf.io case studies on demand; there is no scheduled workflow ' +
      'yet, so a maintainer re-runs it manually and commits the refreshed ' +
      'data/case-studies.json (scripts/collect-case-studies.mjs, ' +
      'docs/resources/case-studies.md).',
  ],
  [
    'collect:end-user-talks',
    'mirrors KubeCon NA 2026 Sessionize schedule on demand; the event schedule ' +
      'is fixed after conference dates (November 2026), so a maintainer re-runs ' +
      'it manually if schedule changes occur rather than via cron.',
  ],
]);

// `npm run foo`, `npm run foo -- --bar`, `npm run -s foo`, `npm -s run foo`.
function npmRunTargets(command) {
  const targets = [];
  const pattern = /\bnpm\s+(?:-\S+\s+)*run\s+(?:-\S+\s+)*((?!-)[\w:*.-]+)/g;
  for (const match of command.matchAll(pattern)) targets.push(match[1]);
  return targets;
}

function directWorkflowTargets() {
  const targets = new Set();
  for (const { doc } of workflows) {
    for (const command of runCommands(doc)) {
      for (const target of npmRunTargets(command)) targets.add(target);
    }
  }
  return targets;
}

// A workflow that runs `npm run foo` also runs whatever foo's own package.json
// body runs, so a refresh script chained from another counts as wired. Reading
// only the workflow text would report every such script as unwired and push
// the repository into recording exemptions for scripts CI does in fact run.
function reachableFromWorkflows(
  direct = directWorkflowTargets(),
  table = scripts,
) {
  const reached = new Set(direct);
  const queue = [...reached];
  while (queue.length > 0) {
    const target = queue.pop();
    const body = table[target];
    if (typeof body !== 'string') continue;
    for (const next of npmRunTargets(body)) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

function refreshScripts() {
  return Object.keys(scripts)
    .filter((name) =>
      REFRESH_NAMESPACES.some((namespace) => name.startsWith(namespace)),
    )
    .sort();
}

test('every refresh script is run by a workflow or recorded as exempt', () => {
  const reached = reachableFromWorkflows();
  const unwired = refreshScripts().filter(
    (name) => !reached.has(name) && !REFRESH_NOT_RUN_BY_CI.has(name),
  );
  assert.deepEqual(
    unwired,
    [],
    'refresh scripts defined in package.json that no workflow runs; either ' +
      'add a step for them or record the omission in REFRESH_NOT_RUN_BY_CI ' +
      'with a reason',
  );
});

test('every refresh script this suite recognises is a real script', () => {
  // Pins the guard above to evidence rather than to spelling: if the filter
  // stopped matching anything, the assertion would pass vacuously.
  const refresh = refreshScripts();
  assert.ok(
    refresh.includes('collect:metrics') &&
      refresh.includes('fetch:community-people') &&
      refresh.includes('generate:members'),
    `expected the known refresh scripts to be recognised, got ${refresh.join(', ')}`,
  );
});

test('the scheduled collectors are detected as wired', () => {
  // The other half of the vacuity check: a detector that reached nothing would
  // satisfy the staleness guards while reporting every script as unwired.
  const reached = reachableFromWorkflows();
  for (const name of [
    'collect:metrics',
    'collect:radar-reports',
    'fetch:community-people',
    'collect:enduser-members',
    'generate:members',
  ]) {
    assert.ok(reached.has(name), `expected a workflow to run ${name}`);
  }
});

test('a refresh script chained from another counts as wired', () => {
  // No refresh script is chained this way in package.json today, so the
  // transitive step is pinned against a synthetic table: a workflow that runs
  // `outer` must count `inner` as wired, follow a chain through a non-refresh
  // script, and tolerate a target with no package.json body.
  const table = {
    outer: 'node scripts/outer.mjs && npm run inner',
    inner: 'npm run -s collect:synthetic',
    'collect:synthetic': 'node scripts/collect-synthetic.mjs',
  };
  const reached = reachableFromWorkflows(['outer', 'not-a-script'], table);
  assert.deepEqual([...reached].sort(), [
    'collect:synthetic',
    'inner',
    'not-a-script',
    'outer',
  ]);
  assert.equal(
    reachableFromWorkflows(['collect:synthetic'], table).has('outer'),
    false,
    'reachability follows script bodies forward only',
  );
});

test('every recorded exemption still names a defined script', () => {
  const stale = [...REFRESH_NOT_RUN_BY_CI.keys()].filter(
    (name) => !(name in scripts),
  );
  assert.deepEqual(
    stale,
    [],
    'REFRESH_NOT_RUN_BY_CI names scripts package.json no longer defines',
  );
});

test('every recorded exemption carries a reason', () => {
  const unexplained = [...REFRESH_NOT_RUN_BY_CI.entries()]
    .filter(([, reason]) => typeof reason !== 'string' || reason.trim() === '')
    .map(([name]) => name);
  assert.deepEqual(
    unexplained,
    [],
    'exemptions recorded without saying why the script is not run in CI',
  );
});

test('every recorded exemption names a refresh script', () => {
  // An exemption for something outside the four namespaces would never be
  // consulted by the guard above, so it would sit here reading as a decision
  // that is not actually in force.
  const outside = [...REFRESH_NOT_RUN_BY_CI.keys()].filter(
    (name) => !refreshScripts().includes(name),
  );
  assert.deepEqual(
    outside,
    [],
    'REFRESH_NOT_RUN_BY_CI names scripts outside the refresh namespaces',
  );
});

test('no recorded exemption names a script a workflow already runs', () => {
  // An exemption that is no longer true reads as a standing decision not to
  // schedule something CI does in fact run, and would silently absorb a later
  // removal of that step.
  const reached = reachableFromWorkflows();
  const contradicted = [...REFRESH_NOT_RUN_BY_CI.keys()].filter((name) =>
    reached.has(name),
  );
  assert.deepEqual(
    contradicted,
    [],
    'REFRESH_NOT_RUN_BY_CI records scripts a workflow runs; delete the entry',
  );
});
