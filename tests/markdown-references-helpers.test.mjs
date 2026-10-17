// Drives the scanners in tests/helpers-markdown-references.mjs over text that
// does offend. tests/markdown-references.test.mjs asserts the clean tree; a
// guard nobody has seen go red is indistinguishable from one that always
// passes, so each rule here is shown both catching and not catching.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  generatedIndexRoutes,
  isPlaceholder,
  justRecipeCitations,
  justRecipes,
  npmScriptCitations,
  pathCitations,
  publishedDocRoutes,
  routeCitations,
  walk,
  routeForDoc,
  staleExemptions,
  unresolvedReferences,
  yamlBasenames,
  yamlCitations,
} from './helpers-markdown-references.mjs';

const repoDirs = new Set(['docs', 'scripts', 'data', 'tests', '.github']);

function fixtureRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'endusers-md-refs-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

test('a route is read from a code span or a link target, and from nothing else', () => {
  const text =
    'See `/community/awards` and [metrics](/resources/metrics/#top). ' +
    'The data lives in `/data/` and apt caches in `/var/cache/apt`; ' +
    'the icon is `/img/logo.svg` and the pattern is `/img/...`. ' +
    'Bare /events in a sentence is not a reference.';
  assert.deepEqual(routeCitations(text, { repoDirs: new Set(['data']) }), [
    '/community/awards',
    '/resources/metrics',
  ]);
});

test('a route resolves against the published set or a mounted prefix', () => {
  const repo = {
    repoDirs,
    routes: new Set(['/', '/community/awards']),
    routePrefixes: ['/blog'],
    yamlFiles: new Set(),
    scripts: {},
    recipes: new Set(),
    repoRoot: '/nonexistent',
  };
  const found = unresolvedReferences(
    'Links: `/community/awards`, `/blog/tags/community`, `/blog`, `/awards`, `/`.',
    repo,
  );
  // `/awards` is the exact shape #1568 fixed: a route removed by #1552 that
  // three root-level docs went on citing.
  assert.deepEqual(found, [{ kind: 'route', token: '/awards' }]);
});

