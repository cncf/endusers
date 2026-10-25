// Automated WCAG scanning of the built site.
//
// The repository already asserts accessibility *details* by hand — footer
// landmarks in tests/footer.test.mjs, aria-label wiring in
// tests/architecture-filters-ui.test.mjs and tests/metrics-dashboard.test.mjs,
// role-based locators throughout tests/e2e/ — and it gates one rendered
// property, text/background contrast on buttons, through
// `npm run validate:button-contrast`. Every one of those is a specific
// assertion someone wrote after noticing a specific problem.
//
// What none of them provide is a rule engine. No test in the suite runs a
// conformance checker over a rendered page, so an entire class of regression
// is invisible: a heading level skipped by an MDX edit, a colour token change
// that drops contrast on body text or links (validate:button-contrast reads
// CSS and only covers buttons), a duplicate landmark, an <html> that loses its
// lang, a form control that loses its label, a list element that gains a
// non-<li> child. All of those ship green today.
//
// This spec runs axe-core against the built pages for the WCAG 2.1 A and AA
// rule sets. ROUTES names one instance of each distinct page template and
// scans it in both colour modes; CONTENT_ROUTES is every other path in the
// sitemap, scanned once. Two architecture detail pages exercise identical
// chrome, but the markup between the template's landmarks is authored per
// page -- an image without alt text in one submission, a heading level
// skipped in one user-group doc -- and a template sample cannot see it.
//
// Pre-existing violations are recorded in KNOWN_VIOLATIONS below rather than
// suppressed globally, and the baseline retires itself: if a recorded entry
// stops being reported, this file fails and asks for the entry to be deleted.
// That is the same shape as the persist-credentials and timeout-minutes
// baselines in tests/ci-supply-chain.test.mjs, and it is what stops a
// temporary allowance from quietly becoming permanent. Each route's own scan
// checks both directions -- nothing unrecorded reported, nothing recorded
// missing -- so retirement costs no extra navigation; this file used to
// rescan every baselined route serially in three further tests, which was the
// slowest 25s of the suite.
import AxeBuilder from '@axe-core/playwright';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test, expect, waitForHydration } from '../tools/e2e-coverage.cjs';

// One route per page template.
//
// Routes that reuse a template already listed here are deliberately absent:
// /community/user-groups/<group> renders the same doc page as
// /community/technical-advisory-board, and every /architectures/<org> page
// renders the same doc page as /architectures/adobe. Scanning them would cost
// time without covering new markup.
//
// Which routes those are is not a judgement call any more. Docusaurus stamps
// the page template onto the built markup as a class pair -- `blog-wrapper
// blog-list-page`, `docs-wrapper docs-doc-page` -- and the "every page
// template in the sitemap is scanned" test below reads them back out of
// build/ and fails when a template has no route here. The list this replaced
// claimed /blog/authors/<name> and /blog/tags/<tag> "render the same blog
// list page as /blog"; the build says they are `blog-authors-posts-page` and
// `blog-tags-post-list-page`, two templates of their own with their own
// header markup (an author card, a tag title block), and both went unscanned
// for as long as the comment stood. That is the /awards failure again -- a
// prose claim about which markup a route renders, with nothing reading the
// build to check it.
const ROUTES = [
  { path: '/', label: 'practitioners home' },
  { path: '/community', label: 'community landing' },
  { path: '/community/members', label: 'member directory' },
  { path: '/community/technical-advisory-board', label: 'TAB roster' },
  { path: '/community/user-groups', label: 'user groups hub' },
  { path: '/architectures', label: 'architecture catalog' },
  { path: '/architectures/adobe', label: 'architecture detail' },
  { path: '/community/awards', label: 'awards timeline' },
  { path: '/resources/metrics', label: 'metrics dashboard' },
  { path: '/events', label: 'events' },
  { path: '/resources', label: 'resources landing' },
  { path: '/resources/case-studies', label: 'case studies' },
  { path: '/resources/radar-reports', label: 'radar reports' },
  { path: '/blog', label: 'blog index' },
  { path: '/blog/welcome-to-endusers-cncf-io', label: 'blog post' },
  { path: '/blog/archive', label: 'blog archive' },
  { path: '/blog/authors', label: 'blog authors index' },
  { path: '/blog/authors/castrojo', label: 'blog author posts' },
  { path: '/blog/tags', label: 'blog tags index' },
  { path: '/blog/tags/community', label: 'blog tag post list' },
];

