import assert from 'node:assert/strict';
import test from 'node:test';

import { readWorkflow } from './helpers-workflows.mjs';

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
  assert.equal(
    step('validate', 'Check content contracts').if,
    "${{ !cancelled() && env.CONTENT_ONLY == 'true' }}",
  );
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
