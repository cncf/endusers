import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

// docusaurus.config.js is ESM but calls require.resolve() for its plugin list,
// which Docusaurus supplies through its own loader. Provide the same shim so
// the config can be imported and asserted on directly.
globalThis.require ??= createRequire(import.meta.url);

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const docsRoot = join(repoRoot, 'docs');
const staticRoot = join(repoRoot, 'static');

async function loadConfig(env = {}) {
  const previous = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    // Cache-bust so env overrides are re-evaluated on each load.
    const suffix = `?load=${Math.random()}`;
    return (await import(`../docusaurus.config.js${suffix}`)).default;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const config = await loadConfig();
const sidebars = (await import('../sidebars.js')).default;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.md') || entry.endsWith('.mdx')) out.push(full);
  }
  return out;
}

function frontmatterSlug(file) {
  const text = readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return undefined;
  const slug = /^slug:\s*(\S+)\s*$/m.exec(match[1]);
  return slug ? slug[1].replace(/^['"]|['"]$/g, '') : undefined;
}

function normalizeRoute(route) {
  const withoutFragment = route.split('#')[0].split('?')[0];
  if (withoutFragment === '/' || withoutFragment === '') return '/';
  return withoutFragment.replace(/\/+$/, '');
}

// Mirrors the Docusaurus docs-plugin route derivation for routeBasePath '/':
// an explicit frontmatter slug wins, otherwise the path relative to docs/ is
// used, with index files collapsing onto their containing directory.
function routeForDoc(file) {
  const slug = frontmatterSlug(file);
  if (slug?.startsWith('/')) return normalizeRoute(slug);
  const rel = relative(docsRoot, file).replace(/\\/g, '/');
  const withoutExtension = rel.replace(/\.mdx?$/, '');
  const collapsed = withoutExtension.replace(/(^|\/)index$/, '');
  return normalizeRoute(`/${collapsed}`);
}

const docFiles = walk(docsRoot);
const docRoutes = new Map();
for (const file of docFiles) {
  const route = routeForDoc(file);
  if (!docRoutes.has(route)) docRoutes.set(route, []);
  docRoutes.get(route).push(relative(repoRoot, file));
}

test('docs are served at the site root', () => {
  assert.equal(config.presets[0][1].docs.routeBasePath, '/');
});

test('no two docs claim the same route', () => {
  const collisions = [...docRoutes.entries()].filter(
    ([, files]) => files.length > 1,
  );
  assert.deepEqual(collisions, []);
});

test('a doc claims the site root route', () => {
  assert.ok(
    docRoutes.has('/'),
    'no doc has "slug: /", so the landing page would 404',
  );
});

test('every internal navbar link resolves to a doc, the blog, or a static file', () => {
  const unresolved = [];
  for (const item of config.themeConfig.navbar.items) {
    if (!item.to) continue;
    const route = normalizeRoute(item.to);
    if (docRoutes.has(route)) continue;
    if (route === '/blog' || route.startsWith('/blog/')) continue;
    if (existsSync(join(staticRoot, route.replace(/^\//, '')))) continue;
    unresolved.push(`${item.label}: ${item.to}`);
  }
  assert.deepEqual(unresolved, []);
});

test('navbar link fragments point at a heading that exists in the target doc', () => {
  const broken = [];
  for (const item of config.themeConfig.navbar.items) {
    const fragment = item.to?.includes('#') ? item.to.split('#')[1] : undefined;
    if (!fragment) continue;
    const files = docRoutes.get(normalizeRoute(item.to));
    assert.ok(files, `${item.to} does not resolve to a doc`);
    const text = readFileSync(join(repoRoot, files[0]), 'utf8');
    const anchors = [...text.matchAll(/^#{2,6}\s+(.+?)\s*$/gm)].map((match) =>
      match[1]
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-'),
    );
    const explicit = [...text.matchAll(/\{#([\w-]+)\}/g)].map((m) => m[1]);
    if (!anchors.includes(fragment) && !explicit.includes(fragment)) {
      broken.push(`${item.to} (available: ${anchors.join(', ')})`);
    }
  }
  assert.deepEqual(broken, []);
});

test('every docSidebar navbar item names a sidebar defined in sidebars.js', () => {
  const missing = config.themeConfig.navbar.items
    .filter((item) => item.type === 'docSidebar')
    .map((item) => item.sidebarId)
    .filter((id) => !Object.hasOwn(sidebars, id));
  assert.deepEqual(missing, []);
});

test('every sidebar is reachable from the navbar', () => {
  const referenced = new Set(
    config.themeConfig.navbar.items
      .filter((item) => item.type === 'docSidebar')
      .map((item) => item.sidebarId),
  );
  const orphans = Object.keys(sidebars).filter((id) => !referenced.has(id));
  assert.deepEqual(orphans, []);
});

test('every autogenerated sidebar points at a docs directory with content', () => {
  const problems = [];
  for (const [id, entries] of Object.entries(sidebars)) {
    for (const entry of entries) {
      if (entry.type !== 'autogenerated') continue;
      const dir = join(docsRoot, entry.dirName);
      if (!existsSync(dir)) {
        problems.push(`${id}: docs/${entry.dirName} does not exist`);
        continue;
      }
      if (walk(dir).length === 0) {
        problems.push(`${id}: docs/${entry.dirName} contains no documents`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('branding and theme assets referenced by the config exist on disk', () => {
  const { navbar, image } = config.themeConfig;
  const staticRefs = [
    config.favicon,
    image,
    navbar.logo.src,
    navbar.logo.srcDark,
    ...config.headTags
      .filter((tag) => tag.tagName === 'link')
      .map((tag) => tag.attributes.href),
  ];
  const missing = staticRefs.filter(
    (ref) => !existsSync(join(staticRoot, ref.replace(/^\//, ''))),
  );
  assert.deepEqual(missing, []);
  assert.ok(existsSync(join(repoRoot, config.presets[0][1].theme.customCss)));
});

test('broken-link enforcement is not weakened', () => {
  assert.equal(config.onBrokenLinks, 'throw');
});

test('the blog preset points at the blog directory the repo actually has', () => {
  assert.ok(config.presets[0][1].blog, 'blog preset options are missing');
  assert.ok(existsSync(join(repoRoot, 'blog')));
});

test('structured data identifies the site and its parent organization', () => {
  const jsonLd = config.headTags.find(
    (tag) => tag.attributes?.type === 'application/ld+json',
  );
  assert.ok(jsonLd, 'no JSON-LD head tag');
  const parsed = JSON.parse(jsonLd.innerHTML);
  assert.equal(parsed['@type'], 'Organization');
  assert.equal(parsed.url, 'https://endusers.cncf.io');
  assert.equal(
    parsed.logo,
    'https://endusers.cncf.io/img/cloud-native-end-users.svg',
  );
  assert.equal(
    parsed.parentOrganization.name,
    'Cloud Native Computing Foundation',
  );
});

test('SITE_URL and BASE_URL overrides flow into url, baseUrl and the JSON-LD logo', async () => {
  const preview = await loadConfig({
    SITE_URL: 'https://castrojo.github.io',
    BASE_URL: '/endusers/',
  });
  assert.equal(preview.url, 'https://castrojo.github.io');
  assert.equal(preview.baseUrl, '/endusers/');
  const jsonLd = preview.headTags.find(
    (tag) => tag.attributes?.type === 'application/ld+json',
  );
  assert.equal(
    JSON.parse(jsonLd.innerHTML).logo,
    'https://castrojo.github.io/endusers/img/cloud-native-end-users.svg',
  );
});

test('a trailing slash on SITE_URL does not double up in the JSON-LD logo', async () => {
  const trailing = await loadConfig({
    SITE_URL: 'https://endusers.cncf.io/',
    BASE_URL: undefined,
  });
  const jsonLd = trailing.headTags.find(
    (tag) => tag.attributes?.type === 'application/ld+json',
  );
  assert.equal(
    JSON.parse(jsonLd.innerHTML).logo,
    'https://endusers.cncf.io/img/cloud-native-end-users.svg',
  );
});

test('local search is registered as a plugin', () => {
  assert.ok(
    config.plugins.some((plugin) =>
      String(plugin).includes('docusaurus-plugin-search-local'),
    ),
  );
});
