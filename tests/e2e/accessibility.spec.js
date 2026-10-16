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
// rule sets. Routes are chosen to cover one instance of each distinct page
// template rather than every URL: the scan is the expensive part, and two
// architecture detail pages exercise identical markup.
//
// Pre-existing violations are recorded in KNOWN_VIOLATIONS below rather than
// suppressed globally, and the baseline retires itself: if a recorded entry
// stops being reported, this file fails and asks for the entry to be deleted.
// That is the same shape as the persist-credentials and timeout-minutes
// baselines in tests/ci-supply-chain.test.mjs, and it is what stops a
// temporary allowance from quietly becoming permanent.
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test, expect } from '../tools/e2e-coverage.cjs';

// React attaches its fiber to the DOM node it hydrates, so the presence of a
// `__react*` property is the signal that the element's handlers are live.
// Clicking a dialog trigger before that point silently discards the click and
// the scan below would analyse an unopened dialog. Same helper, and the same
// reason for it, as tests/e2e/interactions.spec.js and
// tests/e2e/community-people.spec.js.
async function waitForHydration(locator) {
  await locator.waitFor({ state: 'visible' });
  await locator.evaluate(async (element) => {
    const hydrated = (node) =>
      Object.keys(node).some((key) => key.startsWith('__react'));
    while (!hydrated(element)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
}

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
  { path: '/community/user-groups', label: 'generated doc category index' },
  { path: '/architectures', label: 'architecture catalog' },
  { path: '/architectures/adobe', label: 'architecture detail' },
  // /awards is a three-line "Awards moved" stub with unlisted: true; the page
  // that mounts <AwardsTimeline /> is docs/community/awards.md.
  { path: '/community/awards', label: 'awards timeline' },
  { path: '/metrics', label: 'metrics dashboard' },
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
// All three states scan clean as of this commit, so KNOWN_STATE_VIOLATIONS
// below is empty and these are regression guards rather than a baseline of
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

// The state counterpart of KNOWN_VIOLATIONS, keyed by state label, with the
// same self-retiring contract: an entry that stops being reported fails the
// retirement test below and has to be deleted.
const KNOWN_STATE_VIOLATIONS = {};

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Rules that cannot be evaluated meaningfully here, each with the reason it is
// off. Keep this list empty unless a rule is genuinely inapplicable — a rule
// that merely fails belongs in KNOWN_VIOLATIONS, which retires itself.
const DISABLED_RULES = Object.create(null);

// Violations that exist on the site today, keyed by route path. Each entry is
// an axe rule id. Deleting a fixed entry is required, not optional: the
// "records no violation that has been fixed" test below fails while a stale
// entry remains, so the baseline cannot outlive the bug it describes.
const KNOWN_VIOLATIONS = {};

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
  const sitemap = readFileSync(resolve('build/sitemap.xml'), 'utf8');
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

async function scan(page, path, mode = 'light') {
  await prepare(page, path, mode);

  return scanner(page).analyze();
}

// Drives one entry of INTERACTIVE_STATES to the state it describes and scans
// the document there. The state's own `open` asserts the new markup is
// present before this returns, so a scan that found nothing because the
// dialog never opened fails as a missing dialog rather than passing as a
// clean page.
async function scanState(page, state, mode = 'light') {
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
      const allowed = new Set(KNOWN_VIOLATIONS[route.path] ?? []);
      const unrecorded = results.violations.filter((v) => !allowed.has(v.id));

      expect(
        unrecorded.map(describe),
        `${route.path} reported WCAG violations that are not in KNOWN_VIOLATIONS`,
      ).toEqual([]);
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
      const allowed = new Set(KNOWN_STATE_VIOLATIONS[state.label] ?? []);
      const unrecorded = results.violations.filter((v) => !allowed.has(v.id));

      expect(
        unrecorded.map(describe),
        `${state.label} reported WCAG violations that are not in KNOWN_STATE_VIOLATIONS`,
      ).toEqual([]);
    });
  }
}

test('the state baseline records no violation that has been fixed', async ({
  page,
}) => {
  // One navigation, one interaction and one full-page scan per recorded
  // state, run serially in a single test.
  test.setTimeout(240_000);

  const byLabel = new Map(
    INTERACTIVE_STATES.map((state) => [state.label, state]),
  );
  const stale = [];

  for (const [label, ruleIds] of Object.entries(KNOWN_STATE_VIOLATIONS)) {
    const results = await scanState(page, byLabel.get(label));
    const reported = new Set(results.violations.map((v) => v.id));
    for (const ruleId of ruleIds) {
      if (!reported.has(ruleId)) stale.push(`${label}: ${ruleId}`);
    }
  }

  expect(
    stale,
    'these rules no longer fail — delete them from KNOWN_STATE_VIOLATIONS',
  ).toEqual([]);
});

test('every baselined state is a state this spec scans', () => {
  // The companion of the ROUTES check below: a KNOWN_STATE_VIOLATIONS key
  // that names no entry in INTERACTIVE_STATES would silence nothing, and the
  // retirement test above would throw on the undefined state rather than say
  // so.
  const scanned = new Set(INTERACTIVE_STATES.map((state) => state.label));
  const unknown = Object.keys(KNOWN_STATE_VIOLATIONS).filter(
    (label) => !scanned.has(label),
  );

  expect(
    unknown,
    'KNOWN_STATE_VIOLATIONS names states INTERACTIVE_STATES does not scan',
  ).toEqual([]);
});

test('the baseline records no violation that has been fixed', async ({
  page,
}) => {
  // One navigation and one full-page scan per recorded route, run serially in
  // a single test; the per-test default is not enough for that.
  test.setTimeout(240_000);

  const stale = [];

  for (const [path, ruleIds] of Object.entries(KNOWN_VIOLATIONS)) {
    const results = await scan(page, path);
    const reported = new Set(results.violations.map((v) => v.id));
    for (const ruleId of ruleIds) {
      if (!reported.has(ruleId)) stale.push(`${path}: ${ruleId}`);
    }
  }

  expect(
    stale,
    'these rules no longer fail — delete them from KNOWN_VIOLATIONS',
  ).toEqual([]);
});

test('every baselined route is a route this spec scans', () => {
  // A KNOWN_VIOLATIONS key that matches no entry in ROUTES would silence
  // nothing and go unnoticed, because the retirement test above would keep
  // scanning it and keep passing.
  const scanned = new Set(ROUTES.map((route) => route.path));
  const unknown = Object.keys(KNOWN_VIOLATIONS).filter(
    (path) => !scanned.has(path),
  );

  expect(unknown, 'KNOWN_VIOLATIONS names routes ROUTES does not scan').toEqual(
    [],
  );
});

test('every scanned route is a listed page of the built site', () => {
  // How /awards went unnoticed: it is an unlisted "Awards moved" stub, so the
  // route labelled "awards timeline" scanned three lines of redirect notice
  // and passed, while /community/awards -- the only page that mounts
  // <AwardsTimeline /> -- was never scanned at all. Every real page template
  // appears in the sitemap, and a stub excluded from it does not, so
  // membership is the check that separates the two.
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