test('docs routes mirror the Docusaurus derivation, including generated indexes', () => {
  const root = fixtureRepo({
    'docs/index.md': '---\nslug: /\n---\n# Home\n',
    'docs/events/index.md': '# Events\n',
    'docs/community/members.md': "---\nslug: '/community/members'\n---\n",
    'docs/community/user-groups/_category_.json': JSON.stringify({
      label: 'User Groups',
      link: { type: 'generated-index', slug: '/community/user-groups' },
    }),
    'docs/resources/_category_.json': JSON.stringify({
      label: 'Radar & Reports',
      link: { type: 'generated-index' },
    }),
    'docs/plain/_category_.json': JSON.stringify({ label: 'Plain' }),
    'docs/unlabeled/_category_.json': JSON.stringify({
      link: { type: 'generated-index' },
    }),
    'docs/resources/radar-reports.mdx': '# Radar\n',
  });
  try {
    const docsRoot = join(root, 'docs');
    assert.equal(routeForDoc(docsRoot, join(docsRoot, 'index.md')), '/');
    assert.equal(
      routeForDoc(docsRoot, join(docsRoot, 'events/index.md')),
      '/events',
    );
    assert.deepEqual([...generatedIndexRoutes(docsRoot)].sort(), [
      '/category/category',
      '/category/radar-reports',
      '/community/user-groups',
    ]);
    assert.equal(walk(docsRoot).length, 8);
    assert.deepEqual([...publishedDocRoutes(docsRoot)].sort(), [
      '/',
      '/category/category',
      '/category/radar-reports',
      '/community/members',
      '/community/user-groups',
      '/events',
      '/resources/radar-reports',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a YAML file is cited by bare name; a path-qualified one is a path', () => {
  assert.deepEqual(
    yamlCitations(
      'Edit `ci.yml` or `.cspell.yml`; `.github/workflows/ci.yml` is the path, ' +
        'and `refresh-metrics.yml` runs it. Not `ci.yml.bak` or `yml`.',
    ),
    ['ci.yml', '.cspell.yml', 'refresh-metrics.yml'],
  );
  const root = fixtureRepo({
    '.github/workflows/ci.yml': 'on: push\n',
    '.cspell.yml': 'words: []\n',
    'node_modules/dep/action.yaml': '',
  });
  try {
    const names = yamlBasenames(root, {
      skip: (name) => name === 'node_modules',
    });
    assert.deepEqual([...names].sort(), ['.cspell.yml', 'ci.yml']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('npm scripts and just recipes are read from their invocations only', () => {
  assert.deepEqual(
    npmScriptCitations(
      'Run `npm run collect:metrics`, `npm run -s _list:check:md`, then ' +
        '`npm run test:unit -- --watch`. `npm ci` is not a script.',
    ),
    ['collect:metrics', '_list:check:md', 'test:unit'],
  );
  assert.deepEqual(
    justRecipeCitations(
      'Use `just build` or `just refresh`; we just serve it. `just` alone ' +
        'lists recipes and `npx just build` is not read.',
    ),
    ['build', 'refresh'],
  );
  assert.deepEqual(
    [
      ...justRecipes(
        [
          'set shell := ["bash", "-cu"]',
          'node := "22"',
          '',
          '# Build the site',
          'build:',
          '    npm run build',
          '',
          'serve port="3000": build',
          '    npx serve -l {{port}} build',
          '  indented: not-a-recipe',
          '_private:',
        ].join('\n'),
      ),
    ].sort(),
    ['_private', 'build', 'serve'],
  );
});

test('a repository path is a code span rooted in a tracked directory', () => {
  const text =
    'Edit `scripts/collect-metrics.mjs` and `data/`; `tests/e2e/*.spec.js` ' +
    'is a glob, `docs/<section>/index.md` a placeholder, `scripts/lib` has no ' +
    'extension, `blog/YYYY-MM-DD-slug.md` is a shape, and `src/x.js` is not ' +
    'under a directory this fixture tracks.';
  assert.deepEqual(pathCitations(text, { repoDirs }), [
    'scripts/collect-metrics.mjs',
    'data/',
  ]);
});

test('a path resolves when it exists, and a directory only as a directory', () => {
  const root = fixtureRepo({
    'scripts/present.mjs': '',
    'data/file.json': '{}',
  });
  try {
    const repo = {
      repoRoot: root,
      repoDirs,
      routes: new Set(),
      routePrefixes: [],
      yamlFiles: new Set(),
      scripts: {},
      recipes: new Set(),
    };
    assert.deepEqual(
      unresolvedReferences(
        '`scripts/present.mjs` `scripts/absent.mjs` `data/` `data/file.json/`',
        repo,
      ),
      [
        { kind: 'path', token: 'scripts/absent.mjs' },
        { kind: 'path', token: 'data/file.json/' },
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every kind is reported with its name, and an exempt token is not', () => {
  const repo = {
    repoRoot: '/nonexistent',
    repoDirs,
    routes: new Set(['/']),
    routePrefixes: [],
    yamlFiles: new Set(['ci.yml']),
    scripts: { build: 'docusaurus build' },
    recipes: new Set(['build']),
  };
  const text =
    '`/gone` `gone.yml` `npm run gone` `just gone` `scripts/gone.mjs` ' +
    '`/` `ci.yml` `npm run build` `just build`';
  assert.deepEqual(unresolvedReferences(text, repo), [
    { kind: 'route', token: '/gone' },
    { kind: 'yaml', token: 'gone.yml' },
    { kind: 'npm script', token: 'gone' },
    { kind: 'just recipe', token: 'gone' },
    { kind: 'path', token: 'scripts/gone.mjs' },
  ]);
  assert.deepEqual(
    unresolvedReferences(text, repo, new Set(['/gone', 'gone.yml', 'gone'])),
    [{ kind: 'path', token: 'scripts/gone.mjs' }],
  );
});

test('an exemption goes stale when the token resolves or is no longer cited', () => {
  const repo = {
    repoRoot: '/nonexistent',
    repoDirs,
    routes: new Set(),
    routePrefixes: [],
    yamlFiles: new Set(['back.yml']),
    scripts: {},
    recipes: new Set(),
  };
  const text = 'Retired: `old.yml`. Restored: `back.yml`.';
  assert.deepEqual(
    staleExemptions('F.md', text, ['old.yml', 'back.yml', 'never.yml'], repo),
    ['F.md: back.yml', 'F.md: never.yml'],
  );
});

test('placeholders describe a shape, not a thing', () => {
  assert.ok(isPlaceholder('/img/...'));
  assert.ok(isPlaceholder('blog/YYYY-MM-DD-slug.md'));
  assert.ok(isPlaceholder('docs/<section>/index.md'));
  assert.ok(!isPlaceholder('docs/community/index.md'));
});
