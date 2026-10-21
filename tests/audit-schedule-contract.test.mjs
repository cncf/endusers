// Guards where the dependency-audit gate runs.
//
// `scripts/audit-gate.mjs` fails the build when `npm audit` reports a high or
// critical advisory outside the documented allowlist. tests/audit-gate.test.mjs
// covers that script thoroughly -- the classification, the allowlist, its
// parity with SECURITY.md -- but it only ever asks what the gate decides, never
// where it is run. Nothing in the suite reads either of the two lanes that
// actually invoke it.
//
// Those lanes carry different halves of the same contract, and
// .github/workflows/audit-schedule.yml states the split in its own header:
// ci.yml runs the gate on `pull_request` and `merge_group`, so a lockfile
// *change* is always gated, and the scheduled workflow exists because the
// advisory database moves on its own -- an advisory published against the
// lockfile exactly as committed changes no file in the repository, so nothing
// re-runs the gate while main is quiet and the finding waits for whoever
// happens to open the next pull request.
//
// Neither half is asserted anywhere. tests/workflow-scripts.test.mjs only asks
// whether *some* workflow runs each `check:*` gate, and ci.yml satisfies that
// on its own, so deleting audit-schedule.yml outright, or dropping its
// schedule block and leaving it `workflow_dispatch`-only, leaves the whole
// suite green while reverting the repository to exactly the posture the
// workflow was added to fix. The symmetric edit -- removing `merge_group` or
// the `check:audit` step from ci.yml -- is caught by nothing either, and
// tests/ci-gating-jobs.test.mjs reads the job's failure handling rather than
// which gates it runs.
//
// audit-schedule.yml is, after tests/check-links-schedule-contract.test.mjs
// closed the same hole for check-links.yml, the last workflow in the
// repository with no contract test of its own. This file is deliberately the
// same shape as that one, for the reason given there: a scheduled, advisory
// lane is the easiest thing in the repository to delete by accident, because
// no contributor's pull request turns red when it goes.
//
// Three further claims the workflow makes about itself are pinned below.
//
//   * It runs the audit gate and nothing else. The header justifies the
//     scheduled cost as "an `npm ci` plus one `npm audit --package-lock-only`",
//     explicitly not ci.yml's full validate job. Adding `npm test` here is a
//     one-line change that nothing would report, and it would quietly put the
//     daily cron on the same footing as the gate it was kept apart from.
//
//   * Its cron is offset from the other scheduled workflows "so the two do not
//     contend" -- the comment names codeql.yml's 07:31, sixteen minutes
//     earlier. That offset is the sort of detail a later workflow copies
//     wholesale from a sibling, and two identical cron expressions reintroduce
//     the contention the offset was chosen to avoid. The check below is over
//     every scheduled workflow rather than this pair, because the next
//     collision will be between files this comment cannot name yet.
//
//   * "A red run on this workflow is the notification; it opens nothing." The
//     generic permissions guards in tests/ci-supply-chain.test.mjs refuse an
//     unconstrained token and `write-all`, which a narrow `issues: write`
//     passes; this asserts the stronger thing the header claims, which is that
//     the workflow holds no write scope at all.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadWorkflows, repoRoot } from './helpers-workflows.mjs';

const AUDIT_GATE = 'check:audit';
const AUDIT_WORKFLOW = 'audit-schedule.yml';
const PR_WORKFLOW = 'ci.yml';
const PR_TRIGGERS = ['pull_request', 'merge_group'];

const manifest = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);

const workflows = loadWorkflows();

function workflow(name) {
  const found = workflows.find((entry) => entry.name === name);
  assert.ok(found, `${name} no longer exists`);
  return found.doc;
}

// `npm run foo`, `npm run foo -- --bar`, `npm run -s foo`, `npm -s run foo`,
// and the bare `npm test` lifecycle spelling. The first four are the pattern
// tests/automation-workflow-ordering.test.mjs reads workflow steps with; the
// fifth is added here because `npm test` is the single cheapest way to put
// ci.yml's whole validate lane on this workflow's daily cron without ever
// typing `npm run`.
const NPM_RUN =
  /\bnpm\s+(?:-\S+\s+)*(?:run\s+(?:-\S+\s+)*((?!-)[\w:*.-]+)|(test)\b)/gu;

