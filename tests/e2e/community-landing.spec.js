// End-to-end coverage for the community landing page's section-card grid
// (docs/community/index.md, served at `/community`).
//
// The grid is the only way into Get Involved, the Technical Advisory Board,
// User Groups, Awards, the End User Directory and Projects from End Users
// from the section's own front door, and it is hand-authored JSX inside an MDX
// document: six `.pillar` cards, each a <h3><Link to="…"> plus a descriptive
// paragraph.
//
// Nothing asserts it today. Three specs load `/community` already —
// tests/e2e/accessibility.spec.js scans it with axe,
// tests/e2e/footer.spec.js exercises the footer rendered around it, and
// tests/e2e/group-link-status-variant.spec.js drives the <GroupLinkStatus />
// banner above it — but none of them reads the cards. On the unit side
// the link-hygiene lint rules in eslint.config.mjs cover `src/` only, so they
// never see this file, and tests/docs-contract.test.mjs reads frontmatter rather than body
// markup.
//
// The sibling grids are both covered — `/` by
// tests/e2e/practitioners-home.spec.js and `/resources` by
// tests/e2e/docs-routes.spec.js — and this one is not, which is what this
// spec closes. `onBrokenLinks: 'throw'` catches a `to` that points nowhere,
// but not a card that silently stops rendering: an MDX edit that drops a
// `</div>`, a component import that throws during hydration, or a route that
// is renamed in the sidebar and updated here to a page that builds but no
// longer carries the section. Each of those leaves the build green and the
// section front door empty.
import { test, expect } from '../tools/e2e-coverage.cjs';

const COMMUNITY_PATH = '/community';

// The cards in document order, as a visitor reads them. Restated here rather
// than parsed out of the Markdown so that an unintended edit to
// docs/community/index.md fails rather than being mirrored into the
// expectation.
const CARDS = [
  { label: 'Get Involved', to: '/community/get-involved' },
  {
    label: 'Technical Advisory Board',
    to: '/community/technical-advisory-board',
  },
  { label: 'User Groups', to: '/community/user-groups' },
  { label: 'Awards', to: '/community/awards' },
  { label: 'End User Directory', to: '/community/members' },
  { label: 'Projects from End Users', to: '/community/projects-born' },
];

function normalise(pathname) {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

function article(page) {
  return page.locator('article').first();
}

async function expectNotNotFound(page) {
  await expect(
    page.getByRole('heading', { name: 'Page Not Found' }),
  ).toHaveCount(0);
}

test.describe('community landing page', () => {
  test('renders every section card with a description', async ({ page }) => {
    const response = await page.goto(COMMUNITY_PATH);

    // `docusaurus serve` answers an unknown path with the 404 page, so the
    // status alone is not conclusive; both are asserted.
    expect(response?.status(), `${COMMUNITY_PATH} should not 404`).toBeLessThan(
      400,
    );
    await expectNotNotFound(page);

    const cards = article(page).locator('.pillars > .pillar');
    await expect(cards).toHaveCount(CARDS.length);

    for (const [index, { label }] of CARDS.entries()) {
      const card = cards.nth(index);
      await expect(card.locator('h3')).toHaveText(label);
      // Each card carries a full description; an empty paragraph is the shape
      // a truncated MDX edit leaves behind, and the reason the grid replaced
      // the DocCardList that showed only a frontmatter line.
      await expect(card.locator('p')).not.toBeEmpty();
    }
  });

  for (const { label, to } of CARDS) {
    test(`the "${label}" card opens ${to}`, async ({ page }) => {
      await page.goto(COMMUNITY_PATH);

      // Located by role and name rather than by the `pillar` class: the class
      // is presentation, the link is the contract.
      const link = article(page).getByRole('link', {
        name: label,
        exact: true,
      });
      await expect(link).toBeVisible();

      await link.click();

      expect(normalise(new URL(page.url()).pathname)).toBe(normalise(to));
      await expectNotNotFound(page);
      await expect(article(page)).toBeVisible();
    });
  }
});
