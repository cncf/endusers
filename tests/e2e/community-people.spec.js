// End-to-end smoke coverage for the TAB roster route (see smoke.spec.js for
// the four routes already covered). /community/technical-advisory-board is
// the only page that renders src/components/CommunityPeople and
// src/components/PeopleFreshness, and no spec loaded it before this one.
//
// Both components report 100% unit line and region coverage, but that comes
// from tests/tools/fake-dom.mjs driving them directly — it never hydrates the
// shipped bundle. The roster is also rebuilt on a schedule from
// data/community-people.json by `npm run fetch:community-people`, so it can go
// blank with no source change at all. These cases assert only that it renders.
//
// The PersonDialog lightbox and src/components/hooks/useFocusTrap.js are
// deliberately left to tests/e2e/interactions.spec.js.
import { test, expect } from '../tools/e2e-coverage.cjs';

const TAB_PATH = '/community/technical-advisory-board';

test.describe('TAB roster', () => {
  test('renders member cards with a name and a role', async ({ page }) => {
    await page.goto(TAB_PATH);

    const heading = page.getByRole('heading', { name: 'TAB members' });
    await expect(heading).toBeVisible();

    // Each PersonCard is an <article> whose only trigger is the image button
    // labelled "Open <name> profile"; counting those counts rendered people
    // without depending on a CSS-module class name.
    const cards = page.getByRole('button', { name: /^Open .+ profile$/ });
    expect(await cards.count()).toBeGreaterThan(0);

    const firstName = await page
      .locator('article')
      .filter({ has: cards.first() })
      .locator('h4')
      .first()
      .textContent();
    expect(firstName?.trim()).not.toBe('');

    const firstRole = await page
      .locator('article')
      .filter({ has: cards.first() })
      .locator('p')
      .first()
      .textContent();
    expect(firstRole?.trim()).not.toBe('');
  });

  test('renders a portrait describing the person it belongs to', async ({
    page,
  }) => {
    await page.goto(TAB_PATH);

    const portrait = page
      .getByRole('button', { name: /^Open .+ profile$/ })
      .first()
      .locator('img');
    await expect(portrait).toBeVisible();

    // Asserted from the attributes rather than from naturalWidth: the portrait
    // src is an upstream URL, and a spec that waits for it to decode would be
    // testing a third party's availability rather than this site's markup.
    expect((await portrait.getAttribute('src'))?.trim()).toBeTruthy();
    expect((await portrait.getAttribute('alt'))?.trim()).toBeTruthy();
  });

  test('renders the profile freshness note', async ({ page }) => {
    await page.goto(TAB_PATH);

    await expect(
      page.getByText(/Profiles last refreshed from public GitHub sources on /),
    ).toBeVisible();
  });
});
