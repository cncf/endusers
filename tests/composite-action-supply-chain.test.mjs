// The supply-chain and wiring contract for composite actions under
// .github/actions/**.
//
// Every guard this repository has over CI is scoped to .github/workflows/**.
// ./ci-supply-chain.test.mjs builds its records from that directory alone, and
// each scanner it drives reaches the steps through `steps()` in
// ./helpers-ci-supply-chain.mjs, which walks `doc.jobs.*.steps[]`.
// ./workflow-scripts.test.mjs reads `jobs.*.steps[].run` for the same reason.
//
// A composite action declares its steps under `runs.steps[]`. It is not a job,
// so none of those walks reach it: inside .github/actions/** an action may be
// pinned to a floating tag, carry no trailing version comment for Dependabot
// to refresh, interpolate `${{ github.event.* }}` straight into a `run:` body,
// or invoke an `npm run` target that no longer exists, and every check in the
// repository stays green. A composite `run:` step that omits `shell:` is worse
// still: GitHub fails it at runtime, and nothing here or in any linter this
// repository runs reads that key.
//
// The split below is the one ./ci-supply-chain.test.mjs and
// ./ci-supply-chain-helpers.test.mjs already use. The contract tests assert an
// empty offence list over the real tree; the proof tests drive the same pure
// functions over documents that do offend. That second half is what makes a
// green run here evidence that the contract was checked rather than evidence
// that it found nothing to look at -- and it is load-bearing today, because
// .github/actions/ does not exist on this tree yet. The guard binds the moment
// it does.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import {
  actionsMissingVersionComment,
  scriptInjectionRisks,
  unpinnedActions,
} from './helpers-ci-supply-chain.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const ACTION_DIR = join('.github', 'actions');
const ACTION_FILE = 'action.yml';

const packageScripts =
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).scripts ??
  {};

// The composite actions on disk, as `{ name, source, doc }` records.
//
// An absent .github/actions/ is an absence, not a throw: this repository has
// no composite action yet, and a guard that crashed on that tree could not be
// landed before the directory it guards exists.
export function compositeActionRecords(root) {
  let entries;
  try {
    entries = readdirSync(join(root, ACTION_DIR), { withFileTypes: true });
  } catch {
    return [];
  }
  const records = [];
  for (const entry of entries) {
    // A symlinked action would report the same document under two names, and
    // GitHub does not resolve one anyway.
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const relPath = join(ACTION_DIR, entry.name, ACTION_FILE);
    let source;
    try {
      source = readFileSync(join(root, relPath), 'utf8');
    } catch {
      records.push({ name: relPath, source: null, doc: null });
      continue;
    }
    records.push({ name: relPath, source, doc: parse(source) });
  }
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

// A composite action adapted to the shape the workflow scanners walk.
//
// They read `doc.jobs.*.steps[]` and label each offence with the job name, so
// the action's steps are presented as a single synthetic job called `runs` --
// which is the key they actually live under, and so reads correctly in a
// failure message.
export function asScannerRecord({ name, source, doc }) {
  return {
    name,
    source: source ?? '',
    doc: { jobs: { runs: { steps: doc?.runs?.steps ?? [] } } },
  };
}

export function compositeSteps({ name, doc }) {
  return (doc?.runs?.steps ?? []).map((step, index) => ({
    name,
    index,
    step,
  }));
}

// Actions whose document is missing, unparseable, or not a composite action.
export function malformedActions(records) {
  const problems = [];
  for (const { name, doc } of records) {
    if (!doc) {
      problems.push(`${name}: missing or unreadable`);
      continue;
    }
    if (!doc.name) problems.push(`${name}: no name:`);
    if (!doc.description) problems.push(`${name}: no description:`);
    if (doc.runs?.using !== 'composite')
      problems.push(`${name}: runs.using is not "composite"`);
    if (!(doc.runs?.steps?.length > 0)) problems.push(`${name}: no steps`);
  }
  return problems;
}

// `shell:` is mandatory on a composite `run:` step. GitHub fails the step at
// run time without it, which is a red CI lane and a wasted review cycle for a
// key no editor flags.
export function runStepsWithoutShell(records) {
  const missing = [];
  for (const record of records) {
    for (const { name, index, step } of compositeSteps(record)) {
      if (typeof step?.run !== 'string') continue;
      if (typeof step?.shell === 'string' && step.shell.length > 0) continue;
      missing.push(`${name} step ${index}: run: without shell:`);
    }
  }
  return missing;
}

// `npm run foo`, `npm run foo -- --bar`, `npm run -s foo`, `npm -s run foo`.
// Kept identical to ./workflow-scripts.test.mjs: the two files assert the same
// contract either side of the workflow/action boundary, and a target form one
// of them understood and the other did not would be a hole in whichever side
// drifted.
export function npmRunTargets(command) {
  const targets = [];
  const pattern = /\bnpm\s+(?:-\S+\s+)*run\s+(?:-\S+\s+)*((?!-)[\w:*.-]+)/g;
  for (const match of command.matchAll(pattern)) targets.push(match[1]);
  return targets;
}

export function undefinedNpmTargets(records, scripts) {
  const missing = [];
  for (const record of records) {
    for (const { name, index, step } of compositeSteps(record)) {
      if (typeof step?.run !== 'string') continue;
      for (const target of npmRunTargets(step.run)) {
        // `npm run` with a glob lists matching scripts rather than running
        // one, and package.json declares the `_list:*` helpers that do it.
        if (target.includes('*')) continue;
        if (!(target in scripts))
          missing.push(`${name} step ${index}: ${target}`);
      }
    }
  }
  return missing;
}

// Workflow `uses: ./.github/actions/<name>` references that resolve to no
// action on disk. GitHub fails the whole job on a dangling local reference.
export function danglingLocalActionRefs(workflows, actionNames) {
  const dangling = [];
  for (const { name, doc } of workflows) {
    for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const uses = typeof step?.uses === 'string' ? step.uses : '';
        if (!uses.startsWith(`./${ACTION_DIR}/`)) continue;
        const actionName = uses.slice(`./${ACTION_DIR}/`.length).split('@')[0];
        if (!actionNames.has(actionName))
          dangling.push(`${name} (${jobName}): ${uses}`);
      }
    }
  }
  return dangling;
}

