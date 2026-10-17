// Resolves the Node version a workflow step pins, whether the step calls
// `actions/setup-node` directly or goes through a local composite action under
// `.github/actions/` that wraps it (`setup-node-deps`). Shared by every
// contract that asks "which Node major does this job run on":
// tests/ci-supply-chain.test.mjs, tests/e2e-coverage-gate.test.mjs and
// tests/netlify-publish-contract.test.mjs. Before the composite action existed
// each of them read `step.with['node-version']` off a setup-node step; once
// the pin moved into the action's input default, a reader that stops at the
// workflow sees no version at all.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export const LOCAL_ACTION_PREFIX = './.github/actions/';
const SETUP_NODE = 'actions/setup-node@';
const ENV_REF = /^\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/;
const INPUT_REF = /^\$\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}$/;

// Every `.github/actions/<name>/action.yml` parsed, keyed by `<name>`. An
// absent directory is an empty map, not an error.
export function loadLocalActions(root) {
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
      // A directory without a manifest is not an action; the supply-chain
      // contract reports it, this resolver just does not see it.
    }
  }
  return actions;
}

function localActionName(uses) {
  if (!uses.startsWith(LOCAL_ACTION_PREFIX)) return null;
  return uses.slice(LOCAL_ACTION_PREFIX.length).split('@')[0];
}

function setupNodeStepOf(action) {
  return (action?.runs?.steps ?? []).find((step) =>
    String(step?.uses ?? '').startsWith(SETUP_NODE),
  );
}

// True when the step installs Node: a direct setup-node step, or a local
// composite action that carries one.
export function isNodeSetupStep(step, actions = new Map()) {
  const uses = String(step?.uses ?? '');
  if (uses.startsWith(SETUP_NODE)) return true;
  const name = localActionName(uses);
  return name !== null && setupNodeStepOf(actions.get(name)) !== undefined;
}

export function findNodeSetupStep(steps, actions = new Map()) {
  return (steps ?? []).find((step) => isNodeSetupStep(step, actions));
}

// `${{ env.X }}` resolves against the workflow's top-level env; a literal is
// returned as a string; an undefined declaration or a dangling reference is
// null, which callers treat as "pins nothing".
function resolveEnv(declared, doc) {
  if (declared === undefined) return null;
  const literal = String(declared);
  const fromEnv = literal.match(ENV_REF);
  if (!fromEnv) return literal;
  const resolved = doc?.env?.[fromEnv[1]];
  return resolved === undefined ? null : String(resolved);
}

// The Node version the step pins, as a string, or null when it pins none.
// For a composite action the workflow's `with.node-version` wins; otherwise
// the action's own setup-node step is read, following a
// `${{ inputs.<name> }}` indirection to that input's default.
export function pinnedNodeVersion(step, doc, actions = new Map()) {
  const uses = String(step?.uses ?? '');
  const declared = step?.with?.['node-version'];
  if (uses.startsWith(SETUP_NODE)) return resolveEnv(declared, doc);
  const action = actions.get(localActionName(uses) ?? '');
  const inner = setupNodeStepOf(action);
  if (!inner) return null;
  if (declared !== undefined) return resolveEnv(declared, doc);
  const innerDeclared = inner.with?.['node-version'];
  if (innerDeclared === undefined) return null;
  const literal = String(innerDeclared);
  const fromInput = literal.match(INPUT_REF);
  if (!fromInput) return literal;
  const fallback = action.inputs?.[fromInput[1]]?.default;
  return fallback === undefined ? null : String(fallback);
}

export function nodeMajor(version) {
  return version === null ? null : String(version).split('.')[0];
}
