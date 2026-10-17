// Pins the operational claims GOVERNANCE.md makes about the PR queue hygiene
// job to the script and workflow that implement them.
//
// GOVERNANCE.md is the one top-level policy document nothing under tests/
// reads. Its "Operational status" paragraph and its agent-automation rule
// both state concrete, checkable facts: the label the job applies, the three
// hold labels it (and every agent) must respect, the 48-hour threshold, and
// the committed, scheduled workflow file. scripts/pr-queue-hygiene.mjs
// hardcodes the same label set and threshold independently, and
// .github/workflows/pr-queue-hygiene.yml owns the schedule. Nothing tied the
// prose to either, so the drift that #1329 and #1335 found in AGENTS.md and
// CONTRIBUTING.md (a ratchet landing in code while the documented number
// stayed put) could land here with the suite green.
//
// The assertions read the labels from the document's own prose rather than
// from a hand-maintained list, so adding a fourth hold label to the script
// without documenting it fails, and documenting one the script ignores fails
// too.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readWorkflow } from './helpers-workflows.mjs';
import test from 'node:test';

import {
  HOLD_LABELS,
  LABEL,
  STALE_HOURS,
} from '../scripts/pr-queue-hygiene.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const governance = readFileSync(join(repoRoot, 'GOVERNANCE.md'), 'utf8');

const WORKFLOW_PATH = '.github/workflows/pr-queue-hygiene.yml';
const SCRIPT_PATH = 'scripts/pr-queue-hygiene.mjs';

/**
 * The hold labels a sentence names as a backticked `a` / `b` / `c` or
 * `a`, `b`, or `c` list. Both phrasings appear in GOVERNANCE.md; the policy
 * rule uses slashes, the operational paragraph uses commas.
 *
 * @param {string} sentence
 * @returns {Set<string>}
 */
export function holdLabelsNamedIn(sentence) {
  return new Set([...sentence.matchAll(/`([a-z-]+)`/g)].map(([, l]) => l));
}

/**
 * Each sentence of the document that mentions all of "label" and at least
 * one hold-label token, so the assertions below do not depend on the exact
 * surrounding wording.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function holdLabelSentences(text) {
  return text
    .replace(/\n/g, ' ')
    .split(/(?<=\.)\s+/)
    .filter(
      (sentence) =>
        /\blabel(?:s|ed)?\b/.test(sentence) &&
        /`(?:hold|on-hold|do-not-merge)`/.test(sentence),
    );
}

test('GOVERNANCE.md names the hygiene script and its workflow, and both exist', () => {
  assert.ok(
    governance.includes(`\`${SCRIPT_PATH}\``),
    `GOVERNANCE.md no longer names ${SCRIPT_PATH}`,
  );
  assert.ok(
    governance.includes(`\`${WORKFLOW_PATH}\``),
    `GOVERNANCE.md no longer names ${WORKFLOW_PATH}`,
  );
  assert.ok(existsSync(join(repoRoot, SCRIPT_PATH)));
  assert.ok(existsSync(join(repoRoot, WORKFLOW_PATH)));
});

test('the label GOVERNANCE.md says the job applies is the one the script applies', () => {
  assert.ok(
    governance.includes(`\`${LABEL}\``),
    `GOVERNANCE.md does not name the script's label \`${LABEL}\``,
  );
});

test('every sentence about hold labels names exactly the set the script skips', () => {
  const sentences = holdLabelSentences(governance);
  assert.ok(
    sentences.length >= 2,
    'expected GOVERNANCE.md to state the hold-label rule in both the agent-automation policy and the operational-status paragraph',
  );
  for (const sentence of sentences) {
    const named = holdLabelsNamedIn(sentence);
    for (const label of ['labels', 'label']) named.delete(label);
    assert.deepEqual(
      [...named].sort(),
      [...HOLD_LABELS].sort(),
      `GOVERNANCE.md names a different hold-label set than HOLD_LABELS in ${SCRIPT_PATH}:\n  ${sentence.trim()}`,
    );
  }
});

test('the documented conflict threshold is the one the script enforces', () => {
  const stated = [
    ...governance
      .replace(/\s+/g, ' ')
      .matchAll(
        /conflict(?:ing)? with the base branch for more than (\d+) hours/g,
      ),
  ].map(([, hours]) => Number(hours));
  assert.ok(
    stated.length >= 2,
    'expected GOVERNANCE.md to state the threshold in both the policy and the operational paragraph',
  );
  for (const hours of stated) {
    assert.equal(
      hours,
      STALE_HOURS,
      `GOVERNANCE.md says ${hours} hours; ${SCRIPT_PATH} enforces STALE_HOURS = ${STALE_HOURS}`,
    );
  }
});

test('the workflow GOVERNANCE.md says runs on a schedule is scheduled and runs the script', () => {
  const workflow = readWorkflow(basename(WORKFLOW_PATH)).source;
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf8'),
  );
  assert.match(
    workflow,
    /^\s*schedule:\s*\n\s*- cron:/m,
    `${WORKFLOW_PATH} has no schedule trigger, but GOVERNANCE.md says it "runs on a schedule"`,
  );
  // The workflow runs the script through its npm alias, so the chain is
  // workflow -> package.json script -> file.
  const [, alias] = workflow.match(/run:\s*npm run (\S+)/) ?? [];
  assert.ok(alias, `${WORKFLOW_PATH} runs no npm script`);
  assert.ok(
    manifest.scripts?.[alias]?.includes(SCRIPT_PATH),
    `${WORKFLOW_PATH} runs \`npm run ${alias}\`, which does not invoke ${SCRIPT_PATH}`,
  );
});

// Fixtures: the parsers are exercised on the exact drift they exist to catch.

test('fixture: a sentence that adds an undocumented label is reported as a different set', () => {
  const [sentence] = holdLabelSentences(
    'Agents must respect `hold` / `on-hold` / `do-not-merge` / `frozen` labels.',
  );
  assert.deepEqual([...holdLabelsNamedIn(sentence)].sort(), [
    'do-not-merge',
    'frozen',
    'hold',
    'on-hold',
  ]);
});

test('fixture: a sentence about labels that names no hold label is not a hold-label sentence', () => {
  assert.deepEqual(
    holdLabelSentences(
      'The `roadmap` label marks tracking issues. Unrelated prose follows.',
    ),
    [],
  );
});
