import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { isAllowedImageHost } from '../scripts/lib/profile-image.mjs';

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

function findSearchPlugin() {
  return config.plugins.find((plugin) => {
    const resolved = Array.isArray(plugin) ? plugin[0] : plugin;
    return String(resolved).includes('docusaurus-plugin-search-local');
  });
}

test('local search is registered as a plugin', () => {
  assert.ok(findSearchPlugin());
});

test('local search indexes docs at the route docs are actually served on', () => {
  // Regression for #769: the plugin defaults docsRouteBasePath to ["docs"],
  // which matches no route once docs.routeBasePath is "/" -- every docs page
  // went unindexed and search silently returned blog posts only.
  const plugin = findSearchPlugin();
  const [, options] = Array.isArray(plugin) ? plugin : [plugin, {}];
  assert.equal(
    options?.docsRouteBasePath,
    config.presets[0][1].docs.routeBasePath,
  );
});

test('e2e coverage source maps are opt-in and client-only', async () => {
  const normal = await loadConfig({ E2E_COVERAGE: undefined });
  assert.equal(
    normal.plugins.some(
      (plugin) =>
        typeof plugin === 'function' && plugin.name === 'endusersE2ESourceMaps',
    ),
    false,
  );

  const coverage = await loadConfig({ E2E_COVERAGE: '1' });
  const factory = coverage.plugins.find(
    (plugin) =>
      typeof plugin === 'function' && plugin.name === 'endusersE2ESourceMaps',
  );
  assert.equal(typeof factory, 'function');
  const plugin = factory();
  assert.deepEqual(plugin.configureWebpack({}, false), {
    devtool: 'source-map',
  });
  assert.deepEqual(plugin.configureWebpack({}, true), {});
});

test('the e2e data fixtures are opt-in and scoped to the site data directory', async () => {
  // The overlay rewrites data/*.json at build time (see
  // tests/tools/e2e-data-fixtures.cjs). Registering it outside the coverage
  // build would put fixture records into what the site ships, and widening
  // the rule past data/ would hand every other JSON import to the loader.
  const normal = await loadConfig({ E2E_COVERAGE: undefined });
  assert.equal(
    normal.plugins.some(
      (plugin) =>
        typeof plugin === 'function' &&
        plugin.name === 'endusersE2EDataFixtures',
    ),
    false,
  );

  const coverage = await loadConfig({ E2E_COVERAGE: '1' });
  const factory = coverage.plugins.find(
    (plugin) =>
      typeof plugin === 'function' && plugin.name === 'endusersE2EDataFixtures',
  );
  assert.equal(typeof factory, 'function');

  const siteDir = '/srv/site';
  const [rule] = factory().configureWebpack({
    resolve: { alias: { '@site': siteDir } },
  }).module.rules;
  assert.equal(rule.include, `${siteDir}/data`);
  assert.equal(rule.type, 'json');
  assert.ok(rule.test.test('members.json'));
  assert.equal(rule.test.test('members.jsonc'), false);
  assert.equal(
    rule.use[0],
    `${siteDir}/tests/tools/e2e-data-fixture-loader.cjs`,
  );
});

// The meta Content-Security-Policy is the browser-side backstop for content
// this site does not author. Nothing asserted it until now, so it could be
// weakened or deleted without a single test failing.
function cspDirectives(from = config) {
  const meta = from.headTags.find(
    (tag) =>
      tag.tagName === 'meta' &&
      tag.attributes?.['http-equiv'] === 'Content-Security-Policy',
  );
  assert.ok(meta, 'no Content-Security-Policy head tag');
  return new Map(
    meta.attributes.content
      .split(';')
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...values] = directive.split(/\s+/);
        return [name, values];
      }),
  );
}

// Expands a CSP host source into a hostname isAllowedImageHost() can judge.
function cspSourceHostname(source) {
  const host = source.replace(/^https:\/\//, '');
  return host.startsWith('*.') ? `subdomain.${host.slice(2)}` : host;
}

function cspAdmitsHost(sources, host) {
  return sources.some((source) => {
    const pattern = source.replace(/^https:\/\//, '');
    if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1));
    return pattern === host;
  });
}

test('the meta CSP keeps its non-script hardening directives', () => {
  const directives = cspDirectives();
  assert.deepEqual(directives.get('base-uri'), ["'self'"]);
  assert.deepEqual(directives.get('object-src'), ["'none'"]);
  assert.deepEqual(directives.get('form-action'), ["'self'"]);
});