// Every sitemap path ROUTES does not name, in the order the sitemap lists
// them. Derived from the build rather than written down so a page added to
// the site is scanned the first time it is built, and a page removed stops
// being asked for. Scanned in both colour modes like ROUTES: the first run
// of this list found syntax-highlighting tokens below AA contrast in the
// light code theme, a defect the dark theme shared on a different token.
//
// The coverage build (E2E_COVERAGE=1) also mounts synthetic fixture pages --
// the fixture docs instance and the per-directory fixture builds, all routed
// under an /e2e-coverage- prefix -- so other specs can reach component
// states no published page produces. No user reaches them on a production
// build, so they are left out here; the specs that own them assert on them
// directly.
//
// `playwright test --list` loads this file without a build (the unit suite
// asks it which specs exist), so an absent sitemap yields no content routes
// rather than a load error; the "scanned by exactly one route list" test
// below fails a real run that has none.
const FIXTURE_ROUTE_PREFIX = '/e2e-coverage-';
const SITEMAP = resolve('build/sitemap.xml');
const CONTENT_ROUTES = existsSync(SITEMAP)
  ? sitemapPaths().filter(
      (path) =>
        !path.startsWith(FIXTURE_ROUTE_PREFIX) &&
        !ROUTES.some((route) => route.path === path),
    )
  : [];

