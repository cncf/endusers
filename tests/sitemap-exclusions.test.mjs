// Guards the sitemap `ignorePatterns` contract in docusaurus.config.js.
//
// `ignorePatterns` is the only sitemap exclusion this site has, and it is a
// list of bare glob strings that names routes living in a different file.
// Nothing else in the suite reads it: tests/site-config.test.mjs asserts the
// navbar, the docs routeBasePath and the search plugin, and
// tests/docs-contract.test.mjs asserts frontmatter, but neither one connects
// a pattern to the docs it is supposed to cover. Both failure directions are
// silent in a green build:
//
//   - a doc is placed under a pattern without `unlisted: true`, so it is
//     withheld from crawlers yet still shipped in the sidebar and the local
//     search index;
//   - a pattern is widened, or left behind after the docs it covered moved
//     out of the tree (agent skills lived under docs/skills/ until they moved
//     to .agents/skills/), and it silently covers whatever lands there next.
//
// The pairing matters because the two mechanisms cover different surfaces.
// `unlisted: true` hides a doc from the sidebar, from local search and from
// the sitemap; `ignorePatterns` only ever removes it from the sitemap. A
// sitemap-excluded doc that is still listed in the sidebar and indexed by
// search contradicts the reason a pattern exists.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

// docusaurus.config.js is ESM but calls require.resolve() for its plugin
// list, which Docusaurus supplies through its own loader. Provide the same
// shim so the config can be imported and asserted on directly.
globalThis.require ??= createRequire(import.meta.url);

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const docsRoot = join(repoRoot, 'docs');

const config = (await import('../docusaurus.config.js')).default;
const sitemapOptions = config.presets?.[0]?.[1]?.sitemap ?? {};
const ignorePatterns = sitemapOptions.ignorePatterns ?? [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.md') || entry.endsWith('.mdx')) out.push(full);
  }
  return out;
}

function frontmatter(file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'));
  return match ? match[1] : '';
}

