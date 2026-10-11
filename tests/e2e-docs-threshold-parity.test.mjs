// Pins the e2e coverage thresholds CONTRIBUTING.md prints to the values the
// `e2e-coverage` job in .github/workflows/ci.yml actually enforces.
//
// tests/docs-threshold-parity.test.mjs closed this drift class for the *unit*
// lane (#1193): the gate's numbers live in package.json, the documented numbers
// live in prose, and nothing tied them together, so every ratchet opened a
// window where the docs lied. The e2e lane has the same split and was left
// open. Its enforced numbers live in the reporter invocation inside ci.yml's
// `e2e-coverage` job; its documented numbers live in the fenced
// `npm run report:e2e:coverage` recipe in CONTRIBUTING.md's "End-to-end tests"
// section, which exists precisely so a contributor can reproduce the gate
// locally before pushing.
//
// The existing e2e contracts stop short of the values:
//
//   * tests/e2e-coverage-gate.test.mjs holds *floors* under ci.yml's flags, so
//     it fails on a weakened gate but passes on a ratcheted one — which is the
//     direction that silently strands the docs.
//   * tests/contributing-e2e-setup.test.mjs compares the documented recipe to
//     ci.yml by flag *name* only, so a recipe reading `--check-source-regions
//     90` against a gate of 96 satisfies it.
//
// Between them a ratchet of ci.yml is green while CONTRIBUTING.md keeps
// printing the old number, and a contributor who runs the documented command
// renders a report that passes locally and fails in CI — the one thing the
// recipe is there to rule out. That the number does drift is not hypothetical:
// tests/e2e-coverage-report-file-region-floor.test.mjs described the job as
// asking for 95% source regions long after #1232's gate moved to 96.
//
// The parsers below are pure functions of their input text so the fixtures at
// the bottom can prove each assertion actually goes red. A parity check nobody
// has seen fail is indistinguishable from one that cannot.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const COVERAGE_JOB = 'e2e-coverage';
const REPORT_SCRIPT = 'report:e2e:coverage';
const INVOCATION = `npm run ${REPORT_SCRIPT}`;

// Only the threshold flags: `--require-source-files` and friends are
// present-or-absent switches carrying no value, and flag *presence* is already
// tests/contributing-e2e-setup.test.mjs's contract.
function thresholdFlags(tokens) {
  const flags = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].startsWith('--check-')) {
      flags.set(tokens[index], tokens[index + 1]);
    }
  }
  return flags;
}

// Both sources wrap the argument list over several lines with backslash
// continuations. Folding those away makes the flags readable without making
// the line wrapping part of the contract.
function fold(text) {
  return text.replace(/\\\n/gu, ' ');
}

function workflowThresholds(workflowText) {
  const job = parse(workflowText).jobs[COVERAGE_JOB];
  if (!job) return null;
  // Every `run:` in the job, joined: the invocation is a line continuation
  // inside one of them, and which step carries it is not the contract.
  const commands = job.steps
    .map((step) => step.run)
    .filter((run) => typeof run === 'string')
    .join('\n');
  const start = commands.indexOf(INVOCATION);
  if (start === -1) return null;
  // The invocation is one logical line inside a larger `run:` block; take it
  // and nothing after it.
  const line = fold(commands.slice(start)).split('\n')[0];
  return thresholdFlags(line.trim().split(/\s+/));
}

// Read from inside the fenced block rather than from the file at large: a
// number named only in the surrounding prose is not something a contributor
// runs, and the prose around this recipe discusses the gate in general terms.
function documentedThresholds(source) {
  const start = source.indexOf(INVOCATION);
  if (start === -1) return null;
  const fence = source.indexOf('```', start);
  if (fence === -1) return null;
  return thresholdFlags(fold(source.slice(start, fence)).trim().split(/\s+/));
}

function assertParity(enforced, documented) {
  assert.ok(
    enforced,
    `.github/workflows/ci.yml must run "${INVOCATION}" in its ${COVERAGE_JOB} job; a gate no workflow invokes has no values to mirror`,
  );
  assert.ok(
    documented,
    `CONTRIBUTING.md must keep a fenced "${INVOCATION}" recipe; the e2e threshold parity contract has nothing to compare`,
  );
  assert.ok(
    enforced.size > 0,
    `${COVERAGE_JOB} passes ${INVOCATION} no --check-* threshold; restore the gate or retire this contract`,
  );
  assert.deepEqual(
    Object.fromEntries(documented),
    Object.fromEntries(enforced),
    'CONTRIBUTING.md documents e2e coverage thresholds that ci.yml does not enforce; ' +
      'update the recipe in the same commit as the ratchet so a local render ' +
      'cannot pass where CI fails',
  );
}

