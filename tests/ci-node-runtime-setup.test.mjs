// Guards that a job which runs `node`, `npm` or `npx` installs Node first.
//
// A `run:` step inherits whatever interpreter the runner image happens to
// ship. That is not a property of the workflow, it is a property of the
// machine the job lands on, and `runs-on: ubuntu-24.04` does not pin a
// machine: a self-hosted runner registered at the organisation level may
// advertise the same label, and GitHub will route the job to it. The image
// behind that label is then somebody else's to change.
//
// This repository found out the expensive way. The `classify` job gated every
// other job in ci.yml (`needs: classify`) and called
//
//     node --input-type=module -e "import { runClassifier } from
//     './scripts/lib/content-only-ci.mjs'; runClassifier()"
//
// with no Node setup step — alone among that workflow's jobs, which all go
// through `./.github/actions/setup-node-deps`. It worked for as long as every
// job drew a GitHub-hosted runner. The first time a run was routed to a
// self-hosted runner whose image carries no `node`, the step died on
// `node: command not found` (exit 127) and took the workflow's gate with it,
// while the four jobs in the same run on the same runner reported success,
// because each of them had installed its own Node.
//
// The failure therefore had nothing to do with the pull request it appeared
// on, which is the part that makes it worth a contract: a red check that
// tracks runner routing rather than the diff teaches contributors to re-run
// checks until the lottery comes out right.
//
// The rule is narrow. It is not "every job must set up Node" — a job that
// never invokes the runtime has nothing to install. It is: if a step's script
// invokes the Node runtime, some earlier step in that job must install it,
// whether directly via `actions/setup-node` or through a local composite
// action that wraps it. `npm` and `npx` count, since neither runs without
// Node.
//
// Ordering is part of the rule rather than a refinement of it. A setup step
// placed after the step that needs Node satisfies "the job sets up Node" and
// still fails, so the scan reports a step whose Node arrives too late exactly
// as it reports a step whose Node never arrives.
//
// What this does not check: that the installed Node is the right major
// (tests/dev-environment.test.mjs holds every pin against the devcontainer),
// that the action is pinned to a digest (tests/ci-supply-chain.test.mjs), or
// that dependencies are installed — a script importing only `node:` builtins
// correctly skips `npm ci`, and requiring it here would push a gating job
// through an install it does not need.
//
// The allowlist below follows the convention used by the other workflow
// contracts in this suite: an exemption stays possible but has to be argued
// for in writing, and the staleness guard deletes the entry once the step
// stops needing it.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  jobEntries,
  loadWorkflows,
  stepLabel,
  walkSteps,
} from './helpers-workflows.mjs';
import { isNodeSetupStep, loadLocalActions } from './helpers-node-setup.mjs';

// `<workflow>#<job>#<step>` → why that step may invoke the Node runtime
// without a preceding setup step. Empty today: every step that runs node,
// npm or npx installs Node first. An entry here records a known defect while
// its fix is pending, never a step that is allowed to stay as it is; the
// staleness guard below fails once the step gains a setup step.
const NODE_SETUP_EXEMPT_STEPS = new Map([]);

// The commands that do not start without a Node runtime on PATH.
const RUNTIME_COMMANDS = ['node', 'npm', 'npx'];

// A command token sits at the start of the script, or follows a separator, and
// may be preceded by inline `VAR=value` assignments. Anchoring this way is
// what keeps `node_modules`, `nodejs`, `--node-version` and a bare mention in
// prose out of the result: the first two fail the trailing `\b` against the
// following character, and the third never reaches a command position.
const RUNTIME_AT_COMMAND_POSITION = new RegExp(
  String.raw`(?:^|[\n;&|(])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:${RUNTIME_COMMANDS.join('|')})\b`,
);

// Blanks what a shell would not read as a command: a `#` comment that starts a
// token, and the contents of quoted spans, so `echo "npm ci"` is not mistaken
// for an invocation. Unlike the character-by-character reader in
// tests/ci-shell-errexit.test.mjs this does not need to preserve line
// structure, because the pattern above treats a newline as just another
// separator.
function withoutQuotedAndCommented(run) {
  return String(run)
    .replace(/'[^']*'/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/(^|[\s;&|(])#[^\n]*/g, '$1');
}