// Interactive states the route scans above structurally cannot reach.
//
// Every scan in ROUTES analyses a page in the state it loads in. That is the
// whole site as far as axe is concerned, and it leaves out the markup that
// only exists once a user does something: the two profile dialogs, and the
// navbar drawer that replaces the header below Docusaurus' mobile breakpoint.
// None of that DOM is in any document axe has ever been handed.
//
// The rules that go unrun with it are not a long tail. A modal is the one
// construct axe has a dedicated rule family for -- aria-dialog-name,
// aria-hidden-focus on the inert page behind it, aria-required-attr on
// aria-modal, nested-interactive -- and none of those rules can fire against
// a closed dialog, because the elements they match are not rendered. The
// drawer is a second landmark and a second navigation list appearing in a
// document that already has one, which is the shape duplicate-landmark and
// list rules exist to catch.
//
// The suite asserts plenty about these states by hand, and the division is
// the same one this file's preamble draws for routes: tests/e2e/
// interactions.spec.js and tests/e2e/community-people.spec.js check aria-modal,
// the close button's accessible name and the focus trap; tests/e2e/
// navigation.spec.js checks that the drawer lists the same links as the
// desktop navbar. Each of those is a specific assertion someone wrote after
// noticing a specific problem. None of them is a rule engine, and a heading
// level, a contrast token or a label lost inside an opened dialog ships green
// today exactly as it did for routes before this file existed.
//
// The two dialogs keep the header mounted, so they inherit the navbar's
// search-button entry in KNOWN_STATE_VIOLATIONS below; the drawer scans
// clean. Beyond that these are regression guards rather than a baseline of
// known bugs. They are scanned in both colour modes for the same reason the
// routes are: a dialog paints its own surface, so a contrast regression there
// is invisible to a light-mode-only scan.
const INTERACTIVE_STATES = [
  {
    label: 'member profile dialog',
    path: '/community/members',
    async open(page) {
      const section = page.getByRole('region', {
        name: 'End User Community organization directory',
      });
      const trigger = section
        .getByRole('button', { name: /^Open .+ profile$/ })
        .first();
      await waitForHydration(trigger);
      await trigger.click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  {
    label: 'TAB profile dialog',
    path: '/community/technical-advisory-board',
    async open(page) {
      const trigger = page
        .getByRole('button', { name: /^Open .+ profile$/ })
        .first();
      await waitForHydration(trigger);
      await trigger.click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  {
    label: 'mobile navigation drawer',
    path: '/',
    // Below Docusaurus' navbar breakpoint the header renders as a hamburger
    // and the links move into `.navbar-sidebar`, which does not exist in the
    // desktop document at all. Set before the navigation, not after: the
    // breakpoint decides what the page builds, so resizing a loaded desktop
    // page is not the same document.
    viewport: { width: 414, height: 896 },
    async open(page) {
      const toggle = page.locator('.navbar__toggle');
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(page.locator('.navbar-sidebar')).toBeVisible();
    },
  },
];

// Violations carried by the navbar, which every scanned document renders.
//
// docusaurus-plugin-search-local's SearchButton labels itself
// `aria-label="Search (Control+k)"` while its visible text is "Search" plus
// the kbd hint "K" (the Control key is drawn as an icon). The accessible name
// does not contain the visible text, which is what WCAG 2.5.3 Label in Name
// and axe's label-content-name-mismatch check. axe-core 4.14.0 removed the
// rule's `experimental` tag, so it now runs under wcag21a and reports the
// button on every page and in every dialog state that keeps the header
// mounted. The mobile drawer scans clean because the placeholder and key
// hints are hidden below the navbar breakpoint, leaving no visible text to
// mismatch.
//
// The site has no hook for the fix: the plugin's SearchBar renders
// SearchButton without passing `translations`, so neither string can be
// changed from docusaurus.config.js. This is a baseline, not a suppression;
// every route's scan fails the moment the plugin stops reporting it.
const NAVBAR_VIOLATIONS = ['label-content-name-mismatch'];

// The state counterpart of KNOWN_VIOLATIONS, keyed by state label, with the
// same self-retiring contract: an entry that stops being reported fails the
// state's light-mode scan and has to be deleted.
const KNOWN_STATE_VIOLATIONS = {
  'member profile dialog': [...NAVBAR_VIOLATIONS],
  'TAB profile dialog': [...NAVBAR_VIOLATIONS],
};

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Rules that cannot be evaluated meaningfully here, each with the reason it is
// off. Keep this list empty unless a rule is genuinely inapplicable — a rule
// that merely fails belongs in KNOWN_VIOLATIONS, which retires itself.
const DISABLED_RULES = Object.create(null);

// Violations that exist on the site today, keyed by route path. Each entry is
// an axe rule id. Deleting a fixed entry is required, not optional: the
// route's light-mode scan fails while a stale entry remains, so the baseline
// cannot outlive the bug it describes.
//
// Every route carries the navbar, so every route starts from
// NAVBAR_VIOLATIONS; route-specific entries are appended per path.
const KNOWN_VIOLATIONS = Object.fromEntries(
  ROUTES.map((route) => [route.path, [...NAVBAR_VIOLATIONS]]),
);

// Route-specific violations on CONTENT_ROUTES, keyed by path, with the same
// self-retiring contract. The navbar entry is implied for every content route
// and retired through the template sample in KNOWN_VIOLATIONS, so only what
// a page adds of its own belongs here.
const KNOWN_CONTENT_VIOLATIONS = Object.create(null);

// Both halves of the baseline contract against one scan's results. `allowed`
// is every rule id the scan may report without failing; `recorded` is the
// subset the baseline claims still fails, which must therefore be reported.
// Retirement is checked in light mode only, the mode the retired serial
// rescans ran in, so a rule that fails in one colour scheme but not the
// other is not asked to fail in both.
function expectBaselined(results, { allowed, recorded, mode, where, list }) {
  const allowedIds = new Set(allowed);
  const reported = new Set(results.violations.map((v) => v.id));
  const unrecorded = results.violations.filter((v) => !allowedIds.has(v.id));

  expect(
    unrecorded.map(describe),
    `${where} reported WCAG violations that are not in ${list}`,
  ).toEqual([]);

  if (mode !== 'light') return;
  const stale = recorded.filter((ruleId) => !reported.has(ruleId));
  expect(
    stale,
    `${where}: these rules no longer fail — delete them from ${list}`,
  ).toEqual([]);
}

function scanner(page) {
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  const disabled = Object.keys(DISABLED_RULES);
  return disabled.length > 0 ? builder.disableRules(disabled) : builder;
}

// axe reports one violation object per rule, each carrying the nodes it
// matched; this flattens that into "rule id + where" so a failure message
// names the element instead of just the rule.
function describe(violation) {
  const where = violation.nodes
    .slice(0, 5)
    .map((node) => node.target.join(' '))
    .join(', ');
  return `${violation.id} (${violation.impact ?? 'unknown impact'}) at ${where}`;
}

// The routes the built site publishes, normalized to the form ROUTES uses.
function sitemapPaths() {
  const sitemap = readFileSync(SITEMAP, 'utf8');
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => {
    const path = new URL(loc).pathname.replace(/\/$/, '');
    return path === '' ? '/' : path;
  });

  expect(
    paths.length,
    'no routes parsed out of build/sitemap.xml',
  ).toBeGreaterThan(0);

  return paths;
}

// Class tokens that name a page *template*. Instance-identifying tokens
// (plugin-id-default, docs-version-current, docs-doc-id-<id>) are excluded by
// construction: this matches the whole token, so a prefixed variant of one of
// these names does not pass.
const TEMPLATE_TOKEN =
  /^(?:docs|blog)-(?:wrapper|[a-z-]*page)$|^plugin-(?:docs|blog|pages|content-[a-z-]+)$/;
const CLASS_ATTRIBUTE = /class="([^"]*)"/g;

// The built markup for `path`, reduced to the sorted set of template tokens it
// carries. Pages rendered from the same Docusaurus template share a signature;
// pages rendered from different ones do not.
function templateSignature(path) {
  const file = resolve(`build${path === '/' ? '' : path}/index.html`);
  const html = readFileSync(file, 'utf8');
  const tokens = new Set();
  for (const [, value] of html.matchAll(CLASS_ATTRIBUTE)) {
    for (const token of value.split(/\s+/)) {
      if (TEMPLATE_TOKEN.test(token)) tokens.add(token);
    }
  }
  return [...tokens].sort().join(' ') || '<no template classes>';
}

async function prepare(page, path, mode) {
  const response = await page.goto(path);
  expect(response?.status(), `${path} should not 404`).toBeLessThan(400);
  await expect(
    page.getByRole('heading', { name: 'Page Not Found' }),
  ).toHaveCount(0);

  // Docusaurus hydrates client-side; scanning the server-rendered shell would
  // miss every interactive component on the page.
  await page.locator('main').first().waitFor();
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
  await page.evaluate(() => document.fonts.ready);
}

async function scan(page, path, mode) {
  await prepare(page, path, mode);

  return scanner(page).analyze();
}

// Drives one entry of INTERACTIVE_STATES to the state it describes and scans
// the document there. The state's own `open` asserts the new markup is
// present before this returns, so a scan that found nothing because the
// dialog never opened fails as a missing dialog rather than passing as a
// clean page.
async function scanState(page, state, mode) {
  if (state.viewport) await page.setViewportSize(state.viewport);
  await prepare(page, state.path, mode);
  await state.open(page);

  return scanner(page).analyze();
}

for (const mode of ['light', 'dark']) {
  for (const route of ROUTES) {
    test(`${route.label} (${route.path}) has no unrecorded WCAG A/AA violations in ${mode}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: mode });
      const results = await scan(page, route.path, mode);
      const recorded = KNOWN_VIOLATIONS[route.path] ?? [];
      expectBaselined(results, {
        allowed: recorded,
        recorded,
        mode,
        where: route.path,
        list: 'KNOWN_VIOLATIONS',
      });
    });
  }
}

for (const mode of ['light', 'dark']) {
  for (const path of CONTENT_ROUTES) {
    test(`content page ${path} has no unrecorded WCAG A/AA violations in ${mode}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: mode });
      const results = await scan(page, path, mode);
      const recorded = KNOWN_CONTENT_VIOLATIONS[path] ?? [];
      expectBaselined(results, {
        allowed: [...NAVBAR_VIOLATIONS, ...recorded],
        recorded,
        mode,
        where: path,
        list: 'KNOWN_CONTENT_VIOLATIONS',
      });
    });
  }
}

