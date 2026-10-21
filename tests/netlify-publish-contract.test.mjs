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
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';

import {
  findNodeSetupStep,
  loadLocalActions,
  pinnedNodeVersion,
} from './helpers-node-setup.mjs';
import { readWorkflow } from './helpers-workflows.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const localActions = loadLocalActions(repoRoot);

const netlify = parseToml(readFileSync(join(repoRoot, 'netlify.toml'), 'utf8'));
const ci = readWorkflow('ci.yml').doc;
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
  const setupNode = findNodeSetupStep(ci.jobs?.validate?.steps, localActions);
  assert.ok(setupNode, 'ci.yml validate job has no Node setup step');
  assert.equal(
    netlify.build?.environment?.NODE_VERSION,
    pinnedNodeVersion(setupNode, ci, localActions),
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

// Response headers. They are the only part of the site's security policy that
// lives outside the build, so a missing block here is a live regression the
// unit suite would not otherwise see.
//
// Strict-Transport-Security is pinned for a reason the others do not have: it
// is the only header in the set whose absence is invisible from a response.
// The others are missing controls on a response the visitor did receive; this
// one is the difference between a browser that refuses to speak http:// to
// this host at all and one that makes a strippable cleartext request first.
// Netlify sends nothing by default, so the value in netlify.toml is the whole
// control.
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

const headerRules = Array.isArray(netlify.headers) ? netlify.headers : [];

function headersFor(path) {
  return headerRules.find((rule) => rule.for === path)?.values ?? {};
}

function cspDirectives(policy) {
  return new Map(
    policy
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources.join(' ')]),
  );
}

// Directives no policy may leave out: the fetch fallback (default-src), the
// ones default-src does not cover (base-uri, form-action, frame-ancestors) and
// a flat object-src denial. A block missing one fails here, not in production.
const CSP_BASELINE = {
  'default-src': null,
  'object-src': "'none'",
  'base-uri': null,
  'form-action': null,
  'frame-ancestors': "'self'",
};

test('every response carries the site-wide security headers', () => {
  const values = headersFor('/*');
  for (const [header, expected] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(
      values[header],
      expected,
      `netlify.toml [[headers]] for "/*" must send ${header}: ${expected}`,
    );
  }
});

test('the page Permissions-Policy denies the powerful features the site never uses', () => {
  // Only denials: the site requests no permission, so an allowlist entry here
  // would be one nothing needs.
  const features = new Map(
    headersFor('/*')
      ['Permissions-Policy'].split(',')
      .map((entry) => entry.trim().split('=')),
  );
  for (const feature of 'camera geolocation microphone payment usb'.split(
    ' ',
  )) {
    assert.ok(features.has(feature), `Permissions-Policy leaves ${feature} on`);
  }
  for (const [feature, allowlist] of features) {
    assert.equal(allowlist, '()', `Permissions-Policy grants ${feature}`);
  }
});

test('every [[headers]] block that sends a CSP names the baseline directives', () => {
  const withCsp = headerRules.filter(
    (rule) => rule.values?.['Content-Security-Policy'],
  );
  assert.ok(
    withCsp.some((rule) => rule.for === '/*'),
    'no CSP for "/*"',
  );
  for (const rule of withCsp) {
    const directives = cspDirectives(rule.values['Content-Security-Policy']);
    for (const [name, value] of Object.entries(CSP_BASELINE)) {
      assert.ok(directives.get(name), `"${rule.for}" CSP lacks ${name}`);
      if (value) assert.equal(directives.get(name), value, rule.for);
    }
  }
});

