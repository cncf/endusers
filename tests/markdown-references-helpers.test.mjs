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
  adrStatuses,
  blogRoutes,
  generatedIndexRoutes,
  isPlaceholder,
  justRecipeCitations,
  justRecipes,
  npmScriptCitations,
  pageRoutes,
  pathCitations,
  publishedDocRoutes,
  redirectSources,
  routeCitations,
  walk,
  routeForDoc,
  staleExemptions,
  unresolvedReferences,
  workflowNames,
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

test('a route is read from a code span, a link target, a JSX link or a site URL, and nothing else', () => {
  const text =
    'See `/community/awards` and [metrics](/resources/metrics/#top). ' +
    'The data lives in `/data/` and apt caches in `/var/cache/apt`; ' +
    'the icon is `/img/logo.svg`, the pattern `/img/...`, the glob ' +
    '`/community/*`. ' +
    'Bare /events in a sentence is not a reference. <Link to="/events/"> ' +
    'and https://endusers.cncf.io/data/ are routes whatever the repo holds, ' +
    'as is <https://endusers.netlify.app>.';
  assert.deepEqual(routeCitations(text, { repoDirs: new Set(['data']) }), [
    '/community/awards',
    '/resources/metrics',
    '/events',
    '/data',
    '/',
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
  // `/awards` is the exact shape once seen: a removed route that three
  // root-level docs went on citing.
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
    'docs/resources/renamed.md': '---\nid: by-id\n---\n',
    'docs/resources/relative.md': '---\nslug: rel\n---\n',
    'docs/resources/empty.md': '---\n\n---\n',
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
    assert.equal(walk(docsRoot).length, 11);
    assert.deepEqual([...publishedDocRoutes(docsRoot)].sort(), [
      '/',
      '/category/category',
      '/category/radar-reports',
      '/community/members',
      '/community/user-groups',
      '/events',
      '/resources/by-id',
      '/resources/empty',
      '/resources/radar-reports',
      '/resources/rel',
    ]);
    assert.equal(
      routeForDoc(docsRoot, join(docsRoot, 'events/index.md'), '/docs/'),
      '/docs/events',
    );
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
        '`npm run test:unit -- --watch`. `npm ci` is not a script; ' +
        '`validate:awards` is, and `og:url` and `localhost:3000` are not.',
      { 'validate:metrics': '', build: '' },
    ),
    ['collect:metrics', '_list:check:md', 'test:unit', 'validate:awards'],
  );
  assert.deepEqual(
    justRecipeCitations(
      'Use `just build` or `just refresh`; we just serve it. `just` alone ' +
        'lists recipes and `npx just build` is not read. The `lint`\n' +
        'recipe is.\n\n```bash\njust serve\n  just e2e port=1\nnpx just no\n```\n',
    ),
    ['build', 'refresh', 'serve', 'e2e', 'lint'],
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
          '@quiet:',
        ].join('\n'),
      ),
    ].sort(),
    ['_private', 'build', 'quiet', 'serve'],
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
    scripts: { build: 'docusaurus build', 'validate:x': '' },
    recipes: new Set(['build']),
    workflows: new Set(['Refresh metrics']),
    jobs: new Set(['Lint repository']),
    adrStatuses: new Map([['0001', 'Accepted']]),
  };
  // Each drift below is a shape a reader once had to report by hand: a
  // retired workflow named across a line break, a job named as a workflow,
  // a script said not to exist after it was added, an ADR status restated
  // wrongly.
  const text =
    '`/gone` `gone.yml` `npm run gone` `just gone` `scripts/gone.mjs` ' +
    '"Import\nreference architectures" workflow, "Lint repository" workflow, ' +
    'there is no `validate:x` script, ADR 0001 is Proposed. ' +
    '`/` `ci.yml` `npm run build` `just build` "Refresh metrics" workflow, ' +
    '"Lint repository" CI check, `Refresh metrics` job, `refresh.yml` ' +
    'workflow, no `validate:y` script, ADR 0001 is Accepted.';
  assert.deepEqual(unresolvedReferences(text, repo), [
    { kind: 'route', token: '/gone' },
    { kind: 'yaml', token: 'gone.yml' },
    { kind: 'yaml', token: 'refresh.yml' },
    { kind: 'npm script', token: 'gone' },
    { kind: 'npm script', token: 'no validate:x script' },
    { kind: 'just recipe', token: 'gone' },
    { kind: 'workflow name', token: 'Import reference architectures' },
    { kind: 'workflow name', token: 'Lint repository' },
    { kind: 'ADR status', token: 'ADR 0001 Proposed' },
    { kind: 'path', token: 'scripts/gone.mjs' },
  ]);
  assert.deepEqual(
    unresolvedReferences(text, repo, new Set(['/gone', 'gone.yml', 'gone']))
      .length,
    6,
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

test('pages, blog posts, tags, authors and redirects publish routes', () => {
  const root = fixtureRepo({
    'src/pages/index.js': '',
    'src/pages/about.mdx': '',
    'src/pages/team/index.tsx': '',
    'src/pages/_hidden.js': '',
    'src/pages/styles.module.css': '',
    'blog/2026-07-22-welcome.md': '---\ntags: [news, 3]\n---\n',
    'blog/2026-08-08-dated/index.md': '---\nslug: /custom\n---\n',
    'blog/undated.md': '# Post\n',
    'blog/tags.yml':
      'news:\n  label: News\nmetrics:\n  permalink: /numbers\nbare:\n',
    'blog/authors.yml': 'a:\n  page: true\nb:\n  name: B\nc:\n',
    'empty/tags.yml': '',
    '.github/workflows/ci.yml':
      'name: Validate repository\njobs:\n  lint:\n    name: Lint repository\n  e2e: {}\n',
    '.github/workflows/empty.yml': '',
    'adr/0001-a.md': '- **Status**: Accepted\n',
    'adr/0002-b.md': '# No status\n',
    'adr/README.md': '- **Status**: Proposed\n',
  });
  try {
    assert.deepEqual([...pageRoutes(join(root, 'src/pages'))].sort(), [
      '/',
      '/about',
      '/team',
    ]);
    assert.equal(pageRoutes(join(root, 'absent')).size, 0);
    assert.deepEqual([...blogRoutes(join(root, 'blog'))].sort(), [
      '/blog',
      '/blog/2026/07/22/welcome',
      '/blog/archive',
      '/blog/authors',
      '/blog/authors/a',
      '/blog/custom',
      '/blog/tags',
      '/blog/tags/bare',
      '/blog/tags/news',
      '/blog/tags/numbers',
      '/blog/undated',
    ]);
    assert.deepEqual([...blogRoutes(join(root, 'empty'), '/news/')].sort(), [
      '/news',
      '/news/archive',
      '/news/tags',
    ]);
    const { workflows, jobs } = workflowNames(join(root, '.github/workflows'));
    assert.deepEqual([...workflows], ['Validate repository']);
    assert.deepEqual([...jobs], ['Lint repository', 'e2e']);
    assert.deepEqual(
      [...adrStatuses(join(root, 'adr'))],
      [['0001', 'Accepted']],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const redirects = redirectSources({
    netlifyToml:
      '[[redirects]]\n  from = "/old/"\n  to = "/new"\n' +
      "[[redirects]]\n  from = '/legacy/*'\n",
    clientRedirects: [{ from: '/a' }, { from: ['/b', '/c/'] }],
  });
  assert.deepEqual([...redirects.routes], ['/old', '/a', '/b', '/c']);
  assert.deepEqual(redirects.prefixes, ['/legacy']);
  assert.deepEqual(redirectSources({}).prefixes, []);
});
