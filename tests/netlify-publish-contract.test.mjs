// Pins the publish contract of netlify.toml (ADR 0005).
//
// Netlify builds and publishes the site from main, so netlify.toml is the
// publish lane the way .github/workflows/deploy-gh-pages.yml was. The same
// reasoning applies: automation pull requests are authored by github.token,
// which never starts ci.yml (#755), so the Netlify build is the only gate
// their data passes before it publishes. The validator set is asserted as
// parity with ci.yml's validate job rather than as a second hand-maintained
// list -- a validator added to ci.yml must be added to validate:all too, or
// this test names the gap.
//
// The remaining assertions pin the shape Netlify reads: the build command has
// to be the script that runs validate:all, the publish directory has to be
// where Docusaurus writes, and the Node version has to match the one ci.yml
// validates against, or the build Netlify runs is not the build CI tested.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const netlify = parseToml(readFileSync(join(repoRoot, 'netlify.toml'), 'utf8'));
const ci = parseYaml(
  readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8'),
);
const packageJson = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);
const scripts = packageJson.scripts ?? {};

function npmRunTargets(command) {
  return [...command.matchAll(/npm run ([a-z0-9:._-]+)/g)].map(
    (match) => match[1],
  );
}

function ciValidators() {
  return new Set(
    (ci.jobs?.validate?.steps ?? [])
      .map((step) => step.run)
      .filter((run) => typeof run === 'string')
      .flatMap(npmRunTargets)
      .filter((target) => target.startsWith('validate:')),
  );
}

test('the Netlify build command is the validating build script', () => {
  assert.equal(netlify.build?.command, 'npm run build:netlify');
  assert.equal(
    scripts['build:netlify'],
    'node scripts/netlify-build.mjs',
    'build:netlify must run the script whose contract tests/netlify-build.test.mjs pins',
  );
});

test('the publish directory is where Docusaurus writes', () => {
  assert.equal(netlify.build?.publish, 'build');
});

test('Netlify builds on the Node version ci.yml validates against', () => {
  const setupNode = (ci.jobs?.validate?.steps ?? []).find((step) =>
    String(step.uses ?? '').startsWith('actions/setup-node@'),
  );
  assert.ok(setupNode, 'ci.yml validate job has no actions/setup-node step');
  assert.equal(
    netlify.build?.environment?.NODE_VERSION,
    String(setupNode.with['node-version']),
  );
});

test('validate:all runs everything the PR lane validates', () => {
  const expected = ciValidators();
  assert.ok(expected.size > 0, 'ci.yml validate job runs no validators');

  const actual = new Set(
    npmRunTargets(scripts['validate:all'] ?? '').filter((target) =>
      target.startsWith('validate:'),
    ),
  );
  const missing = [...expected].filter((target) => !actual.has(target));
  assert.deepEqual(
    missing,
    [],
    'validators ci.yml runs that validate:all does not; the Netlify build is ' +
      'the only gate for automation-authored data (#755), so it must run the ' +
      'full set',
  );
  for (const target of actual) {
    assert.ok(
      Object.hasOwn(scripts, target),
      `validate:all names "${target}", which package.json does not define`,
    );
  }
});

test('validate:all stops at the first failing validator', () => {
  // `&&` is what makes a red validator fail the deploy; `;` or `||` would let
  // the sequence carry on to the build and publish the data anyway.
  const command = scripts['validate:all'];
  const steps = command.split(' && ');
  assert.ok(steps.length > 1, 'validate:all chains nothing');
  for (const step of steps) {
    assert.match(step, /^npm run validate:[a-z-]+$/, step);
  }
});
