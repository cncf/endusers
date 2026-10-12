// Pins the publish contract of .github/workflows/deploy-gh-pages.yml.
//
// The deploy workflow is not just a second CI lane: automation pull requests
// are authored by github.token, which never starts ci.yml (#755), so the
// deploy build job is the only gate their data passes before it publishes.
// Other tests read this workflow generically -- workflow-scripts.test.mjs
// checks that every `npm run` target it names exists, ci-gating-jobs.test.mjs
// that no job swallows its own failure -- but none of them would notice a
// validator quietly dropped from the list, a build that stops being the
// production build, or a deploy job that loses the permissions GitHub Pages
// requires. Each of those ships (or silently stops shipping) the site while
// every existing check stays green.
//
// The validator set is asserted as parity with ci.yml's validate job rather
// than as a second hand-maintained list: ci.yml is the gate contributors see,
// so "the publish lane validates at least everything the PR lane validates"
// is the invariant, and a validator added to ci.yml must be added here too or
// this test names the gap.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workflowDir = join(repoRoot, '.github', 'workflows');

const deploy = parse(
  readFileSync(join(workflowDir, 'deploy-gh-pages.yml'), 'utf8'),
);
const ci = parse(readFileSync(join(workflowDir, 'ci.yml'), 'utf8'));

function steps(job) {
  return job?.steps ?? [];
}

function runCommands(job) {
  return steps(job)
    .map((step) => step.run)
    .filter((run) => typeof run === 'string');
}

function npmRunTargets(command) {
  return [...command.matchAll(/npm run ([a-z0-9:._-]+)/g)].map(
    (match) => match[1],
  );
}

function validatorTargets(job) {
  return new Set(
    runCommands(job)
      .flatMap(npmRunTargets)
      .filter((target) => target.startsWith('validate:')),
  );
}

test('the publish build validates everything the PR lane validates', () => {
  const ciValidators = validatorTargets(ci.jobs?.validate);
  const deployValidators = validatorTargets(deploy.jobs?.build);
  assert.ok(ciValidators.size > 0, 'ci.yml validate job runs no validators');

  const missing = [...ciValidators].filter(
    (target) => !deployValidators.has(target),
  );
  assert.deepEqual(
    missing,
    [],
    'validators ci.yml runs that deploy-gh-pages.yml does not; the deploy ' +
      'build is the only gate for automation-authored data (#755), so it must ' +
      'run the full set',
  );
});

test('the publish build runs the unit suite', () => {
  const targets = runCommands(deploy.jobs?.build).flatMap(npmRunTargets);
  assert.ok(
    targets.some((target) => target.startsWith('test:unit')),
    'deploy build must run the unit suite before publishing',
  );
});

test('the publish build is the production build with its site URLs set', () => {
  const buildStep = steps(deploy.jobs?.build).find((step) =>
    npmRunTargets(step.run ?? '').includes('build:production'),
  );
  assert.ok(buildStep, 'deploy build must run `npm run build:production`');
  // The values are deliberately not pinned: the comment in the workflow says
  // they change when the custom domain goes live. That both are set is the
  // contract -- an unset SITE_URL builds a site whose canonical and Open
  // Graph URLs point at the Docusaurus default.
  for (const name of ['SITE_URL', 'BASE_URL']) {
    const value = buildStep.env?.[name];
    assert.ok(
      typeof value === 'string' && value.trim() !== '',
      `the production build step must set ${name}`,
    );
  }
});

test('the publish build uploads the built site as the Pages artifact', () => {
  const upload = steps(deploy.jobs?.build).find((step) =>
    String(step.uses ?? '').startsWith('actions/upload-pages-artifact@'),
  );
  assert.ok(upload, 'deploy build must upload a Pages artifact');
  assert.equal(
    upload.with?.path,
    './build',
    'the Pages artifact must be the Docusaurus build output',
  );
});

test('the deploy job waits for the gate and holds least-privilege permissions', () => {
  const job = deploy.jobs?.deploy;
  assert.ok(job, 'deploy job is missing');
  assert.equal(
    job.needs,
    'build',
    'deploy must not start until the gating build job passes',
  );
  assert.equal(job.environment?.name, 'github-pages');
  // Exactly these two scopes: dropping one breaks publishing silently on the
  // next push to main, and any extra scope hands the publish job write access
  // it has no reason to hold.
  assert.deepEqual(job.permissions, { pages: 'write', 'id-token': 'write' });
  assert.ok(
    steps(job).some((step) =>
      String(step.uses ?? '').startsWith('actions/deploy-pages@'),
    ),
    'deploy job must invoke actions/deploy-pages',
  );
});

test('the workflow publishes pushes to main and nothing broader', () => {
  assert.deepEqual(deploy.on?.push?.branches ?? deploy.true?.push?.branches, [
    'main',
  ]);
  assert.equal(
    deploy.permissions?.contents,
    'read',
    'workflow-level permissions must stay read-only; the deploy job elevates ' +
      'its own scopes explicitly',
  );
});
