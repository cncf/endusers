// Every repository thing the Markdown prose names still exists.
//
// The site build link-checks the Markdown under docs/ and blog/, but does not
// reach the twenty-odd Markdown files at the repository root and under
// .github/ -- README, CONTRIBUTING, AGENTS, MAINTAINERS, the copilot
// instructions -- or read a route, a workflow name or an npm script written
// in backticks as anything but text.
//
// That is where stale references have lived. Restructures that renamed a
// route, a workflow or a recipe were each followed a day later by a fix for
// the prose that still used the old name, and every one was found by a reader
// rather than a check.
//
// This test reads the same prose as a reader would and asks the repository
// whether each name resolves:
//
//   `/community/awards`, [text](/resources/metrics)   a route the site publishes
//   <Link to="/events">, https://endusers.cncf.io/x   (docs, pages, blog,
//                                                     redirects)
//   `ci.yml`, `.cspell.yml`                           a YAML file in the tree
//   `npm run collect:metrics`, `validate:metrics`     a package.json script
//   `just build`, a fenced `just build` line          a Justfile recipe
//   "Refresh metrics" workflow, "Lint repository" check
//                                                     a workflow or job name
//   ADR 0001 is Accepted                              the record's own Status
//   `scripts/collect-metrics.mjs`, `data/`            a path on disk
//
// Decision records under adr/ are not scanned: an ADR describes the tree as
// it was when the decision was taken, and the files it names are supposed to
// stop existing as the decision is carried out. The index and the supporting
// drafts beside them are scanned; a draft is text still waiting to be sent.
// Architecture pages generated from submission issues are not scanned either;
// their prose is the submitter's. Everything else is, and a reference that
// resolves to nothing is recorded in HISTORICAL_REFERENCES with the reason it
// is kept, or fixed.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  adrStatuses,
  blogRoutes,
  justRecipes,
  normalizeRoute,
  pageRoutes,
  publishedDocRoutes,
  redirectSources,
  staleExemptions,
  unresolvedReferences,
  walk,
  workflowNames,
  yamlBasenames,
} from './helpers-markdown-references.mjs';

// docusaurus.config.js calls require.resolve() for its plugin list, which
// Docusaurus supplies through its own loader; give it the same shim. The
// config is loaded with E2E_COVERAGE=1 so it mounts every docs plugin it can
// -- the coverage lane's fixture docs are a route CONTRIBUTING.md names.
globalThis.require ??= createRequire(import.meta.url);
process.env.E2E_COVERAGE = '1';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const docsRoot = join(repoRoot, 'docs');
const config = (await import('../docusaurus.config.js')).default;

// Directories the walk never enters: dependencies, build output, the
// StrykerJS sandbox (a whole copy of the tree, so every file in it would be
// reported a second time), and the test tree, whose Markdown is fixture data
// rather than prose about the repo.
const UNSCANNED_DIRS = new Set([
  '.docusaurus',
  '.git',
  '.stryker-tmp',
  'build',
  'coverage',
  'node_modules',
  'tests',
]);
const skipDir = (name) => UNSCANNED_DIRS.has(name);

// Markdown that is scanned for references. Repository-root directories that
// are not walked for prose still count as path roots (`tests/e2e/...` is a
// path a reader can follow), so the two lists are kept apart.
function isScannedMarkdown(file) {
  const rel = relative(repoRoot, file).replace(/\\/g, '/');
  if (!/\.mdx?$/.test(rel)) return false;
  if (/^adr\/\d{4}-/.test(rel)) return false;
  if (
    rel.startsWith('docs/architectures/') &&
    !/\/(index|submit)\.md$/.test(rel)
  )
    return false;
  return true;
}

const repoDirs = new Set(
  readdirSync(repoRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        ![
          'node_modules',
          'build',
          '.docusaurus',
          '.git',
          '.stryker-tmp',
          'coverage',
        ].includes(entry.name),
    )
    .map((entry) => entry.name),
);

// Routes the build publishes that no file under docs/ produces: generated
// pages, and every docs-plugin instance mounted somewhere other than '/'.
// Each generated route is paired with the generator that renders it so this
// list cannot outlive the feature.
const GENERATED_ROUTES = new Map([
  ['/resources/changelog', 'scripts/generate-changelog.mjs'],
]);
const GENERATED_PATHS = new Map([
  ['docs/resources/changelog.md', 'scripts/generate-changelog.mjs'],
]);

// Every plugin option block, preset ones included, by plugin name.
function pluginOptions(name) {
  const found = [];
  for (const [id, options] of config.presets ?? []) {
    if (id === 'classic' && options?.[name.replace(/^plugin-content-/, '')])
      found.push(options[name.replace(/^plugin-content-/, '')]);
  }
  for (const plugin of config.plugins ?? []) {
    if (Array.isArray(plugin) && String(plugin[0]).includes(name))
      found.push(plugin[1]);
  }
  return found;
}

const [presetDocs, ...otherDocs] = pluginOptions('plugin-content-docs');
const [presetBlog] = pluginOptions('plugin-content-blog');
const redirects = redirectSources({
  netlifyToml: readFileSync(join(repoRoot, 'netlify.toml'), 'utf8'),
  clientRedirects: pluginOptions('plugin-client-redirects').flatMap(
    (options) => options?.redirects ?? [],
  ),
});

