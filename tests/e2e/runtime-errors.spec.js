// End-to-end coverage for the one failure mode every other spec is blind to:
// a page that throws in the browser.
//
// Docusaurus server-renders every route, so the markup a spec queries is
// already in the DOM before React runs. When hydration fails, React logs a
// recoverable error, throws away the server HTML for the offending subtree and
// re-renders it on the client. Nothing the existing specs assert changes: the
// headings, links and tables are all still there, so every content assertion
// keeps passing while the page quietly stops being the page that was shipped.
// A component that fails to hydrate also stops responding to input, which is
// invisible to any spec that only reads text.
//
// The unit suite cannot reach this either. It renders components through
// tests/tools/react-element-tree.mjs, a synthetic element tree rather than a
// real DOM, so there is no server render for a client render to disagree with.
// Hydration is structurally outside what it can observe, no matter how high its
// coverage goes.
//
// Before this file, `grep -rn "pageerror" tests/e2e` found nothing: no spec had
// ever attached an error listener. architecture-detail.spec.js watches
// `response` for subresource statuses >= 400, but only on the architecture
// detail routes and only for network failures, never for script errors.
//
// Every route is taken from build/sitemap.xml rather than a hardcoded list, so
// a newly published page is covered on arrival instead of needing this file
// edited. The sitemap is also exactly the right source: it is the set of pages
// the site asks crawlers and readers to visit.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '../tools/e2e-coverage.cjs';

// Playwright transpiles these .js specs to CommonJS (the package is not
// "type": "module"), so import.meta is not available here. Playwright resolves
// testDir against the directory holding playwright.config.js and runs from the
// project root, so the build output is addressed from there.
const SITEMAP = resolve('build/sitemap.xml');

// React hydrates after load, and a mismatch surfaces only once it has. Nothing
// signals completion, so the wait is a fixed grace period; 2s was enough to
// surface prior hydration mismatches on every observed run.
const HYDRATION_GRACE_MS = 2_000;

function sitemapPaths() {
  let xml;
  try {
    xml = readFileSync(SITEMAP, 'utf8');
  } catch (error) {
    // `playwright test --list` loads every spec file to enumerate its tests,
    // including from contexts that never ran `npm run build:production`
    // (e.g. the unit-test job). Returning no routes there is correct: the
    // sitemap guard below still fails loudly the moment this spec actually
    // runs against a real build and the file is genuinely missing.
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    ([, loc]) => new URL(loc).pathname,
  );
}

const paths = sitemapPaths();

// Routes whose runtime error is a known, separately filed defect. Each entry
// is asserted to *still* fail, so the annotation cannot outlive the bug: once
// the defect is fixed the route stops erroring, the expected failure passes
// unexpectedly, Playwright reports that as a failure and this entry has to be
// deleted.
const KNOWN_FAILURES = new Map([
  // cncf/endusers#891 (the /metrics/ SVG-title hydration mismatch) was fixed
  // and closed; no entries remain. Add new ones here only alongside a filed,
  // open defect — see the contract above.
]);

// A guard on the fixture itself: if the sitemap ever fails to parse, the
// generated cases below would silently become zero tests and this file would
// pass while asserting nothing.
test('the sitemap exposes routes to cover', () => {
  expect(paths.length).toBeGreaterThan(0);
});

// And a guard on the annotation list, so an entry that no longer names a real
// route cannot sit here suppressing nothing.
test('every known-failure entry names a sitemap route', () => {
  for (const path of KNOWN_FAILURES.keys()) {
    expect(paths, `${path} should still be published`).toContain(path);
  }
});

test.describe('built routes run without errors', () => {
  for (const path of paths) {
    const known = KNOWN_FAILURES.get(path);

    test(`${path} raises no uncaught or recoverable error`, async ({
      page,
    }) => {
      if (known) {
        test.fail(true, known);
      }

      const errors = [];

      // An exception that escapes to the window: a component that threw during
      // render, or a bundle that failed to evaluate.
      page.on('pageerror', (error) => {
        errors.push(`uncaught ${error.message}`);
      });

      // React's hydration failures do not reach 'pageerror'. Docusaurus routes
      // them through its root onRecoverableError handler, which reports them as
      // a console error and nothing else.
      page.on('console', (message) => {
        if (message.type() === 'error') {
          errors.push(`console ${message.text()}`);
        }
      });

      const response = await page.goto(path);

      // A route the sitemap advertises has to be served. `docusaurus serve`
      // answers an unknown path with the 404 page, which renders cleanly and
      // would otherwise satisfy the error assertion below.
      expect(response?.status(), `${path} should not 404`).toBeLessThan(400);
      await expect(
        page.getByRole('heading', { name: 'Page Not Found' }),
      ).toHaveCount(0);

      // Hydration is scheduled after load, so the listeners need a beat to see
      // an error raised by it rather than by the initial script evaluation.
      // There is no event to wait for here: the assertion is that nothing
      // arrives, which can only be established by giving it time to.
      await page.waitForLoadState('load');
      await page.waitForTimeout(HYDRATION_GRACE_MS);

      expect(errors, `${path} should raise no runtime error`).toEqual([]);
    });
  }
});