// Without a `default-src`, an unnamed fetch directive is not restricted by the
// named ones -- it is simply absent, and the browser allows any host. These
// three were missing while `object-src 'none'` was present, which left the
// more capable `<iframe>` open in a policy that closed `<object>`.
test('the meta CSP names the fetch directives that have no default-src fallback', () => {
  const directives = cspDirectives();
  assert.equal(
    directives.has('default-src'),
    false,
    'this assertion set assumes no default-src: if one is added, every directive below inherits it and these tests must be revisited',
  );
  assert.deepEqual(
    directives.get('frame-src'),
    ["'none'"],
    "frame-src is missing or widened: an <iframe> that slipped the element allowlist in scripts/lib/mdx-active-content.mjs would load any host, framed inside this origin's page",
  );
  assert.deepEqual(
    directives.get('media-src'),
    ["'none'"],
    'media-src is missing or widened: a <video>/<audio> src that slipped a gate would beacon the visitor to any host',
  );
  assert.deepEqual(
    directives.get('connect-src'),
    ["'self'"],
    'connect-src is missing or widened: it confines fetch/XHR/WebSocket to this origin so injected content cannot exfiltrate to a third party',
  );
});

// The three directives above are only safe to set this tightly because the
// site ships nothing that needs them widened. If that stops being true the
// policy has to change with it, so assert the premise rather than trusting it.
test('no shipped source needs a wider frame, media or connect source', () => {
  const walkAll = (dir) =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walkAll(full) : [full];
    });
  const offenders = [];
  for (const dir of ['src', 'docs', 'blog', 'data']) {
    const root = join(repoRoot, dir);
    if (!existsSync(root)) continue;
    for (const file of walkAll(root)) {
      if (!/\.(js|jsx|mjs|md|mdx|json)$/.test(file)) continue;
      const body = readFileSync(file, 'utf8');
      const match = body.match(
        /<iframe|<video[\s>]|<audio[\s>]|XMLHttpRequest|new WebSocket|new EventSource/i,
      );
      if (match) offenders.push(`${relative(repoRoot, file)}: ${match[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a frame, media element or cross-origin request was added; widen the CSP deliberately rather than leaving it to block at runtime',
  );
});

test('the meta CSP confines images to the hosts the image gate allows', () => {
  const sources = cspDirectives().get('img-src');
  assert.ok(
    sources,
    'img-src is missing: an <img src> that slipped a gate would beacon the visitor to any host',
  );
  assert.ok(sources.includes("'self'"), "img-src must admit 'self'");
  assert.ok(
    sources.includes('data:'),
    'img-src must admit data:, which Infima uses for inlined SVG icons',
  );

  const hosts = sources.filter((source) => source.startsWith('https://'));
  assert.ok(hosts.length, 'img-src lists no remote hosts');
  assert.ok(
    sources.every(
      (source) =>
        source === "'self'" || source === 'data:' || hosts.includes(source),
    ),
    `img-src carries a source that is neither 'self', data: nor an https host: ${sources.join(' ')}`,
  );

  // Neither list may be wider than the other: a CSP wider than the gate
  // publishes a beacon the gate meant to stop, and a CSP narrower than the
  // gate blocks an image the gate approved.
  for (const source of hosts) {
    assert.equal(
      isAllowedImageHost(cspSourceHostname(source)),
      true,
      `img-src admits ${source}, which scripts/lib/profile-image.mjs rejects`,
    );
  }
  for (const host of [
    'raw.githubusercontent.com',
    'avatars.githubusercontent.com',
    'github.com',
    'www.github.com',
    'cncf.io',
    'www.cncf.io',
  ]) {
    assert.equal(isAllowedImageHost(host), true);
    assert.ok(
      cspAdmitsHost(hosts, host),
      `scripts/lib/profile-image.mjs allows ${host} but the CSP img-src does not`,
    );
  }

  assert.equal(isAllowedImageHost('evil.example'), false);
  assert.equal(cspAdmitsHost(hosts, 'evil.example'), false);
  // A suffix match must not be satisfied by a lookalike registrable domain.
  assert.equal(cspAdmitsHost(hosts, 'notcncf.io'), false);
});

test('every profile image the site ships is admitted by the CSP', () => {
  const sources = cspDirectives().get('img-src');
  const hosts = sources.filter((source) => source.startsWith('https://'));
  const { people } = JSON.parse(
    readFileSync(join(repoRoot, 'data/community-people.json'), 'utf8'),
  );
  const entries = Object.values(people).flat();
  assert.ok(entries.length, 'no community people to check');
  const blocked = entries
    .map((person) => person.image)
    .filter(
      (image) => typeof image === 'string' && image.startsWith('https://'),
    )
    .filter((image) => !cspAdmitsHost(hosts, new URL(image).hostname));
  assert.deepEqual(blocked, []);
});

test('the CSP holds under a preview deployment origin', async () => {
  const preview = await loadConfig({
    SITE_URL: 'https://cncf.github.io',
    BASE_URL: '/endusers/',
  });
  const directives = cspDirectives(preview);
  assert.deepEqual(directives.get('object-src'), ["'none'"]);
  assert.deepEqual(directives.get('frame-src'), ["'none'"]);
  assert.deepEqual(directives.get('media-src'), ["'none'"]);
  // 'self' is the preview origin under a preview deployment, so local search
  // still reads its index from the host the page was served from.
  assert.deepEqual(directives.get('connect-src'), ["'self'"]);
  assert.ok(directives.get('img-src')?.includes("'self'"));
});
