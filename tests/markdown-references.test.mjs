// Every repository thing the Markdown prose names still exists.
//
// The site build link-checks the Markdown under docs/ and blog/, but does not
// reach the twenty-odd Markdown files at the repository root and under
// .github/ -- README, CONTRIBUTING, AGENTS, MAINTAINERS, the copilot
// instructions -- or read a route, a workflow name or an npm script written
// in backticks as anything but text.
//
// That is where the stale references of the last week lived. Five human
// restructures (#1524, #1527, #1528, #1531, #1552) each renamed a route, a
// workflow or a recipe, and each was followed a day later by a fix for the
// prose that still used the old name: #1529, #1530, #1537, #1538, #1562,
// #1568, #1569. Every one was found by a reader rather than a check.
//
// This test reads the same prose as a reader would and asks the repository
// whether each name resolves:
//
//   `/community/awards`, [text](/resources/metrics)   a route the docs publish
//   `ci.yml`, `.cspell.yml`                           a YAML file in the tree
//   `npm run collect:metrics`                         a package.json script
//   `just build`                                      a Justfile recipe
//   `scripts/collect-metrics.mjs`, `data/`            a path on disk
//
// Decision records under adr/ are not scanned: an ADR describes the tree as
// it was when the decision was taken, and the files it names are supposed to
// stop existing as the decision is carried out. Architecture pages generated
// from submission issues are not scanned either; their prose is the
// submitter's. Everything else is, and a reference that resolves to nothing
// is recorded in HISTORICAL_REFERENCES with the reason it is kept, or fixed.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  justRecipes,
  publishedDocRoutes,
  staleExemptions,
  unresolvedReferences,
  walk,
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

// Directories the walk never enters: dependencies, build output, and the
// test tree, whose Markdown is fixture data rather than prose about the repo.
const UNSCANNED_DIRS = new Set([
  '.docusaurus',
  '.git',
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
  if (rel.startsWith('adr/')) return false;
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
        !['node_modules', 'build', '.docusaurus', '.git', 'coverage'].includes(
          entry.name,
        ),
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

function docsPluginRoutePrefixes() {
  const prefixes = ['/blog'];
  for (const plugin of config.plugins ?? []) {
    if (!Array.isArray(plugin)) continue;
    const [id, options] = plugin;
    if (!String(id).includes('plugin-content-docs')) continue;
    if (typeof options?.routeBasePath === 'string')
      prefixes.push(`/${options.routeBasePath.replace(/^\/+|\/+$/g, '')}`);
  }
  return prefixes;
}

const repo = {
  repoRoot,
  repoDirs,
  routes: new Set([
    ...publishedDocRoutes(docsRoot),
    ...GENERATED_ROUTES.keys(),
  ]),
  routePrefixes: docsPluginRoutePrefixes(),
  yamlFiles: yamlBasenames(repoRoot, { skip: skipDir }),
  scripts: JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    .scripts,
  recipes: justRecipes(readFileSync(join(repoRoot, 'Justfile'), 'utf8')),
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
    'LAUNCH.md',
    new Map([
      [
        'deploy-gh-pages.yml',
        'The GitHub Pages deployment retired by the Netlify move (ADR 0005); ' +
          'the launch record cites it as what was replaced.',
      ],
      [
        'import-architectures.yml',
        'The cncf/architecture content sync retired in #1527; the launch ' +
          'record explains what the metrics refresh used to run inside.',
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