for (const mode of ['light', 'dark']) {
  for (const state of INTERACTIVE_STATES) {
    test(`${state.label} has no unrecorded WCAG A/AA violations in ${mode}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: mode });
      const results = await scanState(page, state, mode);
      const recorded = KNOWN_STATE_VIOLATIONS[state.label] ?? [];
      expectBaselined(results, {
        allowed: recorded,
        recorded,
        mode,
        where: state.label,
        list: 'KNOWN_STATE_VIOLATIONS',
      });
    });
  }
}

test('every baselined state is a state this spec scans', () => {
  // The companion of the ROUTES check below: a KNOWN_STATE_VIOLATIONS key
  // that names no entry in INTERACTIVE_STATES would silence nothing and no
  // scan would ever ask its rules to retire.
  const scanned = new Set(INTERACTIVE_STATES.map((state) => state.label));
  const unknown = Object.keys(KNOWN_STATE_VIOLATIONS).filter(
    (label) => !scanned.has(label),
  );

  expect(
    unknown,
    'KNOWN_STATE_VIOLATIONS names states INTERACTIVE_STATES does not scan',
  ).toEqual([]);
});

test('every baselined route is a route this spec scans', () => {
  // A KNOWN_VIOLATIONS key that matches no entry in ROUTES would silence
  // nothing and go unnoticed, because no scan would ever read it. The same
  // holds for a content entry naming a path the sitemap no longer lists.
  const scanned = new Set(ROUTES.map((route) => route.path));
  const unknown = Object.keys(KNOWN_VIOLATIONS).filter(
    (path) => !scanned.has(path),
  );

  expect(unknown, 'KNOWN_VIOLATIONS names routes ROUTES does not scan').toEqual(
    [],
  );

  const content = new Set(CONTENT_ROUTES);
  const unknownContent = Object.keys(KNOWN_CONTENT_VIOLATIONS).filter(
    (path) => !content.has(path),
  );

  expect(
    unknownContent,
    'KNOWN_CONTENT_VIOLATIONS names routes the sitemap does not list outside ROUTES',
  ).toEqual([]);
});

test('every sitemap path is scanned by exactly one route list', () => {
  // CONTENT_ROUTES is the sitemap minus ROUTES, so between them every
  // published page is scanned once as content or twice as a template sample,
  // and a path appearing in both would be a route listed twice in ROUTES.
  const listed = sitemapPaths().filter(
    (path) => !path.startsWith(FIXTURE_ROUTE_PREFIX),
  );
  const scanned = [...ROUTES.map((route) => route.path), ...CONTENT_ROUTES];

  expect([...scanned].sort()).toEqual([...new Set(listed)].sort());
  expect(
    CONTENT_ROUTES.length,
    'the sitemap lists no page outside ROUTES; drop CONTENT_ROUTES if that is now true',
  ).toBeGreaterThan(0);
});

test('every scanned route is a listed page of the built site', () => {
  // How a scan can pass without scanning anything: when /awards was still an
  // unlisted "Awards moved" stub, the route labelled "awards timeline" scanned
  // three lines of redirect notice and passed, while /community/awards -- the
  // only page that mounts <AwardsTimeline /> -- was never scanned at all.
  // Every real page template appears in the sitemap, and a stub excluded from
  // it does not, so membership is the check that separates the two.
  const listed = new Set(sitemapPaths());

  const unlisted = [
    ...ROUTES.map((route) => route.path),
    // The states are reached by interacting with a route, so the same
    // argument applies to the page each one starts from.
    ...INTERACTIVE_STATES.map((state) => state.path),
  ].filter((path) => !listed.has(path));

  expect(
    unlisted,
    'these routes are not in build/sitemap.xml — an unlisted stub scans nothing',
  ).toEqual([]);
});

test('every page template in the sitemap is scanned by some route', () => {
  // The companion to the membership test above, pointing the other way.
  // That one proves no listed route is a stub; this one proves ROUTES has
  // not fallen behind the site.
  //
  // ROUTES is deliberately a subset -- "one route per page template" -- and
  // until this test existed the subset was justified by prose alone. Nothing
  // read the build, so a comment asserting that /blog/authors/<name> renders
  // "the same blog list page as /blog" kept two templates out of the scan
  // indefinitely, and adding a page type to the site would do the same again
  // in silence: the suite would keep passing, one template less.
  //
  // Docusaurus writes the template onto the page's own wrapper as a class
  // pair -- `blog-wrapper blog-list-page`, `docs-wrapper docs-doc-page` --
  // alongside the `plugin-<name>` of the plugin that routed it. Those tokens
  // are the identity this groups by. Tokens that name the *instance* rather
  // than the template (`plugin-id-default`, `docs-version-current`,
  // `docs-doc-id-<id>`) are not in the allowlist, so every architecture
  // detail page folds onto one signature rather than becoming 20.
  //
  // Read off build/ rather than the running server: the signature is in the
  // server-rendered HTML, so this needs no browser and no navigation, which
  // is what lets it cover all of the sitemap instead of a sample.
  const templates = new Map();
  for (const path of sitemapPaths()) {
    const signature = templateSignature(path);
    if (!templates.has(signature)) templates.set(signature, path);
  }

  expect(
    templates.size,
    'no page templates parsed out of build/ — the markup Docusaurus stamps the template onto has changed shape',
  ).toBeGreaterThan(0);

  const scanned = new Set(ROUTES.map((route) => templateSignature(route.path)));
  const unscanned = [...templates]
    .filter(([signature]) => !scanned.has(signature))
    .map(([signature, example]) => `${signature} (e.g. ${example})`)
    .sort();

  expect(
    unscanned,
    'these page templates are in the sitemap but no route in ROUTES renders them — add one route per template',
  ).toEqual([]);
});

test('the scan is not vacuous', async ({ page }) => {
  await page.goto('/');
  await page.locator('main').first().waitFor();

  // A misconfigured tag list, a disabled-rule list that grew to cover
  // everything, or an AxeBuilder that silently stopped injecting would all
  // produce an empty violation list on every route and make this file assert
  // nothing. Injecting a control violation proves the engine is live and the
  // configured tags still select rules.
  await page.evaluate(() => {
    const img = document.createElement('img');
    img.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAAAAACw=');
    document.body.appendChild(img);
  });

  const results = await scanner(page).analyze();
  expect(results.violations.map((v) => v.id)).toContain('image-alt');
});