const actions = compositeActionRecords(repoRoot);
const actionNames = new Set(
  actions.map(({ name }) => name.split(/[\\/]/).at(-2)),
);

const workflowDir = join(repoRoot, '.github', 'workflows');
const workflows = readdirSync(workflowDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()
  .map((name) => {
    const source = readFileSync(join(workflowDir, name), 'utf8');
    return { name, source, doc: parse(source) };
  });

// --- the contract, over the real tree ---------------------------------------

test('every composite action is a well-formed composite action', () => {
  assert.deepEqual(malformedActions(actions), []);
});

test('every composite run: step declares a shell', () => {
  assert.deepEqual(runStepsWithoutShell(actions), []);
});

test('every external action a composite action uses is pinned to a SHA', () => {
  assert.deepEqual(unpinnedActions(actions.map(asScannerRecord)), []);
});

test('every pinned use in a composite action carries a version comment', () => {
  assert.deepEqual(actionsMissingVersionComment(actions), []);
});

test('no composite action interpolates an injectable expression', () => {
  assert.deepEqual(scriptInjectionRisks(actions.map(asScannerRecord)), []);
});

test('every npm run target in a composite action exists in package.json', () => {
  assert.deepEqual(undefinedNpmTargets(actions, packageScripts), []);
});

test('every local action a workflow uses exists on disk', () => {
  assert.deepEqual(danglingLocalActionRefs(workflows, actionNames), []);
});

// --- proofs, over documents that do offend ----------------------------------

const SHA = 'b'.repeat(40);

function record(name, source) {
  return { name, source, doc: parse(source) };
}

function composite(steps) {
  return [
    'name: Fixture',
    'description: A fixture composite action.',
    'runs:',
    '  using: composite',
    '  steps:',
    ...steps,
  ].join('\n');
}

test('compositeActionRecords reads an action directory and skips non-directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'composite-actions-'));
  const dir = join(root, ACTION_DIR);
  mkdirSync(join(dir, 'setup'), { recursive: true });
  mkdirSync(join(dir, 'broken'), { recursive: true });
  writeFileSync(
    join(dir, 'setup', ACTION_FILE),
    composite(['    - run: npm ci', '      shell: bash']),
  );
  // A directory with no action.yml, and a stray file beside the directories:
  // neither is an action, and neither may crash the walk.
  writeFileSync(join(dir, 'README.md'), 'not an action\n');

  const found = compositeActionRecords(root);
  assert.deepEqual(
    found.map(({ name }) => name),
    [
      join(ACTION_DIR, 'broken', ACTION_FILE),
      join(ACTION_DIR, 'setup', ACTION_FILE),
    ],
  );
  assert.equal(found[0].doc, null);
  assert.equal(found[1].doc.runs.using, 'composite');
});

test('compositeActionRecords treats a missing directory as an absence', () => {
  const root = mkdtempSync(join(tmpdir(), 'composite-actions-empty-'));
  assert.deepEqual(compositeActionRecords(root), []);
});

