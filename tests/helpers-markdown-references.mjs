// Scanners for the repository things Markdown prose refers to by name: site
// routes, workflow and config files, npm scripts, just recipes, workflow and
// job display names, ADR statuses and repository paths.
// tests/markdown-references.test.mjs asserts the clean tree;
// tests/markdown-references-helpers.test.mjs drives these over text that does
// offend.
//
// Everything here is a pure function of the text and a description of the
// repository, so the fixtures can prove each scanner fails on a reference
// that resolves to nothing.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { parse as parseYaml } from 'yaml';

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

function frontmatter(source) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  return block ? (parseYaml(block[1]) ?? {}) : {};
}

// Mirrors the Docusaurus docs-plugin derivation: an absolute frontmatter slug
// wins, a relative one replaces the file name, an `id` replaces the file name
// when there is no slug, and index files collapse onto their directory. The
// result is mounted under the plugin's routeBasePath.
export function routeForDoc(docsRoot, file, routeBasePath = '/') {
  const { slug, id } = frontmatter(readFileSync(file, 'utf8'));
  const rel = relative(docsRoot, file).replace(/\\/g, '/');
  const dir = dirname(rel) === '.' ? '' : `/${dirname(rel)}`;
  const name = rel
    .split('/')
    .pop()
    .replace(/\.mdx?$/, '');
  let path;
  if (typeof slug === 'string' && slug.startsWith('/')) path = slug;
  else if (typeof slug === 'string') path = `${dir}/${slug}`;
  else if (id !== undefined) path = `${dir}/${id}`;
  else path = `${dir}/${name === 'index' ? '' : name}`;
  const base = routeBasePath.replace(/^\/+|\/+$/g, '');
  return normalizeRoute(base ? `/${base}${path}` : path);
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

export function publishedDocRoutes(docsRoot, routeBasePath = '/') {
  const routes = generatedIndexRoutes(docsRoot);
  for (const file of walk(docsRoot, { keep: (name) => /\.mdx?$/.test(name) }))
    routes.add(routeForDoc(docsRoot, file, routeBasePath));
  return routes;
}

// src/pages: every page module or Markdown file publishes its path, minus the
// `_`-prefixed files and directories Docusaurus ignores.
export function pageRoutes(pagesRoot) {
  if (!existsSync(pagesRoot)) return new Set();
  return new Set(
    walk(pagesRoot, {
      skip: (name) => name.startsWith('_'),
      keep: (name) => /\.(jsx?|tsx?|mdx?)$/.test(name),
    }).map((file) =>
      normalizeRoute(
        `/${relative(pagesRoot, file)
          .replace(/\\/g, '/')
          .replace(/\.[^.]+$/, '')
          .replace(/(^|\/)index$/, '')}`,
      ),
    ),
  );
}

function yamlKeys(file) {
  return existsSync(file)
    ? Object.entries(parseYaml(readFileSync(file, 'utf8')) ?? {})
    : [];
}

// The blog plugin's routes: the list, the archive, every post (by its slug,
// or the date-derived path of its file name), every tag and every author that
// has a page.
export function blogRoutes(blogRoot, routeBasePath = 'blog') {
  const base = `/${routeBasePath.replace(/^\/+|\/+$/g, '')}`;
  const routes = new Set([base, `${base}/archive`, `${base}/tags`]);
  for (const [key, tag] of yamlKeys(join(blogRoot, 'tags.yml')))
    routes.add(`${base}/tags/${tag?.permalink?.replace(/^\//, '') ?? key}`);
  const authors = yamlKeys(join(blogRoot, 'authors.yml')).filter(
    ([, author]) => author?.page,
  );
  if (authors.length > 0) routes.add(`${base}/authors`);
  for (const [key] of authors) routes.add(`${base}/authors/${key}`);
  for (const file of walk(blogRoot, { keep: (name) => /\.mdx?$/.test(name) })) {
    const { slug, tags = [] } = frontmatter(readFileSync(file, 'utf8'));
    for (const tag of tags)
      if (typeof tag === 'string') routes.add(`${base}/tags/${tag}`);
    const rel = relative(blogRoot, file)
      .replace(/\\/g, '/')
      .replace(/(\/index)?\.mdx?$/, '');
    const dated = /^(\d{4})-(\d{2})-(\d{2})-(.+)$/.exec(rel);
    const path = slug ?? (dated ? dated.slice(1).join('/') : rel);
    routes.add(normalizeRoute(`${base}/${String(path).replace(/^\//, '')}`));
  }
  return routes;
}

// Redirect sources publish a route of their own. netlify.toml writes them as
// `from = "/old"` under [[redirects]], with a trailing `/*` for a splat; the
// client-redirects plugin as `from` strings in its options.
export function redirectSources({ netlifyToml = '', clientRedirects = [] }) {
  const routes = new Set();
  const prefixes = [];
  for (const [, from] of netlifyToml.matchAll(
    /^\s*from\s*=\s*["']([^"']+)["']/gm,
  )) {
    if (from.endsWith('/*')) prefixes.push(normalizeRoute(from.slice(0, -2)));
    else routes.add(normalizeRoute(from));
  }
  for (const { from } of clientRedirects)
    for (const source of [from].flat()) routes.add(normalizeRoute(source));
  return { routes, prefixes };
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

// JSX link attributes in MDX, and absolute URLs on the site's own hosts, are
// routes however they are written.
const JSX_ROUTE = /\b(?:to|href)=["'{]+(\/[^"'}\s]*)/g;
const SITE_URL =
  /https?:\/\/endusers\.(?:cncf\.io|netlify\.app)(\/[^\s)>"'`\]]*)?/g;

export function routeCitations(text, { repoDirs }) {
  const seen = new Set();
  // A leading-slash span or link target may be a repository or system path;
  // a JSX attribute or a site URL cannot.
  const ambiguous = [...codeSpans(text), ...linkTargets(text)];
  const certain = [
    ...[...text.matchAll(JSX_ROUTE)].map((match) => match[1]),
    ...[...text.matchAll(SITE_URL)].map((match) => match[1] ?? '/'),
  ];
  for (const [token, isCertain] of [
    ...ambiguous.map((token) => [token, false]),
    ...certain.map((token) => [token, true]),
  ]) {
    if (!/^\/([A-Za-z0-9]|$)/.test(token) || isPlaceholder(token)) continue;
    const route = normalizeRoute(token);
    const [first] = route.slice(1).split('/');
    if (!isCertain && (repoDirs.has(first) || OS_ROOTS.has(first))) continue;
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
const JUST_RUN = /^\s*just ([A-Za-z_][A-Za-z0-9_-]*)/gm;
// `validate:metrics` on its own: a colon-separated span is a script name when
// its first segment is the family of a script that exists (`validate:`,
// `check:`), which keeps `og:url` and `localhost:3000` out.
const SCRIPT_SHAPE = /^[a-z_][a-z0-9_-]*(?::[a-z0-9_-]+)+$/;
// "There is no `validate:x` script" is a claim too, and it goes stale the
// other way: when the script is added.
const NO_SCRIPT =
  /\b[Nn]o\s+`(?:npm run (?:-s |--silent )?)?([A-Za-z0-9_:.-]+)`\s+(?:npm\s+)?script\b/g;

export function npmScriptCitations(text, scripts = {}) {
  const families = new Set(
    Object.keys(scripts)
      .filter((name) => name.includes(':'))
      .map((name) => name.split(':')[0]),
  );
  const named = codeSpans(text).filter(
    (span) => SCRIPT_SHAPE.test(span) && families.has(span.split(':')[0]),
  );
  return [
    ...new Set([
      ...[...text.matchAll(NPM_RUN)].map((match) => match[1]),
      ...named,
    ]),
  ];
}

export function unresolvedNpmScripts(text, { scripts }) {
  const claimedAbsent = new Set(
    [...text.matchAll(NO_SCRIPT)].map((match) => match[1]),
  );
  return [
    ...npmScriptCitations(text, scripts).filter(
      (name) => !(name in scripts) && !claimedAbsent.has(name),
    ),
    ...[...claimedAbsent]
      .filter((name) => name in scripts)
      .map((name) => `no ${name} script`),
  ];
}

// A recipe is invoked by a code span or a fenced line that starts with
// `just`, or named as "the `x` recipe"; the word in running prose is not.
export function justRecipeCitations(text) {
  const fenced = [...text.matchAll(/^(`{3,}|~{3,}).*\n([\s\S]*?)^\1/gm)].map(
    (match) => match[2],
  );
  const seen = new Set();
  for (const source of [...codeSpans(text), ...fenced])
    for (const match of source.matchAll(JUST_RUN)) seen.add(match[1]);
  for (const match of text.matchAll(
    /`([A-Za-z_][A-Za-z0-9_-]*)`\s+(?:Justfile\s+|just\s+)?recipe\b/g,
  ))
    seen.add(match[1]);
  return [...seen];
}

export function justRecipes(source) {
  const recipes = new Set();
  for (const line of source.split('\n')) {
    const match = /^@?([A-Za-z_][A-Za-z0-9_-]*)(?:\s+[^:]*)?:(?!=)/.exec(line);
    if (match) recipes.add(match[1]);
  }
  return recipes;
}

export function unresolvedJustRecipes(text, { recipes }) {
  return justRecipeCitations(text).filter((name) => !recipes.has(name));
}

// ---------------------------------------------------------------------------
// Workflows and checks cited by display name
// ---------------------------------------------------------------------------

// The `name:` of every workflow, and of every job in it (a job's name is the
// check GitHub shows on a pull request).
export function workflowNames(workflowsDir) {
  const workflows = new Set();
  const jobs = new Set();
  for (const file of walk(workflowsDir, {
    keep: (name) => /\.ya?ml$/.test(name),
  })) {
    const doc = parseYaml(readFileSync(file, 'utf8')) ?? {};
    if (doc.name) workflows.add(doc.name);
    for (const [id, job] of Object.entries(doc.jobs ?? {}))
      jobs.add(job?.name ?? id);
  }
  return { workflows, jobs };
}

// "Refresh metrics" workflow, `Lint repository` check: a capitalised name in
// quotes or backticks, followed by what it is. (Bold is not read: `**MUST**`
// pairs with the next bold span.)
// Prose wraps, so the name may span a line break.
const NAMED_RUN =
  /("|`)([A-Z][^"`\n]*(?:\n[^"`\n]+)?)\1\s+(?:(?:CI|PR|required|status|GitHub\s+Actions)\s+)?(workflow|check|job|gate)s?\b/g;

export function workflowNameCitations(text) {
  return [...text.matchAll(NAMED_RUN)]
    .map((match) => ({
      name: match[2].replace(/\s+/g, ' ').trim(),
      kind: match[3],
    }))
    .filter(({ name }) => !/\.ya?ml$/.test(name));
}

export function unresolvedWorkflowNames(text, { workflows, jobs }) {
  return [
    ...new Set(
      workflowNameCitations(text)
        .filter(
          ({ name, kind }) =>
            !workflows.has(name) && (kind === 'workflow' || !jobs.has(name)),
        )
        .map(({ name }) => name),
    ),
  ];
}

// ---------------------------------------------------------------------------
// ADR status claims
// ---------------------------------------------------------------------------

const ADR_STATUS = /(Proposed|Accepted|Rejected|Superseded|Deprecated)/;
const ADR_CLAIM = new RegExp(
  `\\bADR\\s+(\\d{4})\\b[^.;:\\n]{0,40}?\\b${ADR_STATUS.source}\\b`,
  'g',
);

// Each decision record's own `- **Status**:` header, by number.
export function adrStatuses(adrDir) {
  const statuses = new Map();
  for (const name of readdirSync(adrDir)) {
    if (!/^\d{4}-.*\.md$/.test(name)) continue;
    const status = /^- \*\*Status\*\*:\s*(\S+)/m.exec(
      readFileSync(join(adrDir, name), 'utf8'),
    );
    if (status) statuses.set(name.slice(0, 4), status[1]);
  }
  return statuses;
}

// "ADR 0001 is Accepted": prose that states a decision record's status has to
// agree with the record.
export function unresolvedAdrStatuses(text, { adrStatuses: statuses }) {
  return [...text.matchAll(ADR_CLAIM)]
    .filter(([, number, status]) => statuses.get(number) !== status)
    .map(([, number, status]) => `ADR ${number} ${status}`);
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
    ...unresolvedWorkflowNames(text, repo).map((t) => ({
      kind: 'workflow name',
      token: t,
    })),
    ...unresolvedAdrStatuses(text, repo).map((t) => ({
      kind: 'ADR status',
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
