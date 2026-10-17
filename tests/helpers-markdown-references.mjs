// Scanners for the repository things Markdown prose refers to by name: site
// routes, workflow and config files, npm scripts, just recipes and repository
// paths. tests/markdown-references.test.mjs asserts the clean tree;
// tests/markdown-references-helpers.test.mjs drives these over text that does
// offend.
//
// Everything here is a pure function of the text and a description of the
// repository, so the fixtures can prove each scanner fails on a reference
// that resolves to nothing.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Matches a code span. Backtick-quoted text is where prose names a file, a
// route or a command; a bare word in a sentence is not read as a reference.
const CODE_SPAN = /`([^`\n]+)`/g;
// Matches a Markdown link target.
const LINK_TARGET = /\]\(([^)\s]+)\)/g;

export function codeSpans(text) {
  return [...text.matchAll(CODE_SPAN)].map((match) => match[1]);
}

function linkTargets(text) {
  return [...text.matchAll(LINK_TARGET)].map((match) => match[1]);
}

// ---------------------------------------------------------------------------
// Site routes
// ---------------------------------------------------------------------------

export function normalizeRoute(route) {
  const bare = route.split('#')[0].split('?')[0];
  if (bare === '' || bare === '/') return '/';
  return bare.replace(/\/+$/, '');
}

function frontmatterSlug(source) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!block) return undefined;
  const slug = /^slug:\s*(\S+)\s*$/m.exec(block[1]);
  return slug ? slug[1].replace(/^['"]|['"]$/g, '') : undefined;
}

// Mirrors the Docusaurus docs-plugin derivation for routeBasePath '/': an
// explicit frontmatter slug wins, otherwise the path relative to docs/, with
// index files collapsing onto their directory.
export function routeForDoc(docsRoot, file) {
  const slug = frontmatterSlug(readFileSync(file, 'utf8'));
  if (slug?.startsWith('/')) return normalizeRoute(slug);
  const rel = relative(docsRoot, file).replace(/\\/g, '/');
  return normalizeRoute(
    `/${rel.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '')}`,
  );
}

export function walk(dir, { skip = () => false, keep = () => true } = {}) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (skip(entry.name, full)) continue;
    if (entry.isDirectory()) out.push(...walk(full, { skip, keep }));
    else if (keep(entry.name)) out.push(full);
  }
  return out;
}

// Docusaurus's default slug for a generated category index.
function categorySlug(label) {
  return `/category/${label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

// A `_category_.json` whose link is a generated index publishes a route of
// its own with no Markdown file behind it.
export function generatedIndexRoutes(docsRoot) {
  const routes = new Set();
  for (const file of walk(docsRoot, {
    keep: (name) => name === '_category_.json',
  })) {
    const category = JSON.parse(readFileSync(file, 'utf8'));
    if (category?.link?.type !== 'generated-index') continue;
    routes.add(
      normalizeRoute(
        category.link.slug ?? categorySlug(category.label ?? 'category'),
      ),
    );
  }
  return routes;
}

export function publishedDocRoutes(docsRoot) {
  const routes = generatedIndexRoutes(docsRoot);
  for (const file of walk(docsRoot, { keep: (name) => /\.mdx?$/.test(name) }))
    routes.add(routeForDoc(docsRoot, file));
  return routes;
}

// `/img/...` and `blog/YYYY-MM-DD-slug.md` describe a shape, not a thing.
export function isPlaceholder(token) {
  return /\.\.\.|YYYY|<[^>]+>/.test(token);
}

// A leading-slash token in prose is read as a site route unless its first
// segment is a directory at the repository root (`/data/`, `/src/`) or an
// operating-system path, or it names a file by extension (`/img/x.png`).
const OS_ROOTS = new Set([
  'bin',
  'dev',
  'etc',
  'home',
  'opt',
  'proc',
  'root',
  'tmp',
  'usr',
  'var',
]);

export function routeCitations(text, { repoDirs }) {
  const seen = new Set();
  const candidates = [...codeSpans(text), ...linkTargets(text)];
  for (const token of candidates) {
    if (!/^\/[A-Za-z0-9]/.test(token) || isPlaceholder(token)) continue;
    const route = normalizeRoute(token);
    const [first] = route.slice(1).split('/');
    if (repoDirs.has(first) || OS_ROOTS.has(first)) continue;
    if (/\.[A-Za-z0-9]+$/.test(route)) continue;
    if (/[*{<\s]/.test(route)) continue;
    seen.add(route);
  }
  return [...seen];
}

export function unresolvedRoutes(text, { repoDirs, routes, routePrefixes }) {
  return routeCitations(text, { repoDirs }).filter(
    (route) =>
      !routes.has(route) &&
      !routePrefixes.some(
        (prefix) => route === prefix || route.startsWith(`${prefix}/`),
      ),
  );
}

// ---------------------------------------------------------------------------
// Workflow and config files cited by bare name
// ---------------------------------------------------------------------------

const YAML_NAME = /^\.?[A-Za-z0-9][A-Za-z0-9_.-]*\.ya?ml$/;

export function yamlCitations(text) {
  const seen = new Set();
  for (const span of codeSpans(text)) {
    // Prose may write `.github/workflows/ci.yml` or just `ci.yml`; both name
    // the same file, and the path-qualified form is checked as a path below.
    const base = span.split('/').pop();
    if (!span.includes('/') && YAML_NAME.test(base)) seen.add(base);
  }
  return [...seen];
}

export function yamlBasenames(repoRoot, { skip }) {
  return new Set(
    walk(repoRoot, { skip, keep: (name) => /\.ya?ml$/.test(name) }).map(
      (file) => file.split('/').pop(),
    ),
  );
}

export function unresolvedYaml(text, { yamlFiles }) {
  return yamlCitations(text).filter((name) => !yamlFiles.has(name));
}

// ---------------------------------------------------------------------------
// npm scripts and just recipes
// ---------------------------------------------------------------------------

const NPM_RUN = /\bnpm run (?:-s |--silent )?([A-Za-z0-9_:.-]+)/g;
const JUST_RUN = /^just ([A-Za-z_][A-Za-z0-9_-]*)/;

export function npmScriptCitations(text) {
  return [...new Set([...text.matchAll(NPM_RUN)].map((match) => match[1]))];
}

export function unresolvedNpmScripts(text, { scripts }) {
  return npmScriptCitations(text).filter((name) => !(name in scripts));
}

// Only a code span that starts with `just` is a recipe invocation; the word
// in running prose is not.
export function justRecipeCitations(text) {
  const seen = new Set();
  for (const span of codeSpans(text)) {
    const match = JUST_RUN.exec(span);
    if (match) seen.add(match[1]);
  }
  return [...seen];
}

export function justRecipes(source) {
  const recipes = new Set();
  for (const line of source.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)(?:\s+[^:]*)?:(?!=)/.exec(line);
    if (match) recipes.add(match[1]);
  }
  return recipes;
}

export function unresolvedJustRecipes(text, { recipes }) {
  return justRecipeCitations(text).filter((name) => !recipes.has(name));
}

// ---------------------------------------------------------------------------
// Repository paths
// ---------------------------------------------------------------------------

// A code span is read as a repository path when it starts with a tracked
// top-level directory and names a file by extension or a directory by a
// trailing slash. Globs and placeholders are not paths.
export function pathCitations(text, { repoDirs }) {
  const seen = new Set();
  for (const span of codeSpans(text)) {
    const token = span.trim();
    if (/[*{}<>|\s]/.test(token) || isPlaceholder(token)) continue;
    const [first, ...rest] = token.split('/');
    if (rest.length === 0 || !repoDirs.has(first)) continue;
    const isDir = token.endsWith('/');
    const last = rest[rest.length - 1];
    if (!isDir && !/\.[A-Za-z0-9]+$/.test(last)) continue;
    seen.add(token);
  }
  return [...seen];
}

export function unresolvedPaths(text, { repoRoot, repoDirs }) {
  return pathCitations(text, { repoDirs }).filter((token) => {
    const full = join(repoRoot, token);
    if (!existsSync(full)) return true;
    return token.endsWith('/') ? !statSync(full).isDirectory() : false;
  });
}

// ---------------------------------------------------------------------------
// Putting it together
// ---------------------------------------------------------------------------

/**
 * Every reference in one Markdown source that resolves to nothing, tagged by
 * kind. `exempt` is the set of tokens the caller has recorded as deliberate
 * for this file: retired names cited as history, external files.
 */
export function unresolvedReferences(text, repo, exempt = new Set()) {
  const found = [
    ...unresolvedRoutes(text, repo).map((t) => ({ kind: 'route', token: t })),
    ...unresolvedYaml(text, repo).map((t) => ({ kind: 'yaml', token: t })),
    ...unresolvedNpmScripts(text, repo).map((t) => ({
      kind: 'npm script',
      token: t,
    })),
    ...unresolvedJustRecipes(text, repo).map((t) => ({
      kind: 'just recipe',
      token: t,
    })),
    ...unresolvedPaths(text, repo).map((t) => ({ kind: 'path', token: t })),
  ];
  return found.filter(({ token }) => !exempt.has(token));
}

/**
 * Exemption entries that no longer earn their place: the token is not
 * mentioned in the file any more, or it resolves again.
 */
export function staleExemptions(file, text, tokens, repo) {
  const live = new Set(
    unresolvedReferences(text, repo).map(({ token }) => token),
  );
  return [...tokens]
    .filter((token) => !live.has(token))
    .map((token) => `${file}: ${token}`);
}
