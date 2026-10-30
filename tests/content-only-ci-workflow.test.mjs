import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { resolveRepoRoot } from './helpers.mjs';
import { readWorkflow } from './helpers-workflows.mjs';

const repoRoot = resolveRepoRoot(import.meta.url);
const workflow = readWorkflow('ci.yml').doc;

function step(jobName, name) {
  const found = workflow.jobs[jobName]?.steps.find(
    (item) => item.name === name,
  );
  assert.ok(found, `missing ${jobName} step "${name}"`);
  return found;
}

test('classifies PR and merge-queue changes with a complete diff base', () => {
  const triggers = workflow.on ?? workflow.true;
  assert.ok(Object.hasOwn(triggers, 'pull_request'));
  assert.ok(Object.hasOwn(triggers, 'merge_group'));

  const classify = workflow.jobs.classify;
  assert.equal(
    classify.outputs.document_only,
    '${{ steps.classify.outputs.document_only }}',
  );
  assert.equal(
    classify.outputs.documents_b64,
    '${{ steps.classify.outputs.documents_b64 }}',
  );
  assert.equal(classify.steps[0].with['fetch-depth'], 0);
  assert.match(classify.steps[1].run, /runClassifier\(\)/u);
});

test('keeps content contracts and the production build on the focused path', () => {
  assert.equal(workflow.jobs.validate.needs, 'classify');
  assert.match(workflow.jobs.validate.if, /!cancelled/u);
  assert.match(
    workflow.jobs.validate.outputs.document_only,
    /needs\.classify\.result/u,
  );
  assert.match(
    workflow.jobs.validate.env.FULL_VALIDATION,
    /needs\.classify\.result/u,
  );
  assert.match(
    workflow.jobs.validate.env.CONTENT_ONLY,
    /document_only == 'true'/u,
  );
  const contracts = step('validate', 'Check content contracts');
  assert.equal(
    contracts.if,
    "${{ !cancelled() && env.CONTENT_ONLY == 'true' }}",
  );
  // The focused path must run every suite that reads an authored document,
  // or a broken README link or unlisted ADR merges unnoticed (#2002).
  const suites = contracts.run
    .replaceAll('\\\n', ' ')
    .trim()
    .split(/\s+/u)
    .slice(2);
  for (const required of [
    'tests/docs-contract.test.mjs',
    'tests/markdown-references.test.mjs',
    'tests/adr-contract.test.mjs',
    'tests/blog-frontmatter.test.mjs',
    'tests/root-docs-links.test.mjs',
    'tests/static-assets.test.mjs',
  ]) {
    assert.ok(suites.includes(required), `focused path omits ${required}`);
  }
  for (const suite of suites) {
    assert.ok(existsSync(join(repoRoot, suite)), `${suite} does not exist`);
  }
  assert.equal(
    step('validate', 'Build production site').run,
    'npm run build:production',
  );
  assert.match(
    step('validate', 'Run unit tests with coverage').if,
    /env\.FULL_VALIDATION/u,
  );
});

test('limits focused lint to changed documents and skips browsers only after validation', () => {
  assert.equal(
    step('lint', 'Check changed-document formatting, spelling, and Markdown')
      .if,
    "${{ !cancelled() && needs.classify.result == 'success' && needs.classify.outputs.document_only == 'true' }}",
  );
  const fullLint = step('lint', 'Run full repository lint');
  assert.match(fullLint.if, /!cancelled\(\)/u);
  assert.match(fullLint.if, /needs\.classify\.result != 'success'/u);
  for (const command of [
    'npm run check:format',
    'npm run check:spelling',
    'npm run check:markdown',
    'npm run check:duplication',
    'npm run check:lint',
    'npm run check:unused',
  ]) {
    assert.ok(
      fullLint.run.includes(command),
      `missing full lint command ${command}`,
    );
  }

  const e2e = workflow.jobs.e2e;
  assert.deepEqual(e2e.needs, ['validate', 'lint']);
  assert.match(e2e.if, /needs\.validate\.result != 'success'/u);
  assert.match(e2e.if, /needs\.lint\.result != 'success'/u);
  assert.match(e2e.if, /needs\.validate\.outputs\.document_only != 'true'/u);

  const coverage = workflow.jobs['e2e-coverage'];
  assert.deepEqual(coverage.needs, ['classify', 'validate', 'lint']);
  assert.match(coverage.if, /needs\.classify\.result != 'success'/u);
  assert.match(coverage.if, /needs\.validate\.result != 'success'/u);
  assert.match(coverage.if, /needs\.lint\.result != 'success'/u);
});

// The focused-validation split gated most of `validate`, `lint` and the browser
// suites behind the full-validation path, but CONTRIBUTING.md describes those
// gates twice: once where contributors are told what to run locally, and again
// in the numbered steps and the suite sections further down. The first
// description was updated and the later ones were not, so the file told
// contributors the dependency advisory gate ran on every PR while a
// document-only PR skipped it. A claim about a gate that no longer holds is
// worse than no claim: it is relied on.
//
// Both shapes of claim are bound to the workflow here. A job named in quotes
// ("End-to-end tests") is claimed to run on every PR only if its job has no
// condition that can skip it; a script named as `npm run <script>` is claimed
// to run on every PR only if the step running it is not gated on
// FULL_VALIDATION.
const contributing = readFileSync(
  join(resolveRepoRoot(import.meta.url), 'CONTRIBUTING.md'),
  'utf8',
).replace(/\s+/gu, ' ');

test('CONTRIBUTING claims a check runs on every PR only when CI never skips it', () => {
  const jobsByName = new Map(
    Object.entries(workflow.jobs).map(([id, job]) => [job.name ?? id, job]),
  );
  const claimedJobs = new Set();
  for (const name of jobsByName.keys())
    if (
      new RegExp(
        `"${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}"[^.]{0,160}?on every PR`,
        'u',
      ).test(contributing)
    )
      claimedJobs.add(name);

  for (const name of claimedJobs)
    assert.equal(
      jobsByName.get(name).if ?? null,
      null,
      `CONTRIBUTING.md says the "${name}" check runs on every PR, but ci.yml gives that job a condition that can skip it`,
    );

  const gatedScripts = new Set(
    Object.values(workflow.jobs)
      .flatMap((job) => job.steps ?? [])
      .filter((step) => String(step.if ?? '').includes('FULL_VALIDATION'))
      .flatMap((step) =>
        [...String(step.run ?? '').matchAll(/npm run ([\w:-]+)/gu)].map(
          (match) => match[1],
        ),
      ),
  );
  assert.ok(
    gatedScripts.has('check:audit'),
    'expected ci.yml to gate npm run check:audit on FULL_VALIDATION; update this test if the gate moved',
  );

  for (const [, script] of contributing.matchAll(
    /`npm run ([\w:-]+)`[^.]{0,160}?on every PR/gu,
  ))
    assert.ok(
      !gatedScripts.has(script),
      `CONTRIBUTING.md says npm run ${script} runs on every PR, but ci.yml gates its step on FULL_VALIDATION`,
    );
});