export function invokesNodeRuntime(run) {
  if (typeof run !== 'string') return false;
  return RUNTIME_AT_COMMAND_POSITION.test(withoutQuotedAndCommented(run));
}

function stepKey(file, jobId, step, via) {
  return `${file}#${jobId}#${stepLabel(step, via)}`;
}

// Walks a job in execution order and reports each step that reaches for the
// Node runtime before any step has installed it. `seen` latches on the first
// setup step: once Node is on PATH it stays there for the rest of the job.
function stepsNeedingNodeBeforeSetup(job, actions) {
  const offenders = [];
  let seen = false;
  for (const { step, via } of walkSteps(job, { actions })) {
    if (isNodeSetupStep(step, actions)) {
      seen = true;
      continue;
    }
    if (!seen && invokesNodeRuntime(step?.run)) offenders.push({ step, via });
  }
  return offenders;
}

// Every step that reaches for Node before its job installs it, allowlisted or
// not. The caller compares the whole list against the allowlist, so an
// exempted step has to still be an offence for its entry to be justified —
// which is also what makes the staleness guard below able to see it stop
// being one.
function unguardedSteps(workflows, actions) {
  const offenders = [];
  for (const { name, doc } of workflows) {
    for (const [jobId, job] of jobEntries(doc)) {
      for (const { step, via } of stepsNeedingNodeBeforeSetup(job, actions)) {
        offenders.push(stepKey(name, jobId, step, via));
      }
    }
  }
  return offenders.sort();
}

function staleExemptions(workflows, actions, allowlist) {
  const stale = [];
  const byName = new Map(workflows.map(({ name, doc }) => [name, doc]));
  for (const key of allowlist.keys()) {
    const [file, jobId] = key.split('#');
    const job = byName.get(file)?.jobs?.[jobId];
    if (!job) {
      stale.push(`${key} (no such job)`);
      continue;
    }
    const found = stepsNeedingNodeBeforeSetup(job, actions).some(
      ({ step, via }) => stepKey(file, jobId, step, via) === key,
    );
    if (!found) {
      stale.push(`${key} (now sets up Node first — delete this entry)`);
    }
  }
  return stale;
}

// Split out so the loop is exercised against more than the one real entry:
// a map with a populated, a blank and a missing reason proves the check sees
// each shape.
function reasonlessExemptions(allowlist) {
  const bad = [];
  for (const [key, reason] of allowlist) {
    if (typeof reason !== 'string' || reason.length === 0) bad.push(key);
  }
  return bad.sort();
}

const workflows = loadWorkflows();
const localActions = loadLocalActions();

test('every workflow step that runs Node installs it first', () => {
  assert.ok(workflows.length > 0, 'no workflows found under .github/workflows');
  assert.deepEqual(
    unguardedSteps(workflows, localActions),
    [...NODE_SETUP_EXEMPT_STEPS.keys()].sort(),
    'these steps invoke node/npm/npx before any step in their job installs ' +
      'Node, so they run only on a runner image that happens to ship one and ' +
      'fail with "node: command not found" on one that does not',
  );
});

test('the Node setup allowlist carries no stale entries', () => {
  assert.deepEqual(
    staleExemptions(workflows, localActions, NODE_SETUP_EXEMPT_STEPS),
    [],
    'these exemptions no longer describe a step that needs one',
  );
});

test('every Node setup exemption states a reason', () => {
  assert.deepEqual(reasonlessExemptions(NODE_SETUP_EXEMPT_STEPS), []);
  assert.deepEqual(
    reasonlessExemptions(
      new Map([
        ['ci.yml#build#Reasoned', 'argued for here'],
        ['ci.yml#build#Bare', ''],
        ['ci.yml#build#Missing', undefined],
      ]),
    ),
    ['ci.yml#build#Bare', 'ci.yml#build#Missing'],
  );
});

