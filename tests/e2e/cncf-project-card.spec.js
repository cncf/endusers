// End-to-end coverage for the one <CNCFProjectCard> prop shape no generated
// architecture page produces.
//
// CNCFProjectCard renders its meta row behind `(since || version)`
// (src/components/CNCFProjectCard/index.js line 29). The component is rendered
// only from the committed MDX under docs/architectures/, and every one of
// those cards carries `since` with `version`, `since` alone, or neither --
// never `version` alone. The overlays in tests/tools/e2e-data-fixtures.cjs
// cannot supply the missing shape either: they patch data/*.json, and these
// pages are generated files, not documents assembled at build time.
//
// So the shape gets a page of its own. docusaurus.config.js registers a second
// docs instance over tests/e2e/fixtures/docs/** when E2E_COVERAGE=1, serving
// the fixture below the route asserted here. Like the data overlays it exists
// in the coverage build only -- `npm run build:production`, the gating
// "End-to-end tests" job and the deployed site never compile it -- which is why
// the whole file is skipped outside the coverage run, where the route 404s.
//
// The card is asserted from both ends: the version is shown, and "Since" is
// absent. Asserting only the version would pass against a card that rendered
// both, which is the shape the real pages already cover. The fixture card is
// named so that neither its name nor its description contains the substring
// "Since", or the negative assertion could never hold.
//
// The fixture page carries a second card, with `since` and no `version`, and
// the pairing is what makes the `||` in that guard measurable rather than a
// second copy of a shape the architecture pages already render. Docusaurus
// gives each docs page its own chunk, so the browser reports one set of V8
// ranges per page, and V8 emits a range for the `version` operand only when
// its count differs from the count of the surrounding render. Every production
// page is uniform -- adobe.md, zeiss.md, allianz.md, flipkart-chaos-
// engineering.md and both swisscom pages give every card a `since`, so
// `version` is never evaluated and the operand is reported zero;
// cern-scientific-computing.md and colopl.md give no card a `since`, so
// `version` is always evaluated and no range is emitted for it at all. Only a
// page that renders both shapes evaluates the operand for one card and not the
// other, which is what reports it as reached.
import { test, expect } from '../tools/e2e-coverage.cjs';

const FIXTURE_ROUTE = '/e2e-coverage-fixtures/cncf-project-card';

const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

describeCoverage('CNCFProjectCard meta row', () => {
  test('renders a version with no adoption year', async ({ page }) => {
    const response = await page.goto(FIXTURE_ROUTE);
    expect(response?.status()).toBe(200);

    const card = page.getByRole('link', { name: /Versioned Fixture Project/ });
    await expect(card).toHaveCount(1);

    // The meta row is the only place either value is printed, so scoping to
    // the card is enough to make these assertions about that row.
    await expect(card).toContainText('v1.2.3');
    await expect(card).not.toContainText('Since');
  });

  test('renders an adoption year with no version', async ({ page }) => {
    const response = await page.goto(FIXTURE_ROUTE);
    expect(response?.status()).toBe(200);

    const card = page.getByRole('link', { name: /Adopted Fixture Project/ });
    await expect(card).toHaveCount(1);

    await expect(card).toContainText('Since 2021');
    // The version-only card's value is the one string that would show this
    // card had picked up the wrong props, so it is the useful negative.
    await expect(card).not.toContainText('v1.2.3');
  });

  test('the two cards render different halves of the meta row', async ({
    page,
  }) => {
    await page.goto(FIXTURE_ROUTE);

    // Both cards must be on the one page: the `||` operand is only reported as
    // reached when a single chunk renders a card that evaluates `version` and
    // a card that short-circuits before it. Splitting them across two fixture
    // pages would restore the uniform shape every production page already has.
    await expect(
      page.locator('article a[href*="cncf.io/projects/"]'),
    ).toHaveCount(2);
  });
});
