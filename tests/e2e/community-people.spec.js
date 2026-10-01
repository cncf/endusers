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
// The PersonDialog lightbox below was previously left to
// tests/e2e/interactions.spec.js, but that spec drives the MemberDirectory's
// MemberProfile dialog on /community/members — a different component. The CI
// e2e coverage report therefore showed src/components/CommunityPeople/index.js
// at 33.80% line coverage, with PersonDialog (lines 7-92) and the
// `open && <PersonDialog .../>` arm of PersonCard (lines 123-130) never
// executed in a browser at all.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '../tools/e2e-coverage.cjs';

const TAB_PATH = '/community/technical-advisory-board';

// Playwright transpiles these .js specs to CommonJS (the package is not
// "type": "module"), so import.meta is unavailable. Playwright runs from the
// directory holding playwright.config.js, so the data file is addressed from
// the project root.
const peopleData = JSON.parse(
  readFileSync(resolve('data/community-people.json'), 'utf8'),
);
const tabPeople = peopleData.people.tab || [];

// The roster is regenerated on a schedule by `npm run fetch:community-people`,
// so which person happens to carry a bio, a location or a given profile link
// changes without any source edit. Every dialog case is therefore addressed by
// a person selected from the data at run time rather than by name.
const withBio = tabPeople.find((person) => person.bio);
const withoutBio = tabPeople.find((person) => !person.bio);

// React attaches its fiber to the DOM node it hydrates, so the presence of a
// `__react*` property is the signal that the element's handlers are live.
// Clicking before that point silently discards the input.
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

async function openProfile(page, name) {
  await page.goto(TAB_PATH);
  const trigger = name
    ? page.getByRole('button', { name: `Open ${name} profile` })
    : page.getByRole('button', { name: /^Open .+ profile$/ }).first();
  await waitForHydration(trigger);
  const triggerName = await trigger.getAttribute('aria-label');
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return { dialog, trigger, triggerName };
}

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

test.describe('TAB roster profile dialog', () => {
  test('opens a labelled modal focused on its close button', async ({
    page,
  }) => {
    const { dialog } = await openProfile(page);

    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('aria-labelledby', 'profile-name');

    // PersonDialog labels itself with the <h3 id="profile-name"> holding the
    // person's name, so a non-empty heading proves both the wiring and that a
    // name was rendered.
    const heading = dialog.locator('#profile-name');
    await expect(heading).toHaveCount(1);
    await expect(heading).toBeVisible();
    expect((await heading.textContent())?.trim()).not.toBe('');

    // useFocusTrap moves focus to the close button on mount.
    await expect(
      dialog.getByRole('button', { name: /^Close .+ profile$/ }),
    ).toBeFocused();

    await expect(
      dialog.getByText('Profile details refreshed from public sources'),
    ).toHaveCount(1);
  });

  test('renders the person the opened card belongs to', async ({ page }) => {
    const first = tabPeople[0];
    test.skip(!first, 'data/community-people.json defines no TAB people');

    const { dialog } = await openProfile(page, first.name);

    expect((await dialog.locator('#profile-name').textContent())?.trim()).toBe(
      first.name,
    );
    await expect(dialog.getByText('CNCF end-user community')).toHaveCount(1);
    // PersonDialog joins role and company with a middle dot and falls back to
    // "Community member" when it has neither.
    const subtitle = [first.role, first.company].filter(Boolean).join(' · ');
    await expect(
      dialog.getByText(subtitle || 'Community member', { exact: true }),
    ).toHaveCount(1);
  });

  test('clicking the close button closes it and restores focus', async ({
    page,
  }) => {
    const { dialog, triggerName } = await openProfile(page);

    await dialog.getByRole('button', { name: /^Close .+ profile$/ }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: triggerName })).toBeFocused();
  });

  test('clicking the backdrop closes the dialog', async ({ page }) => {
    const { dialog } = await openProfile(page);

    // The backdrop only closes on a mousedown whose target is the backdrop
    // itself, so click its top-left corner, well clear of the dialog box.
    await page.mouse.click(5, 5);

    await expect(dialog).toHaveCount(0);
  });

  test('Escape closes the dialog and restores focus to the card', async ({
    page,
  }) => {
    const { dialog, triggerName } = await openProfile(page);

    await page.keyboard.press('Escape');

    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: triggerName })).toBeFocused();
  });

  test('traps Tab inside the dialog', async ({ page }) => {
    const { dialog } = await openProfile(page);

    // Tabbing past the last focusable element wraps back into the dialog
    // instead of escaping to the roster behind it.
    const focusable = await dialog.locator('button, a[href]').count();
    for (let index = 0; index < focusable + 1; index += 1) {
      await page.keyboard.press('Tab');
    }

    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"]')),
        ),
      )
      .toBe(true);
  });

  test('offers only absolute external profile links', async ({ page }) => {
    const { dialog } = await openProfile(page);

    const links = dialog.locator('a[href]');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const link = links.nth(index);
      // profileUrl()/websiteUrl() only ever yield absolute https URLs, and
      // every rendered link opens in a new tab without leaking a referrer.
      expect(await link.getAttribute('href')).toMatch(/^https:\/\//);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noreferrer');
      expect(['GitHub', 'LinkedIn', 'Twitter', 'Website']).toContain(
        (await link.textContent())?.replace('↗', '').trim(),
      );
    }
  });

  test('drops the links a person has no handle for', async ({ page }) => {
    const sparse = tabPeople.find(
      (person) =>
        !person.linkedin || !person.twitter || !person.blog || !person.github,
    );
    test.skip(!sparse, 'every TAB person currently carries every handle');

    const { dialog } = await openProfile(page, sparse.name);

    // The links array is filtered on href, so a missing handle renders no
    // anchor at all rather than a dead one.
    const labels = await dialog.locator('a[href]').allTextContents();
    const rendered = labels.map((label) => label.replace('↗', '').trim());
    for (const [label, handle] of [
      ['GitHub', sparse.github],
      ['LinkedIn', sparse.linkedin],
      ['Twitter', sparse.twitter],
      ['Website', sparse.blog],
    ]) {
      if (!handle) expect(rendered).not.toContain(label);
    }
  });

  test('renders the bio of a person who has one', async ({ page }) => {
    test.skip(!withBio, 'no TAB person currently carries a bio');

    const { dialog } = await openProfile(page, withBio.name);

    await expect(dialog.getByText(withBio.bio, { exact: false })).toHaveCount(
      1,
    );
    await expect(
      dialog.getByText('Public profile details are limited'),
    ).toHaveCount(0);
  });

  test('falls back to the limited-details note without a bio', async ({
    page,
  }) => {
    test.skip(!withoutBio, 'every TAB person currently carries a bio');

    const { dialog } = await openProfile(page, withoutBio.name);

    await expect(
      dialog.getByText(
        `Public profile details are limited. Use the links below to learn more about ${withoutBio.name}.`,
      ),
    ).toHaveCount(1);
  });

  test('shows a location only for a person who has one', async ({ page }) => {
    const located = tabPeople.find((person) => person.location);
    const unlocated = tabPeople.find((person) => !person.location);
    test.skip(!located || !unlocated, 'the roster has no contrasting pair');

    const { dialog } = await openProfile(page, located.name);
    await expect(
      dialog.getByText(located.location, { exact: true }),
    ).toHaveCount(1);

    const withoutLocation = await openProfile(page, unlocated.name);
    await expect(
      withoutLocation.dialog.getByText(located.location, { exact: true }),
    ).toHaveCount(0);
  });
});
