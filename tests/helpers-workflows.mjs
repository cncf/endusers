// The one place the test suite reads .github/workflows/** and
// .github/actions/**. Before this module, fifteen contract tests each carried
// their own readdir-filter-sort-parse loader and their own idea of a job or a
// step, and none of them looked inside a local composite action: a `run:` step
// moved into .github/actions/<name>/action.yml left every scanner's scope at
// once (#1565). `walkSteps()` follows `uses: ./.github/actions/<name>` so a
// step is in scope wherever it sits.
//
// tests/workflow-loader.test.mjs forbids any other test module from reading
// the workflow directory directly, so a new scanner inherits this behaviour
// instead of re-deriving it.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const workflowDir = join(repoRoot, '.github', 'workflows');

export function isWorkflowFile(name) {
  return /\.ya?ml$/.test(name);
}

// Sorted so a failure message lists offenders in a stable order.
export function workflowFiles(dir = workflowDir) {
  return readdirSync(dir).filter(isWorkflowFile).sort();
}

export function readWorkflow(name, dir = workflowDir) {
  const path = join(dir, name);
  const source = readFileSync(path, 'utf8');
  return { name, path, source, doc: parse(source) };
}

// Every workflow in the tree as `{ name, path, source, doc }`.
export function loadWorkflows(dir = workflowDir) {
  return workflowFiles(dir).map((name) => readWorkflow(name, dir));
}

// The same set keyed by file name, for scanners that look workflows up.
export function workflowMap(dir = workflowDir) {
  return new Map(loadWorkflows(dir).map(({ name, doc }) => [name, doc]));
}

export function jobEntries(doc) {
  return Object.entries(doc?.jobs ?? {});
}

export function stepsOf(job) {
  return job?.steps ?? [];
}

export const LOCAL_ACTION_PREFIX = './.github/actions/';

// `setup-node-deps` for `./.github/actions/setup-node-deps`, null for a
// marketplace or remote action.
export function localActionName(uses) {
  if (typeof uses !== 'string' || !uses.startsWith(LOCAL_ACTION_PREFIX)) {
    return null;
  }
  return uses.slice(LOCAL_ACTION_PREFIX.length).split('@')[0];
}

// Every `.github/actions/<name>/action.yml` parsed, keyed by `<name>`. An
// absent directory is an empty map, not an error, and a directory without a
// manifest is not an action: tests/composite-action-supply-chain.test.mjs
// reports that, this loader just does not see it.
export function loadLocalActions(root = repoRoot) {
  const actions = new Map();
  let entries;
  try {
    entries = readdirSync(join(root, '.github/actions'), {
      withFileTypes: true,
    });
  } catch {
    return actions;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, '.github/actions', entry.name, 'action.yml');
    try {
      actions.set(entry.name, parse(readFileSync(path, 'utf8')));
    } catch {
      // see above
    }
  }
  return actions;
}

let repositoryActions = null;
function defaultActions() {
  repositoryActions ??= loadLocalActions();
  return repositoryActions;
}

// Yields `{ step, via }` for each step of a job, descending into local
// composite actions. `via` is the chain of `uses:` references crossed to
// reach the step, empty when it is written in the job itself, so a scanner
// can label a nested offence with where the job pulled it in from.
export function* walkSteps(job, options = {}, via = []) {
  const { followLocalActions = true, actions = defaultActions() } = options;
  for (const step of stepsOf(job)) {
    yield { step, via };
    if (!followLocalActions) continue;
    const action = actions.get(localActionName(step?.uses) ?? '');
    if (action?.runs?.using !== 'composite') continue;
    yield* walkSteps(
      { steps: action.runs.steps },
      { followLocalActions, actions },
      [...via, step.uses],
    );
  }
}

// Every `run:` script across a workflow's jobs, composite steps included.
export function runCommands(doc, options) {
  const commands = [];
  for (const [, job] of jobEntries(doc)) {
    for (const { step } of walkSteps(job, options)) {
      if (typeof step?.run === 'string') commands.push(step.run);
    }
  }
  return commands;
}

// `{ workflow, jobId, job, step, via }` across a whole set of workflows, the
// shape most scanners want when they report `file (job): step`.
export function* walkWorkflowSteps(workflows, options) {
  for (const { name, doc } of workflows) {
    for (const [jobId, job] of jobEntries(doc)) {
      for (const { step, via } of walkSteps(job, options)) {
        yield { workflow: name, jobId, job, step, via };
      }
    }
  }
}

// A label for a step the way the exemption tables in this suite spell them:
// the step's name, or its `uses:`/`run:` when it has none, with the composite
// chain appended so a nested step is distinguishable from a direct one.
export function stepLabel(step, via = []) {
  const own =
    step?.name ??
    step?.id ??
    (typeof step?.uses === 'string' ? step.uses : null) ??
    (typeof step?.run === 'string' ? step.run.trim().split('\n')[0] : null) ??
    '<unnamed step>';
  return via.length === 0 ? own : `${via.join(' > ')} > ${own}`;
}
