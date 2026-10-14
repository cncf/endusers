// Pins the publish contract of netlify.toml (ADR 0005).
//
// Netlify builds and publishes the site from main, so netlify.toml is the
// publish lane the way the retired deploy-gh-pages.yml workflow was. The same
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
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

// docusaurus.config.js calls require.resolve() for its plugin list, which
// Docusaurus supplies through its own loader; the same shim site-config
// tests use lets this file import the config to assert header parity.
globalThis.require ??= createRequire(import.meta.url);

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

// Security response headers (netlify.toml `[[headers]]`).
//
// These exist because the site is no longer on GitHub Pages, which could not
// set a response header at all. The split they encode is the thing worth
// pinning: a directive browsers honour in a <meta> policy stays in
// docusaurus.config.js, where it is built from the host allowlists it shares
// with scripts/lib; a directive browsers ignore there -- frame-ancestors --
// lives here. If the header ever grows a fetch directive, the site has two
// sources of truth for the same policy and they will drift, so that is
// asserted against rather than left to review.

const { default: siteConfig } = await import('../docusaurus.config.js');

function siteHeaders() {
  const rule = (netlify.headers ?? []).find((entry) => entry.for === '/*');
  assert.ok(rule, 'netlify.toml declares no [[headers]] rule covering "/*"');
  return rule.values ?? {};
}

function cspDirectives(policy) {
  return new Map(
    policy
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name.toLowerCase(), values];
      }),
  );
}

test('the response policy refuses cross-origin framing', () => {
  const directives = cspDirectives(
    siteHeaders()['Content-Security-Policy'] ?? '',
  );
  const frameAncestors = directives.get('frame-ancestors');
  assert.ok(
    frameAncestors,
    'no frame-ancestors in the response policy: browsers ignore the directive in the <meta> policy docusaurus.config.js ships, so without it here any origin may frame this site',
  );
  assert.ok(
    !frameAncestors.includes('*') && !frameAncestors.includes("'unsafe-none'"),
    `frame-ancestors ${frameAncestors.join(' ')} admits cross-origin framing`,
  );
});

test('the response policy carries only what a meta policy cannot', () => {
  const directives = cspDirectives(
    siteHeaders()['Content-Security-Policy'] ?? '',
  );
  const extra = [...directives.keys()].filter(
    (name) => name !== 'frame-ancestors',
  );
  assert.deepEqual(
    extra,
    [],
    'the fetch directives are built in docusaurus.config.js from the host allowlists in scripts/lib; restating one here makes two sources of truth for one policy',
  );
});

test('X-Frame-Options agrees with frame-ancestors', () => {
  // A browser old enough to need this header is old enough to ignore
  // frame-ancestors, so the two must not say different things.
  assert.equal(siteHeaders()['X-Frame-Options'], 'SAMEORIGIN');
});

test('responses are held to their declared content type', () => {
  assert.equal(siteHeaders()['X-Content-Type-Options'], 'nosniff');
});

test('the Referrer-Policy header matches the meta policy it extends', () => {
  // The header exists to reach responses that carry no HTML metadata (a .svg
  // or .json opened directly). Two spellings of one policy, so parity is
  // asserted rather than the value restated.
  const meta = siteConfig.headTags.find(
    (tag) => tag.tagName === 'meta' && tag.attributes?.name === 'referrer',
  );
  assert.ok(meta, 'docusaurus.config.js ships no <meta name="referrer">');
  assert.equal(siteHeaders()['Referrer-Policy'], meta.attributes.content);
});
