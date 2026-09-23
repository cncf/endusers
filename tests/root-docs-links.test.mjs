import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');

// Root-level *.md are the contributor-facing entry points. They are not part
// of the Docusaurus route tree, so `onBrokenMarkdownLinks` never reads them,
// and `npm run check:links` delegates to a Makefile that does not exist.
// Nothing else verifies that their relative links still resolve.
const ROOT_DOCS = readdirSync(repoRoot)
  .filter((name) => name.endsWith('.md'))
  .sort();

// Matches inline links and images: [text](target) and ![alt](target).
const LINK_RE = /!?\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

function readDoc(name) {
  return readFileSync(join(repoRoot, name), 'utf8');
}

// Strips fenced and inline code so link-like text inside examples is ignored.
function stripCode(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/(^|[^`])`[^`\n]*`/g, '$1');
}

function links(name) {
  const found = [];
  for (const match of stripCode(readDoc(name)).matchAll(LINK_RE)) {
    const [target] = match.slice(1);
    const hashIndex = target.indexOf('#');
    const path = hashIndex === -1 ? target : target.slice(0, hashIndex);
    const fragment = hashIndex === -1 ? '' : target.slice(hashIndex + 1);
    found.push({ doc: name, target, path, fragment });
  }
  return found;
}

function isExternal(path) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path);
}

// `../../security/advisories/new` in SECURITY.md is GitHub's repo-relative
// idiom: the browser resolves it against the repository URL, not the file
// tree, so it deliberately escapes the repo root and cannot be checked on
// disk. Exempt it explicitly rather than letting it slip through a filesystem
// check that happens not to fail.
function escapesRepoRoot(path) {
  return relative(repoRoot, resolve(repoRoot, path)).startsWith('..');
}

function headingSlugs(filePath) {
  const slugs = new Set();
  for (const line of stripCode(readFileSync(filePath, 'utf8')).split('\n')) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const slug = heading[1]
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^\w\- ]/g, '')
      .replace(/ /g, '-');
    if (slug) slugs.add(slug);
  }
  return slugs;
}

const ALL_LINKS = ROOT_DOCS.flatMap(links);

test('the repository has root-level markdown files to check', () => {
  assert.ok(
    ROOT_DOCS.length >= 5,
    `expected several root-level *.md files, found ${ROOT_DOCS.length}`,
  );
  for (const required of ['README.md', 'CONTRIBUTING.md']) {
    assert.ok(ROOT_DOCS.includes(required), `${required} is missing`);
  }
});

test('root-level markdown files contain relative links to check', () => {
  const relativeLinks = ALL_LINKS.filter(
    (link) => link.path && !isExternal(link.path),
  );
  assert.ok(
    relativeLinks.length > 0,
    'found no relative links in root-level *.md; the resolution assertions below would pass vacuously',
  );
});

test('every relative link in root-level markdown resolves on disk', () => {
  const broken = [];
  for (const link of ALL_LINKS) {
    if (!link.path || isExternal(link.path)) continue;
    if (escapesRepoRoot(link.path)) continue;
    if (!existsSync(resolve(repoRoot, link.path))) {
      broken.push(`${link.doc} -> ${link.target}`);
    }
  }
  assert.deepEqual(
    broken,
    [],
    `unresolvable relative links:\n${broken.join('\n')}`,
  );
});

test('every #fragment on a cross-file markdown link matches a heading', () => {
  const broken = [];
  for (const link of ALL_LINKS) {
    if (!link.fragment || !link.path || isExternal(link.path)) continue;
    if (escapesRepoRoot(link.path)) continue;
    const target = resolve(repoRoot, link.path);
    if (!existsSync(target) || !statSync(target).isFile()) continue;
    if (!/\.mdx?$/.test(link.path)) continue;
    if (!headingSlugs(target).has(link.fragment.toLowerCase())) {
      broken.push(`${link.doc} -> ${link.target}`);
    }
  }
  assert.deepEqual(
    broken,
    [],
    `fragments with no matching heading:\n${broken.join('\n')}`,
  );
});

test('every same-document #fragment link matches a heading in that document', () => {
  const broken = [];
  for (const doc of ROOT_DOCS) {
    const slugs = headingSlugs(join(repoRoot, doc));
    for (const link of links(doc)) {
      if (link.path || !link.fragment) continue;
      if (!slugs.has(link.fragment.toLowerCase())) {
        broken.push(`${doc} -> #${link.fragment}`);
      }
    }
  }
  assert.deepEqual(
    broken,
    [],
    `in-document anchors with no matching heading:\n${broken.join('\n')}`,
  );
});

test('root-level markdown does not link into build output or node_modules', () => {
  const offenders = ALL_LINKS.filter(
    (link) =>
      link.path &&
      !isExternal(link.path) &&
      /(^|\/)(node_modules|build|\.docusaurus)(\/|$)/.test(link.path),
  ).map((link) => `${link.doc} -> ${link.target}`);
  assert.deepEqual(
    offenders,
    [],
    `links into generated directories:\n${offenders.join('\n')}`,
  );
});

test('links that escape the repository root are only the GitHub repo-relative idiom', () => {
  const escaping = ALL_LINKS.filter(
    (link) => link.path && !isExternal(link.path) && escapesRepoRoot(link.path),
  );
  for (const link of escaping) {
    assert.match(
      link.path,
      /^(?:\.\.\/)+(?:security|issues|pulls|discussions|wiki|blob|tree|releases)(?:\/|$)/,
      `${link.doc} -> ${link.target} escapes the repository root but is not a recognised GitHub repo-relative path; it resolves nowhere on disk and nowhere on github.com`,
    );
  }
});
