// Guards the reference-architecture submission path that MAINTAINERS.md
// promises maintainers: apply `architecture-ready` to a submission issue and
// .github/workflows/architecture-submission.yml turns the issue answers into
// a pull request via scripts/import-architecture-issue.mjs, writing the page
// under docs/architectures/.
//
// Every hop in that chain is a bare string in one file naming something in
// another, and the chain is only exercised by a maintainer labelling a real
// issue — never by `npm test` or by any PR-triggered workflow. A rename
// anywhere in it fails silently: the label is applied, no run starts (or a
// run starts and removes a label nobody set), and the submitter is left
// waiting on a workflow that will never fire.
//
// The sharpest edge is inside the workflow itself. `jobs.<id>.if` cannot see
// the `env` context, so the label gate has to repeat the literal that
// `env.SUBMISSION_LABEL` holds — the workflow's own comment says "keep it in
// sync with the env value above by hand". Nothing checked that by hand pairing
// until now. tests/workflow-scripts.test.mjs only asserts the complementary
// half: that no job-level `if:` *references* `env.` (the #813 regression). It
// cannot tell whether the inlined literal still matches, so changing
// SUBMISSION_LABEL alone leaves the suite green while the gate keeps watching
// the old label and the failure handler strips the new one.
//
// Nothing else in the suite covers this ground.
// tests/automation-workflow-ordering.test.mjs lists this workflow only to
// check step ordering in the generator workflows.
// tests/import-architecture-issue.test.mjs exercises the script directly and
// mirrors one invocation detail (GITHUB_EVENT_PATH), never the label gate or
// the documentation. tests/issue-template-contract.test.mjs validates issue
// forms as GitHub-renderable YAML, not the label they tell submitters to wait
// for. tests/root-docs-links.test.mjs resolves inline Markdown links in root
// docs, so it reaches the issue-template link in MAINTAINERS.md but none of
// the identifiers quoted in its prose.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = new URL('..', import.meta.url);

function repoPath(relativePath) {
  return fileURLToPath(new URL(relativePath, repoRoot));
}

function read(relativePath) {
  return readFileSync(repoPath(relativePath), 'utf8');
}

const WORKFLOW_PATH = '.github/workflows/architecture-submission.yml';
const TEMPLATE_PATH = '.github/ISSUE_TEMPLATE/reference-architecture.yml';
const SCRIPT_PATH = 'scripts/import-architecture-issue.mjs';
const DOCS_DIR = 'docs/architectures';
const NPM_SCRIPT = 'import:architecture-issue';

const workflowSource = read(WORKFLOW_PATH);
const workflow = parse(workflowSource);
const packageJson = JSON.parse(read('package.json'));
const maintainers = read('MAINTAINERS.md');

// The workflow declares the label once, as a workflow-level env value, and
// every other mention of it is supposed to derive from that declaration.
const submissionLabel = workflow?.env?.SUBMISSION_LABEL;

function importJob() {
  const jobs = Object.entries(workflow?.jobs ?? {});
  const match = jobs.find(([, job]) =>
    (job?.steps ?? []).some(
      (step) => typeof step?.run === 'string' && step.run.includes(NPM_SCRIPT),
    ),
  );
  assert.ok(match, `no job in ${WORKFLOW_PATH} runs \`npm run ${NPM_SCRIPT}\``);
  return match[1];
}

test('the workflow declares the submission label exactly once, as env', () => {
  assert.equal(
    typeof submissionLabel,
    'string',
    `${WORKFLOW_PATH} must declare env.SUBMISSION_LABEL`,
  );
  assert.ok(
    submissionLabel.length > 0,
    'env.SUBMISSION_LABEL must not be empty',
  );
});

test('a labelled issue is what triggers the workflow', () => {
  const types = workflow?.on?.issues?.types ?? [];
  assert.ok(
    types.includes('labeled'),
    `${WORKFLOW_PATH} must trigger on \`issues: [labeled]\`; got ${JSON.stringify(types)}`,
  );
});