const workflowText = readFileSync(
  join(repoRoot, '.github', 'workflows', 'ci.yml'),
  'utf8',
);
const contributing = readFileSync(join(repoRoot, 'CONTRIBUTING.md'), 'utf8');

test('CONTRIBUTING.md documents the e2e coverage thresholds ci.yml enforces', () => {
  assertParity(
    workflowThresholds(workflowText),
    documentedThresholds(contributing),
  );
});

// --- fixtures: each proves one arm above can fail -------------------------

const FIXTURE_WORKFLOW = `jobs:
  ${COVERAGE_JOB}:
    steps:
      - run: npm ci
      - run: |
          ${INVOCATION} -- \\
            --check-source 100 \\
            --check-source-regions 96 \\
            --require-source-files
      - run: echo done
`;

const FIXTURE_DOC = `Run it locally:

\`\`\`bash
${INVOCATION} -- \\
  --check-source 100 \\
  --check-source-regions 96 \\
  --require-source-files
\`\`\`

Prose after the block mentioning 90% on purpose.
`;

test('the fixtures agree, so a disagreement below is the fixture edit', () => {
  assert.deepEqual(Object.fromEntries(workflowThresholds(FIXTURE_WORKFLOW)), {
    '--check-source': '100',
    '--check-source-regions': '96',
  });
  assertParity(
    workflowThresholds(FIXTURE_WORKFLOW),
    documentedThresholds(FIXTURE_DOC),
  );
});

test('a documented threshold below the enforced one fails', () => {
  const stale = FIXTURE_DOC.replace(
    '--check-source-regions 96',
    '--check-source-regions 90',
  );
  assert.notEqual(stale, FIXTURE_DOC, 'fixture is stale');
  assert.throws(
    () =>
      assertParity(
        workflowThresholds(FIXTURE_WORKFLOW),
        documentedThresholds(stale),
      ),
    /thresholds that ci\.yml does not enforce/u,
  );
});

test('a threshold the docs drop entirely fails', () => {
  const dropped = FIXTURE_DOC.replace('  --check-source-regions 96 \\\n', '');
  assert.notEqual(dropped, FIXTURE_DOC, 'fixture is stale');
  assert.throws(
    () =>
      assertParity(
        workflowThresholds(FIXTURE_WORKFLOW),
        documentedThresholds(dropped),
      ),
    /thresholds that ci\.yml does not enforce/u,
  );
});

test('a workflow that stops invoking the reporter fails', () => {
  const silent = FIXTURE_WORKFLOW.replace(INVOCATION, 'echo skipped');
  assert.equal(workflowThresholds(silent), null);
  assert.throws(
    () =>
      assertParity(
        workflowThresholds(silent),
        documentedThresholds(FIXTURE_DOC),
      ),
    /a gate no workflow invokes/u,
  );
});

test('a workflow that drops the coverage job entirely fails', () => {
  const removed = FIXTURE_WORKFLOW.replace(`${COVERAGE_JOB}:`, 'e2e-other:');
  assert.equal(workflowThresholds(removed), null);
  assert.throws(
    () =>
      assertParity(
        workflowThresholds(removed),
        documentedThresholds(FIXTURE_DOC),
      ),
    /a gate no workflow invokes/u,
  );
});

test('a gate that passes no threshold at all fails rather than passing vacuously', () => {
  const bare = `jobs:
  ${COVERAGE_JOB}:
    steps:
      - run: ${INVOCATION} -- --require-source-files
`;
  assert.throws(
    () =>
      assertParity(workflowThresholds(bare), documentedThresholds(FIXTURE_DOC)),
    /no --check-\* threshold/u,
  );
});

test('docs that lose the recipe fail instead of passing vacuously', () => {
  const noCommand = FIXTURE_DOC.replace(INVOCATION, 'npm run test:e2e');
  assert.equal(documentedThresholds(noCommand), null);
  assert.throws(
    () =>
      assertParity(
        workflowThresholds(FIXTURE_WORKFLOW),
        documentedThresholds(noCommand),
      ),
    /must keep a fenced/u,
  );
});

test('an unterminated fence is not read as a recipe', () => {
  const unfenced = FIXTURE_DOC.slice(
    0,
    FIXTURE_DOC.indexOf('--require-source-files'),
  );
  assert.equal(documentedThresholds(unfenced), null);
  assert.throws(
    () =>
      assertParity(
        workflowThresholds(FIXTURE_WORKFLOW),
        documentedThresholds(unfenced),
      ),
    /must keep a fenced/u,
  );
});