const repo = {
  repoRoot,
  repoDirs,
  routes: new Set([
    ...publishedDocRoutes(docsRoot, presetDocs.routeBasePath),
    ...pageRoutes(join(repoRoot, 'src/pages')),
    ...blogRoutes(join(repoRoot, 'blog'), presetBlog.routeBasePath),
    ...redirects.routes,
    ...GENERATED_ROUTES.keys(),
  ]),
  // A docs instance outside docs/ (the e2e coverage fixtures) is mounted
  // whole, as is a splat redirect.
  routePrefixes: [
    ...otherDocs.map((options) =>
      normalizeRoute(`/${options.routeBasePath.replace(/^\/+/, '')}`),
    ),
    ...redirects.prefixes,
  ],
  yamlFiles: yamlBasenames(repoRoot, { skip: skipDir }),
  scripts: JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    .scripts,
  recipes: justRecipes(readFileSync(join(repoRoot, 'Justfile'), 'utf8')),
  ...workflowNames(join(repoRoot, '.github/workflows')),
  adrStatuses: adrStatuses(join(repoRoot, 'adr')),
};

// References that resolve to nothing on purpose, per file. Each entry is
// re-checked below: it goes stale when the file stops mentioning the token or
// when the token resolves again, and either way the entry has to go.
const HISTORICAL_REFERENCES = new Map([
  [
    'AGENTS.md',
    new Map([
      [
        'hive.yaml',
        'Names the file the repository deliberately does not have, so a Hive ' +
          'agent looking for its config here is told where it actually lives.',
      ],
    ]),
  ],
  [
    '.agents/skills/ui-standards/SKILL.md',
    new Map([
      [
        '/websites/docusaurus_io_3_9_2',
        'A Context7 library identifier for the Docusaurus docs, written in ' +
          'the path shape that service uses; not a route on this site.',
      ],
    ]),
  ],
]);

const GLOBAL_EXEMPT = new Set([
  ...GENERATED_ROUTES.keys(),
  ...GENERATED_PATHS.keys(),
]);

const markdown = walk(repoRoot, {
  skip: skipDir,
  keep: (name) => /\.mdx?$/.test(name),
})
  .filter(isScannedMarkdown)
  .map((file) => ({
    rel: relative(repoRoot, file).replace(/\\/g, '/'),
    text: readFileSync(file, 'utf8'),
  }));

function exemptFor(rel) {
  return new Set([
    ...GLOBAL_EXEMPT,
    ...(HISTORICAL_REFERENCES.get(rel)?.keys() ?? []),
  ]);
}

test('the scan reaches the Markdown the build does not link-check', () => {
  const scanned = new Set(markdown.map(({ rel }) => rel));
  for (const expected of [
    'README.md',
    'CONTRIBUTING.md',
    'AGENTS.md',
    '.github/copilot-instructions.md',
    'docs/community/index.md',
  ]) {
    assert.ok(scanned.has(expected), `${expected} was not scanned`);
  }
  assert.ok(
    !scanned.has('adr/0005-host-the-site-on-netlify.md'),
    'decision records are history and are not scanned',
  );
  assert.ok(scanned.has('adr/README.md'), 'the ADR index was not scanned');
});

test('the repository description the scan resolves against is not empty', () => {
  assert.ok(repo.routes.has('/community/awards'), 'docs routes not derived');
  assert.ok(
    repo.routes.has('/community/user-groups'),
    'generated-index category routes not derived',
  );
  assert.ok(repo.yamlFiles.has('ci.yml'), 'workflow files not enumerated');
  assert.ok('collect:metrics' in repo.scripts, 'npm scripts not loaded');
  assert.ok(repo.recipes.has('build'), 'Justfile recipes not parsed');
  assert.ok(repo.routes.has('/blog/archive'), 'blog routes not derived');
  assert.ok(repo.workflows.has('Refresh metrics'), 'workflow names not read');
  assert.ok(repo.jobs.has('Lint repository'), 'job names not read');
  assert.ok(repo.adrStatuses.has('0001'), 'ADR statuses not read');
  assert.ok(repo.repoDirs.has('scripts'), 'repository directories not read');
});

test('every route, file, script and recipe the prose names resolves', () => {
  const unresolved = [];
  for (const { rel, text } of markdown) {
    for (const { kind, token } of unresolvedReferences(
      text,
      repo,
      exemptFor(rel),
    )) {
      unresolved.push(`${rel}: ${kind} \`${token}\``);
    }
  }
  assert.deepEqual(
    unresolved,
    [],
    'prose names something the repository no longer has. Update the ' +
      'reference, or if it is cited as history record it in ' +
      `HISTORICAL_REFERENCES with the reason:\n${unresolved.join('\n')}`,
  );
});

test('every historical reference is still cited, and still resolves to nothing', () => {
  const stale = [];
  for (const [rel, tokens] of HISTORICAL_REFERENCES) {
    const entry = markdown.find((file) => file.rel === rel);
    if (!entry) {
      stale.push(`${rel}: file is no longer scanned`);
      continue;
    }
    stale.push(...staleExemptions(rel, entry.text, tokens.keys(), repo));
  }
  assert.deepEqual(
    stale,
    [],
    `HISTORICAL_REFERENCES entries that no longer earn their place:\n${stale.join('\n')}`,
  );
});

test('every historical reference carries a reason', () => {
  for (const [rel, tokens] of HISTORICAL_REFERENCES) {
    for (const [token, reason] of tokens) {
      assert.ok(
        typeof reason === 'string' && reason.trim().length > 0,
        `${rel}: ${token} is exempted without saying why`,
      );
    }
  }
});

test('every generated route and path names a generator that still exists', () => {
  for (const [token, generator] of [...GENERATED_ROUTES, ...GENERATED_PATHS]) {
    const source = readFileSync(join(repoRoot, generator), 'utf8');
    const needle = token.startsWith('/') ? token : token.replace(/\.md$/, '');
    assert.ok(
      source.includes(needle),
      `${generator} no longer mentions ${token}; the generated exemption is stale`,
    );
  }
});
