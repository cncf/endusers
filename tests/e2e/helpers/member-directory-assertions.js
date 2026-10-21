// The assertion every member-directory freshness spec makes about the page
// *around* the provenance note.
//
// Each of those specs proves something the note does not do on a fixture
// build -- a sentence dropped, a link rendered as text, the note absent
// altogether -- and each of those is an assertion that something is missing.
// An assertion that a page lacks a sentence passes just as well when the
// route 404s, the build lost the page, or the selector stopped matching, so
// each spec pairs it with evidence that the directory itself still rendered.
//
// That evidence was the same twelve lines in all three specs, which is the
// copy `npm run check:duplication` exists to stop: a third copy pushed the
// repository over its clone ceiling. It lives here instead -- a plain module
// in a subdirectory of tests/e2e/, which keeps it out of three listings at
// once. Playwright's default testMatch collects only *.spec.js, so it is not
// run as a test; `registers every file in testDir as a spec` in
// tests/playwright-config.test.mjs lists files directly in tests/e2e and so
// does not demand it be renamed; and the unit coverage file-set in
// tests/tools/coverage-report.mjs enumerates scripts/, src/, tests/tools/ and
// tests/helpers*.mjs, none of which this is, so it carries no coverage floor
// that no unit test could ever satisfy.
//
// `expect` is taken as an argument rather than imported so this module stays
// out of the fixture graph in tests/tools/e2e-coverage.cjs: the specs already
// import the coverage-aware `test`/`expect` pair from there, and a second
// import path for `expect` is how a spec ends up asserting through a
// different instance than the one its fixtures were built from.

/** The accessible name of the member directory region on /community/members. */
const DIRECTORY_REGION = 'End User Community organization directory';

/**
 * Asserts the member directory rendered its cards on the page as loaded.
 *
 * @param {import('@playwright/test').Page} page the page under test
 * @param {import('@playwright/test').Expect} expect the spec's `expect`
 * @returns {Promise<void>}
 */
export async function expectDirectoryIntact(page, expect) {
  const section = page.getByRole('region', { name: DIRECTORY_REGION });
  await expect(
    section.getByRole('button', { name: /^Open .+ profile$/ }).first(),
  ).toBeVisible();
}