test('the page CSP header is the production meta policy plus header-only directives', async () => {
  // Both copies are enforced, so a directive widened in only one of them
  // would silently lose to the other. The production config is the one that
  // ships; the dev policy adds 'unsafe-eval' for the webpack dev server.
  // docusaurus.config.js calls require.resolve() for its plugin list.
  globalThis.require ??= createRequire(import.meta.url);
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const config = (await import('../docusaurus.config.js?production')).default;
  if (previous === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
  const meta = config.headTags.find(
    (tag) => tag.attributes?.['http-equiv'] === 'Content-Security-Policy',
  );
  const expected = new Map([
    ['frame-ancestors', "'self'"],
    ['default-src', "'self'"],
    ...cspDirectives(meta.attributes.content),
    ['upgrade-insecure-requests', ''],
  ]);
  const header = cspDirectives(headersFor('/*')['Content-Security-Policy']);
  assert.deepEqual(Object.fromEntries(header), Object.fromEntries(expected));
});

test('the Referrer-Policy header matches the document meta policy', async () => {
  // Two policies for one site would have the header win on non-HTML
  // responses and the meta tag win on documents; keeping them equal means
  // the two tests that reason about referrer leakage reason about one value.
  globalThis.require ??= createRequire(import.meta.url);
  const config = (await import('../docusaurus.config.js')).default;
  const meta = config.headTags.find(
    (tag) => tag.tagName === 'meta' && tag.attributes?.name === 'referrer',
  );
  assert.equal(headersFor('/*')['Referrer-Policy'], meta.attributes.content);
});

// Asset-scoped rules (#1501). A browser that navigates to an SVG renders it
// as a document in this origin and executes any script it carries; the <meta>
// policy never reaches that response, so this flat denial is the second layer
// behind the validate:architecture-assets parser gates. The denial needs no
// host list, so it cannot drift from the allowlists in docusaurus.config.js.
//
// default-src 'none' is part of that denial (#1684): a fetch directive this
// header does not name is unrestricted rather than inherited, so before it the
// rules stopped a directly-opened SVG from running script while leaving it
// free to fetch an image, stylesheet, font or <iframe> from any host. The
// three allowances name what the committed SVGs use -- inline styles, inline
// data: images -- plus same-origin fonts for parity with docusaurus.config.js.
// form-action and base-uri are the same point made the other way round
// (#1692): they are navigation directives, not fetch directives, so
// default-src is not their fallback either. A directly-opened SVG renders the
// HTML inside <foreignObject>, and script-src 'none' leaves that HTML inert
// but does not constrain a <form> -- its submission, and whatever the visitor
// typed into it, goes wherever the diagram's author pointed it while the
// address bar reads as this origin. 'none' rather than the 'self' that
// docusaurus.config.js sends for pages: a response under static/img submits no
// form and resolves nothing against a <base>.
const ASSET_HEADER_PATHS = ['/img/*', '/favicons/*'];

const ASSET_CSP_DENIALS = [
  "default-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "script-src 'none'",
  "object-src 'none'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
];

test('asset paths deny script and object without dropping a site-wide header', () => {
  // Every site-wide value is restated, derived from SECURITY_HEADERS so the
  // two can never drift; the CSP is the flat denial instead of the page policy.
  const expected = {
    ...SECURITY_HEADERS,
    'Permissions-Policy': headersFor('/*')['Permissions-Policy'],
    'Content-Security-Policy': [
      "frame-ancestors 'self'",
      ...ASSET_CSP_DENIALS,
    ].join('; '),
  };
  for (const path of ASSET_HEADER_PATHS) {
    const values = headersFor(path);
    for (const [header, want] of Object.entries(expected)) {
      assert.equal(
        values[header],
        want,
        `netlify.toml [[headers]] for "${path}" must send ${header}: ${want}`,
      );
    }
  }
});

test('every served SVG falls under an asset header rule', () => {
  // A rule like "/img/*" covers anything under that directory, so a static/
  // walk is the ground truth for "every path that serves an SVG": an SVG
  // added to a directory no rule covers would be a gap the validators do
  // not see.
  const svgPaths = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.svg'))
        svgPaths.push(relative(join(repoRoot, 'static'), full));
    }
  };
  walk(join(repoRoot, 'static'));
  assert.ok(svgPaths.length > 0, 'static/ serves no SVGs');
  const uncovered = svgPaths.filter(
    (path) =>
      !ASSET_HEADER_PATHS.some((rule) => path.startsWith(rule.slice(1, -1))),
  );
  assert.deepEqual(
    uncovered,
    [],
    'SVGs served from paths no asset header rule covers',
  );
});