function frontmatterValue(file, key) {
  const match = new RegExp(`^${key}:\\s*(\\S+)\\s*$`, 'm').exec(
    frontmatter(file),
  );
  return match ? match[1].replace(/^['"]|['"]$/g, '') : undefined;
}

// Routes take the shape the plugin matches against: Docusaurus applies the
// site-wide trailingSlash setting to every route path before the sitemap
// plugin sees it, so with `trailingSlash: true` the search page is `/search/`
// and a bare `/search` pattern no longer covers it.
const trailingSlash = config.trailingSlash === true;

function normalizeRoute(route) {
  const withoutFragment = route.split('#')[0].split('?')[0];
  if (withoutFragment === '/' || withoutFragment === '') return '/';
  const bare = withoutFragment.replace(/\/+$/, '');
  return trailingSlash ? `${bare}/` : bare;
}

// Mirrors the Docusaurus docs-plugin route derivation for routeBasePath '/':
// an explicit frontmatter slug wins, otherwise the path relative to docs/ is
// used, with index files collapsing onto their containing directory.
function routeForDoc(file) {
  const slug = frontmatterValue(file, 'slug');
  if (slug?.startsWith('/')) return normalizeRoute(slug);
  const rel = relative(docsRoot, file).replace(/\\/g, '/');
  const collapsed = rel.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '');
  return normalizeRoute(`/${collapsed}`);
}

// The sitemap plugin matches ignorePatterns with minimatch. Only the two
// constructs this config uses are modelled: `**` spans path separators, `*`
// stops at one. Anything richer would be asserting minimatch's behaviour
// rather than this repository's, so patternProblem() rejects it outright and
// this helper is never reached with one.
function matchesPattern(pattern, route) {
  const source = pattern
    .split('**')
    .map((span) =>
      span
        .split('*')
        .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*');
  return new RegExp(`^${source}$`).test(normalizeRoute(route));
}

// Returns a human-readable fault for an unusable pattern, or null when the
// pattern is one this suite can reason about.
function patternProblem(pattern) {
  if (typeof pattern !== 'string') return 'is not a string';
  if (pattern === '') return 'is empty';
  if (!pattern.startsWith('/')) return 'is not rooted at "/"';
  if (/\s/.test(pattern)) return 'contains whitespace';
  if (pattern !== '/' && pattern.endsWith('/')) return 'has a trailing slash';
  if (/[?[\]{}!+@()|]/.test(pattern)) {
    return 'uses a glob construct beyond "*" and "**"';
  }
  return null;
}

const docFiles = walk(docsRoot);

function searchPlugin() {
  return (config.plugins ?? []).find((plugin) => {
    const [name] = Array.isArray(plugin) ? plugin : [plugin];
    return typeof name === 'string' && name.includes('search-local');
  });
}

test('the sitemap declares a non-empty ignorePatterns list', () => {
  assert.ok(
    Array.isArray(ignorePatterns) && ignorePatterns.length > 0,
    'sitemap.ignorePatterns is the only sitemap exclusion this site has; an empty or missing list publishes every route',
  );
});

test('patternProblem accepts the usable patterns and names the fault in the rest', () => {
  for (const usable of ['/search', '/skills/**', '/a/*/b', '/']) {
    assert.equal(patternProblem(usable), null, `${usable} should be usable`);
  }
  assert.equal(patternProblem(undefined), 'is not a string');
  assert.equal(patternProblem(''), 'is empty');
  assert.equal(patternProblem('skills/**'), 'is not rooted at "/"');
  assert.equal(patternProblem('/a b'), 'contains whitespace');
  assert.equal(patternProblem('/skills/'), 'has a trailing slash');
  assert.equal(
    patternProblem('/skills/{a,b}'),
    'uses a glob construct beyond "*" and "**"',
  );
});

test('matchesPattern spans separators for ** and sees routes with the trailing slash', () => {
  assert.ok(matchesPattern('/skills/**', '/skills/manifest'));
  assert.ok(matchesPattern('/skills/**', '/skills/nested/deep/doc'));
  assert.ok(!matchesPattern('/skills/**', '/skillset/manifest'));
  assert.ok(matchesPattern('/search/**', '/search'));
  assert.ok(matchesPattern('/search/**', '/search/'));
  assert.ok(!matchesPattern('/search/**', '/searching'));
  // The bare form is the pattern that let /search/ leak into the sitemap
  // once trailingSlash was set; the model must reject it like the plugin.
  assert.ok(!matchesPattern('/search', '/search'));
});

test('every sitemap ignorePattern is a rooted glob this suite can reason about', () => {
  for (const pattern of ignorePatterns) {
    const problem = patternProblem(pattern);
    assert.equal(
      problem,
      null,
      `sitemap ignorePattern ${JSON.stringify(pattern)} ${problem}`,
    );
  }
});

test('every doc the sitemap excludes is also unlisted', () => {
  for (const file of docFiles) {
    const route = routeForDoc(file);
    const pattern = ignorePatterns.find((candidate) =>
      matchesPattern(candidate, route),
    );
    if (!pattern) continue;
    assert.equal(
      frontmatterValue(file, 'unlisted'),
      'true',
      `${relative(repoRoot, file)} serves ${route}, which sitemap ignorePattern ${JSON.stringify(pattern)} withholds from crawlers, so it must also carry "unlisted: true" — without it the page still ships in the sidebar and the local search index, which is the opposite of the "not site content" rationale the pattern was added for`,
    );
  }
});

test('no sitemap ignorePattern is stale', () => {
  const routes = docFiles.map(routeForDoc);
  // /search is served by the local search plugin rather than by a file under
  // docs/, so its pattern is live exactly while that plugin is registered.
  for (const pattern of ignorePatterns) {
    const live = matchesPattern(pattern, '/search')
      ? Boolean(searchPlugin())
      : routes.some((route) => matchesPattern(pattern, route));
    assert.ok(
      live,
      `sitemap ignorePattern ${JSON.stringify(pattern)} matches no route this site serves; delete it rather than leaving a pattern that silently covers whatever is added there next`,
    );
  }
});