test('invokesNodeRuntime finds the runtime at a command position', () => {
  for (const command of RUNTIME_COMMANDS) {
    assert.equal(invokesNodeRuntime(command), true, command);
  }
  assert.equal(invokesNodeRuntime('  npm ci\n'), true);
  assert.equal(invokesNodeRuntime('npm run build\nnpm test'), true);
  assert.equal(
    invokesNodeRuntime('just build && npx prettier --check .'),
    true,
  );
  assert.equal(invokesNodeRuntime('mkdir out; node scripts/report.mjs'), true);
  assert.equal(invokesNodeRuntime('cat list.txt | npx sort-keys'), true);
  assert.equal(invokesNodeRuntime('(node --version)'), true);

  // The shape the `classify` job was written in: a one-liner with the script
  // passed as `-e`, which is where this contract came from.
  assert.equal(
    invokesNodeRuntime(
      'node --input-type=module -e "import { run } from \'./x.mjs\'; run()"',
    ),
    true,
  );

  // Environment assignments precede the command without displacing it.
  assert.equal(invokesNodeRuntime('TZ=Etc/GMT-14 npm run test:unit'), true);
  assert.equal(invokesNodeRuntime('CI=1 FORCE_COLOR=0 node build.mjs'), true);
});

test('invokesNodeRuntime ignores names that merely contain a command', () => {
  // The traps a looser pattern falls into: a longer word starting with the
  // command name, and the command name as an argument or a path segment.
  assert.equal(invokesNodeRuntime('rm -rf node_modules'), false);
  assert.equal(invokesNodeRuntime('nodejs --version'), false);
  assert.equal(invokesNodeRuntime('npmrc_check'), false);
  assert.equal(invokesNodeRuntime('just build --node-version 22'), false);
  assert.equal(invokesNodeRuntime('echo "run npm ci to install"'), false);
  assert.equal(invokesNodeRuntime("gh api --jq '.node.name' repos/o/r"), false);
  assert.equal(invokesNodeRuntime('# npm ci happens in the next job'), false);
  assert.equal(invokesNodeRuntime('just build # node is not used here'), false);

  // Not a script at all.
  assert.equal(invokesNodeRuntime(undefined), false);
  assert.equal(invokesNodeRuntime(null), false);
  assert.equal(invokesNodeRuntime(''), false);
});

test('a job is reported when its Node setup comes too late', () => {
  const setup = { uses: 'actions/setup-node@v7', with: { 'node-version': 22 } };
  const run = { name: 'Classify', run: 'node scripts/classify.mjs' };

  assert.deepEqual(
    stepsNeedingNodeBeforeSetup({ steps: [setup, run] }, localActions),
    [],
  );
  assert.deepEqual(
    stepsNeedingNodeBeforeSetup({ steps: [run, setup] }, localActions).map(
      ({ step }) => step.name,
    ),
    ['Classify'],
    'a setup step after the step that needs Node does not help it',
  );
  assert.deepEqual(
    stepsNeedingNodeBeforeSetup({ steps: [run] }, localActions).map(
      ({ step }) => step.name,
    ),
    ['Classify'],
  );

  // A step that never reaches for the runtime needs no setup at all.
  assert.deepEqual(
    stepsNeedingNodeBeforeSetup(
      { steps: [{ name: 'Check out', uses: 'actions/checkout@v7' }] },
      localActions,
    ),
    [],
  );
});

test('a local composite action counts as the setup step', () => {
  // The way every other job in ci.yml installs Node: the setup lives inside
  // `./.github/actions/setup-node-deps`, and a scan that only recognised a
  // direct `actions/setup-node` step would report all of them.
  const job = {
    steps: [
      { name: 'Set up Node.js', uses: './.github/actions/setup-node-deps' },
      { name: 'Validate', run: 'npm run check:format' },
    ],
  };
  assert.ok(
    localActions.has('setup-node-deps'),
    'setup-node-deps is gone, so this test no longer proves composite ' +
      'actions are followed — point it at whichever action now wraps setup-node',
  );
  assert.deepEqual(stepsNeedingNodeBeforeSetup(job, localActions), []);
});