// The hand-sync hazard the workflow's own comment calls out.
test('the job-level label gate inlines the env.SUBMISSION_LABEL value', () => {
  const gate = importJob().if;
  assert.equal(
    typeof gate,
    'string',
    'the import job must gate on the applied label',
  );
  assert.ok(
    gate.includes(`'${submissionLabel}'`),
    `job-level \`if:\` must repeat env.SUBMISSION_LABEL ('${submissionLabel}') ` +
      `because \`jobs.<id>.if\` cannot read the env context; got: ${gate}`,
  );
  assert.ok(
    /github\.event\.label\.name/.test(gate),
    `the gate must compare github.event.label.name; got: ${gate}`,
  );
});

// The failure handler removes the label so the maintainer can re-apply it to
// retry. A literal here would strip the wrong label after a rename, leaving a
// submission permanently un-retryable.
test('the failure handler names the label through the env var only', () => {
  const steps = importJob().steps ?? [];
  const failureStep = steps.find(
    (step) => step?.if === 'failure()' && typeof step?.run === 'string',
  );
  assert.ok(failureStep, `${WORKFLOW_PATH} must comment on failure`);
  assert.ok(
    failureStep.run.includes('SUBMISSION_LABEL'),
    'the failure handler must reference $SUBMISSION_LABEL',
  );
  assert.ok(
    !failureStep.run.includes(submissionLabel),
    `the failure handler must not hardcode '${submissionLabel}'; ` +
      'use $SUBMISSION_LABEL so it cannot drift from env',
  );
  assert.ok(
    failureStep.run.includes('--remove-label'),
    'the failure handler must remove the label so the label can be re-applied to retry',
  );
});

test('the issue template tells submitters the same label name', () => {
  assert.ok(existsSync(repoPath(TEMPLATE_PATH)), `${TEMPLATE_PATH} is missing`);
  assert.ok(
    read(TEMPLATE_PATH).includes(submissionLabel),
    `${TEMPLATE_PATH} must name the \`${submissionLabel}\` label submitters wait for`,
  );
});

test('the workflow reaches the script through the documented npm script', () => {
  const body = packageJson.scripts?.[NPM_SCRIPT];
  assert.equal(
    typeof body,
    'string',
    `package.json must define the \`${NPM_SCRIPT}\` script`,
  );
  assert.ok(
    body.includes(SCRIPT_PATH),
    `\`${NPM_SCRIPT}\` must run ${SCRIPT_PATH}; got: ${body}`,
  );
  assert.ok(existsSync(repoPath(SCRIPT_PATH)), `${SCRIPT_PATH} is missing`);
});

// MAINTAINERS.md is the only place the whole path is written down for a
// human. Each identifier it quotes has to still exist.
test('MAINTAINERS.md names identifiers that still exist', () => {
  const referenced = [TEMPLATE_PATH, SCRIPT_PATH, DOCS_DIR];
  const missingFromDoc = referenced.filter(
    (path) => !maintainers.includes(path),
  );
  assert.deepEqual(
    missingFromDoc,
    [],
    'MAINTAINERS.md no longer documents the full submission path',
  );
  const missingOnDisk = referenced.filter(
    (path) => !existsSync(repoPath(path)),
  );
  assert.deepEqual(
    missingOnDisk,
    [],
    'MAINTAINERS.md documents paths that do not exist',
  );
  assert.ok(
    maintainers.includes(WORKFLOW_PATH.split('/').pop()),
    `MAINTAINERS.md must name ${WORKFLOW_PATH.split('/').pop()} as the workflow the label triggers`,
  );
});

test('MAINTAINERS.md documents the label the workflow actually gates on', () => {
  assert.ok(
    maintainers.includes(`\`${submissionLabel}\``),
    `MAINTAINERS.md must tell maintainers to apply the \`${submissionLabel}\` label`,
  );
});

test('the script writes into the directory MAINTAINERS.md documents', () => {
  assert.ok(
    read(SCRIPT_PATH).includes(`'${DOCS_DIR}'`),
    `${SCRIPT_PATH} must write into ${DOCS_DIR}/, the directory MAINTAINERS.md documents`,
  );
});