/** @returns {string[]} the package.json scripts a workflow's steps run */
function npmRunTargets(doc) {
  const targets = [];
  for (const job of Object.values(doc.jobs)) {
    for (const step of job.steps) {
      if (typeof step.run !== 'string') continue;
      for (const match of step.run.matchAll(NPM_RUN)) {
        targets.push(...match.slice(1).filter(Boolean));
      }
    }
  }
  return targets;
}

/** @returns {string[]} every cron expression a workflow schedules itself on */
function crons(doc) {
  return (doc.on.schedule ?? []).map((entry) => entry.cron);
}

/** @returns {Array<[string, string]>} the token scopes that are not read-only */
function writeScopes(permissions) {
  return Object.entries(permissions ?? {}).filter(
    ([, level]) => level !== 'read',
  );
}

test(`package.json defines the ${AUDIT_GATE} gate`, () => {
  assert.equal(
    typeof manifest.scripts[AUDIT_GATE],
    'string',
    `${AUDIT_GATE} is the gate both lanes below run; without it this file ` +
      'is asserting against a script name nothing resolves',
  );
});

test(`${PR_WORKFLOW} runs ${AUDIT_GATE} on every pre-merge trigger`, () => {
  const doc = workflow(PR_WORKFLOW);
  const triggers = Object.keys(doc.on);
  for (const trigger of PR_TRIGGERS) {
    assert.ok(
      triggers.includes(trigger),
      `${PR_WORKFLOW} no longer runs on ${trigger}, so a lockfile change can ` +
        `reach main without ${AUDIT_GATE}; ${AUDIT_WORKFLOW} is daily and ` +
        'does not close that window',
    );
  }
  assert.ok(
    npmRunTargets(doc).includes(AUDIT_GATE),
    `${PR_WORKFLOW} no longer runs ${AUDIT_GATE}; the only remaining audit ` +
      `is ${AUDIT_WORKFLOW}'s daily cron, which cannot fail the pull ` +
      'request that introduced the advisory',
  );
});

test(`${AUDIT_WORKFLOW} re-runs ${AUDIT_GATE} daily and on demand`, () => {
  const doc = workflow(AUDIT_WORKFLOW);
  const triggers = Object.keys(doc.on);
  assert.ok(
    triggers.includes('workflow_dispatch'),
    `${AUDIT_WORKFLOW} can no longer be run on demand; a maintainer ` +
      'reacting to a published advisory has to wait for the cron',
  );
  assert.deepEqual(
    crons(doc),
    ['47 7 * * *'],
    `${AUDIT_WORKFLOW} must re-run ${AUDIT_GATE} every day at 07:47 UTC ` +
      'so advisory detection does not wait for a weekly run or a pull request',
  );
});

test(`${AUDIT_WORKFLOW} runs ${AUDIT_GATE} and nothing else`, () => {
  assert.deepEqual(
    npmRunTargets(workflow(AUDIT_WORKFLOW)),
    [AUDIT_GATE],
    `${AUDIT_WORKFLOW} justifies its scheduled cost as an 'npm ci' plus one ` +
      "'npm audit --package-lock-only', deliberately not " +
      `${PR_WORKFLOW}'s validate job; adding another gate here makes that ` +
      'header false and the daily run arbitrarily expensive',
  );
});

test('no two scheduled workflows share a cron expression', () => {
  const byCron = new Map();
  for (const { name, doc } of workflows) {
    for (const cron of crons(doc)) {
      byCron.set(cron, [...(byCron.get(cron) ?? []), name]);
    }
  }
  const collisions = [...byCron.entries()].filter(
    ([, names]) => names.length > 1,
  );
  assert.deepEqual(
    collisions,
    [],
    'these workflows are scheduled on the same cron expression and will ' +
      `contend for runners; ${AUDIT_WORKFLOW} offsets itself from ` +
      `codeql.yml's for exactly that reason: ${JSON.stringify(collisions)}`,
  );
});

test(`${AUDIT_WORKFLOW} holds no write permission`, () => {
  const doc = workflow(AUDIT_WORKFLOW);
  const offenders = [
    ...writeScopes(doc.permissions),
    ...Object.values(doc.jobs).flatMap((job) => writeScopes(job.permissions)),
  ];
  assert.deepEqual(
    offenders,
    [],
    `${AUDIT_WORKFLOW} states that a red run is the notification and that it ` +
      'opens nothing, so it needs no write scope; granting one makes the ' +
      'header false and widens the token on a workflow that runs ' +
      `unattended: ${JSON.stringify(offenders)}`,
  );
});