test('malformedActions names each way an action stops being one', () => {
  const unreadable = { name: 'a/action.yml', source: null, doc: null };
  assert.deepEqual(malformedActions([unreadable]), [
    'a/action.yml: missing or unreadable',
  ]);

  const bare = record(
    'b/action.yml',
    ['runs:', '  using: node20', '  main: index.js'].join('\n'),
  );
  assert.deepEqual(malformedActions([bare]), [
    'b/action.yml: no name:',
    'b/action.yml: no description:',
    'b/action.yml: runs.using is not "composite"',
    'b/action.yml: no steps',
  ]);

  const good = record(
    'c/action.yml',
    composite(['    - run: npm ci', '      shell: bash']),
  );
  assert.deepEqual(malformedActions([good]), []);
});

test('runStepsWithoutShell flags a run: step with no shell and ignores uses: steps', () => {
  const offending = record(
    'd/action.yml',
    composite([
      `    - uses: actions/checkout@${SHA} # v5`,
      '    - run: npm ci',
      '    - run: npm test',
      "      shell: ''",
    ]),
  );
  assert.deepEqual(runStepsWithoutShell([offending]), [
    'd/action.yml step 1: run: without shell:',
    'd/action.yml step 2: run: without shell:',
  ]);

  const compliant = record(
    'e/action.yml',
    composite(['    - run: npm ci', '      shell: bash']),
  );
  assert.deepEqual(runStepsWithoutShell([compliant]), []);
});

test('the workflow scanners see a composite action once it is adapted', () => {
  const floating = record(
    'f/action.yml',
    composite([
      '    - uses: actions/setup-node@v4',
      '    - run: npm ci',
      '      shell: bash',
    ]),
  );
  assert.deepEqual(unpinnedActions([asScannerRecord(floating)]), [
    'f/action.yml (runs): actions/setup-node@v4',
  ]);
  assert.deepEqual(actionsMissingVersionComment([floating]), [
    'f/action.yml: actions/setup-node@v4',
  ]);

  const injecting = record(
    'g/action.yml',
    composite([
      '    - run: echo "${{ github.event.issue.title }}"',
      '      shell: bash',
    ]),
  );
  assert.deepEqual(scriptInjectionRisks([asScannerRecord(injecting)]), [
    'g/action.yml (runs) step 0 run: ${{ github.event.issue.title }}',
  ]);

  const compliant = record(
    'h/action.yml',
    composite([
      `    - uses: actions/setup-node@${SHA} # v6.0.0`,
      '    - run: npm ci',
      '      shell: bash',
    ]),
  );
  assert.deepEqual(unpinnedActions([asScannerRecord(compliant)]), []);
  assert.deepEqual(actionsMissingVersionComment([compliant]), []);
  assert.deepEqual(scriptInjectionRisks([asScannerRecord(compliant)]), []);
});

test('asScannerRecord survives an action with no steps at all', () => {
  const empty = { name: 'i/action.yml', source: null, doc: null };
  assert.deepEqual(asScannerRecord(empty).doc.jobs.runs.steps, []);
  assert.equal(asScannerRecord(empty).source, '');
});

test('npmRunTargets reads every invocation form package.json scripts use', () => {
  assert.deepEqual(npmRunTargets('npm run check:format'), ['check:format']);
  assert.deepEqual(npmRunTargets('npm run -s _list:check:md'), [
    '_list:check:md',
  ]);
  assert.deepEqual(npmRunTargets('npm -s run build -- --flag'), ['build']);
  assert.deepEqual(npmRunTargets('npm ci && npm run test:unit'), ['test:unit']);
  assert.deepEqual(npmRunTargets('npm run --loglevel=warn'), []);
});

test('undefinedNpmTargets flags a renamed script and ignores a glob listing', () => {
  const offending = record(
    'j/action.yml',
    composite([
      `    - uses: actions/setup-node@${SHA} # v6.0.0`,
      '    - run: npm run check:fromat',
      '      shell: bash',
      '    - run: npm run -s _list:check:*',
      '      shell: bash',
    ]),
  );
  assert.deepEqual(undefinedNpmTargets([offending], { 'check:format': 'x' }), [
    'j/action.yml step 1: check:fromat',
  ]);
  assert.deepEqual(
    undefinedNpmTargets([offending], {
      'check:fromat': 'x',
      'check:format': 'x',
    }),
    [],
  );
});

test('danglingLocalActionRefs flags a reference no action on disk answers', () => {
  const workflow = record(
    'ci.yml',
    [
      'name: CI',
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: ./.github/actions/setup-node-deps',
      '      - uses: ./.github/actions/gone@main',
      `      - uses: actions/checkout@${SHA} # v5`,
      '      - run: npm ci',
      '  empty: {}',
    ].join('\n'),
  );
  assert.deepEqual(
    danglingLocalActionRefs([workflow], new Set(['setup-node-deps'])),
    ['ci.yml (build): ./.github/actions/gone@main'],
  );
  assert.deepEqual(
    danglingLocalActionRefs([workflow], new Set(['setup-node-deps', 'gone'])),
    [],
  );
  assert.deepEqual(danglingLocalActionRefs([{ name: 'x.yml' }], new Set()), []);
});
