// Contract for the pages that keep legacy inbound URLs alive.
//
// Five docs exist for no reason other than backwards compatibility: they are
// `unlisted: true`, their body is a single sentence pointing at the page that
// replaced them, and they are reachable only by their `slug`. Nothing else in
// the repository links to them, so every other docs contract walks straight
// past. docusaurus.config.js registers no client-redirects plugin either —
// these documents *are* the compatibility layer, and deleting one, renaming
// its slug or flipping `unlisted` to `draft` 404s every inbound link from
// cncf.io, the End User mailing list and CNCF Slack with nothing going red.
//
// tests/docs-contract.test.mjs asserts that relative doc-to-doc links resolve
// and that frontmatter parses, but it never asserts that a particular slug
// still exists, so it cannot see a stub that was removed.
//
// The onward destinations are written as absolute routes (`/community/members`
// rather than `./members.md`), which Docusaurus resolves at build time via
// `onBrokenLinks: 'throw'` and docs-contract.test.mjs deliberately skips.
// This file resolves them against the `slug` frontmatter of the docs tree, so
// a stub pointing at a route no longer served fails here.
//
// tests/e2e/legacy-urls.spec.js covers the other half: that the built site
// actually serves each of these routes and that following the onward link
// lands on a page that renders.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

import { resolveRepoRoot } from './helpers.mjs';

const repoRoot = resolveRepoRoot(import.meta.url);
const docsRoot = join(repoRoot, 'docs');

// The legacy routes that must keep resolving, and where each one forwards to.
// Spelled out rather than derived from the docs tree on purpose: a derived
// list shrinks silently when a stub is deleted, which is the exact regression
// this table exists to catch. `derived stubs are all listed here` below closes
// the other direction, so a stub added later is bound without editing this
// table's intent.
const LEGACY_STUBS = [
  {
    file: 'docs/members/index.md',
    slug: '/members',
    target: '/community/members',
  },
  {
    file: 'docs/awards/index.md',
    slug: '/awards',
    target: '/community/awards',
  },
  {
    file: 'docs/community/end-user-community.md',
    slug: '/community/end-user-community',
    target: '/community',
  },
  {
    file: 'docs/community/telecom-user-group.md',
    slug: '/community/telecom-user-group',
    target: '/community/user-groups/telecom',
  },
  {
    file: 'docs/community/public-sector-user-group.md',
    slug: '/community/public-sector-user-group',
    target: '/community/user-groups/public-sector',
  },
];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const docs = walk(docsRoot)
  .filter((file) => /\.mdx?$/.test(file))
  .sort();

function readDoc(file) {
  const raw = readFileSync(file, 'utf8');
  const fence = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return {
    frontmatter: fence ? fence[1] : null,
    body: fence ? raw.slice(fence[0].length) : raw,
  };
}

function frontmatterValue(frontmatter, key) {
  if (frontmatter === null) return null;
  const match = frontmatter.match(
    new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm'),
  );
  if (!match) return null;
  return match[1].replace(/^['"]|['"]$/g, '');
}

// Every route the docs plugin serves, as a set of normalised paths. A doc
// with an explicit `slug` is served there; otherwise Docusaurus derives the
// route from the file path, with `index` collapsing to its directory.
function servedRoutes() {
  const routes = new Set();
  for (const file of docs) {
    const { frontmatter } = readDoc(file);
    const slug = frontmatterValue(frontmatter, 'slug');
    if (slug) {
      routes.add(normalise(slug));
      continue;
    }
    const derived = relative(docsRoot, file)
      .replace(/\.mdx?$/, '')
      .replace(/(^|\/)index$/, '');
    routes.add(normalise(`/${derived}`));
  }
  return routes;
}

function normalise(route) {
  const trimmed = route.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

// Absolute in-site markdown links, i.e. the form the stubs are written in.
function absoluteLinks(body) {
  return [...body.matchAll(/\[(?:[^\]]*)\]\((\/[^)\s]*)\)/g)].map(
    ([, href]) => href,
  );
}

const routes = servedRoutes();

test('the docs tree resolves to routes to check against', () => {
  assert.ok(
    routes.size >= LEGACY_STUBS.length,
    `expected docs/ to serve at least ${LEGACY_STUBS.length} routes, got ${routes.size}`,
  );
});

for (const stub of LEGACY_STUBS) {
  test(`${stub.slug} is still served by ${stub.file}`, () => {
    const doc = docs.find((file) => file === join(repoRoot, stub.file));
    assert.ok(
      doc,
      `${stub.file} is gone, so ${stub.slug} now 404s for every inbound link that still points at it`,
    );

    const { frontmatter } = readDoc(doc);
    assert.equal(
      frontmatterValue(frontmatter, 'slug'),
      stub.slug,
      `${stub.file} no longer declares slug: ${stub.slug}`,
    );
  });

  test(`${stub.slug} stays out of the sidebar and search index`, () => {
    const doc = join(repoRoot, stub.file);
    const { frontmatter } = readDoc(doc);
    // `unlisted` keeps the stub reachable by URL while hiding it from the
    // sidebar, search and sitemap. `draft` would remove it from the
    // production build entirely and silently break the route.
    assert.equal(
      frontmatterValue(frontmatter, 'unlisted'),
      'true',
      `${stub.file} must stay 'unlisted: true' — a stub that is listed clutters the sidebar, and one marked 'draft' is dropped from the production build`,
    );
    assert.equal(
      frontmatterValue(frontmatter, 'draft'),
      null,
      `${stub.file} declares 'draft', which omits it from the production build and 404s ${stub.slug}`,
    );
  });

  test(`${stub.slug} forwards to ${stub.target}`, () => {
    const doc = join(repoRoot, stub.file);
    const { body } = readDoc(doc);
    const links = absoluteLinks(body).map(normalise);

    assert.ok(
      links.includes(normalise(stub.target)),
      `${stub.file} should link onward to ${stub.target}; found ${
        links.length ? links.join(', ') : 'no absolute in-site links'
      }`,
    );
  });

  test(`${stub.target} is a route the docs plugin serves`, () => {
    assert.ok(
      routes.has(normalise(stub.target)),
      `${stub.file} forwards to ${stub.target}, which no doc serves — the stub is a dead end`,
    );
  });
}

test('every absolute link in a stub points at a served route', () => {
  const dangling = [];
  for (const stub of LEGACY_STUBS) {
    const { body } = readDoc(join(repoRoot, stub.file));
    for (const href of absoluteLinks(body)) {
      const [path] = href.split('#');
      if (!routes.has(normalise(path))) {
        dangling.push(`${stub.file} -> ${href}`);
      }
    }
  }
  assert.deepEqual(dangling, []);
});

test('derived stubs are all listed here', () => {
  // Any unlisted doc whose title says it moved is a legacy stub and belongs
  // in LEGACY_STUBS, so a redirect added later is covered on arrival rather
  // than waiting for someone to remember this file.
  const tracked = new Set(LEGACY_STUBS.map((stub) => stub.file));
  const untracked = [];
  for (const file of docs) {
    const { frontmatter } = readDoc(file);
    const title = frontmatterValue(frontmatter, 'title') ?? '';
    const isStub =
      frontmatterValue(frontmatter, 'unlisted') === 'true' &&
      /\bmoved\b/i.test(title);
    const rel = relative(repoRoot, file).split(sep).join('/');
    if (isStub && !tracked.has(rel)) untracked.push(rel);
  }
  assert.deepEqual(
    untracked,
    [],
    `these look like legacy-URL stubs but are not in LEGACY_STUBS: ${untracked.join(', ')}`,
  );
});
