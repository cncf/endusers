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

// One route per page template.
//
// Routes that reuse a template already listed here are deliberately absent:
// /blog/authors/<name> and /blog/tags/<tag> render the same blog list page as
// /blog, and /community/user-groups/<group> renders the same doc page as
// /community/technical-advisory-board. Scanning them would cost time without
// covering new markup.
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
  { path: '/blog/tags', label: 'blog tags index' },
];

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Rules that cannot be evaluated meaningfully here, each with the reason it is
// off. Keep this list empty unless a rule is genuinely inapplicable — a rule
// that merely fails belongs in KNOWN_VIOLATIONS, which retires itself.
const DISABLED_RULES = Object.create(null);

// Violations that exist on the site today, keyed by route path. Each entry is
// an axe rule id. Deleting a fixed entry is required, not optional: the
// "records no violation that has been fixed" test below fails while a stale
// entry remains, so the baseline cannot outlive the bug it describes.
//
// The baseline is per-build because the data is. Under E2E_COVERAGE=1 the
// overlays in tests/e2e/fixtures/data/ put an archived group into
// data/community-groups.json so GroupLinkStatus renders the drift warning it
// exists to show (see tests/tools/e2e-data-fixtures.cjs). That warning's
// colour fails contrast — a real defect in
// src/components/GroupLinkStatus/styles.module.css, tracked in #964, which
// ships the moment CNCF archives a user-group repository. Recording it for
// the production build too would make the retirement test permanently stale
// there, since that build cannot render the element at all.
const KNOWN_VIOLATIONS =
  process.env.E2E_COVERAGE === '1' ? { '/community': ['color-contrast'] } : {};

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

async function scan(page, path, mode = 'light') {
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
  const sitemap = readFileSync(resolve('build/sitemap.xml'), 'utf8');
  const listed = new Set(
    [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => {
      const path = new URL(loc).pathname.replace(/\/$/, '');
      return path === '' ? '/' : path;
    }),
  );

  expect(
    listed.size,
    'no routes parsed out of build/sitemap.xml',
  ).toBeGreaterThan(0);

  const unlisted = ROUTES.map((route) => route.path).filter(
    (path) => !listed.has(path),
  );

  expect(
    unlisted,
    'these routes are not in build/sitemap.xml — an unlisted stub scans nothing',
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
