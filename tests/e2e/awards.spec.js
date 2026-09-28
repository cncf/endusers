// End-to-end coverage for the End User Awards timeline at /community/awards.
//
// smoke.spec.js already loads this route, but it asserts only that at least
// one year badge renders and that its text is four digits. Everything the
// page exists to show — the winner cards themselves, their citations, the
// mirrored logo images, and the outbound announcement/case-study/talk links —
// has never been exercised against the shipped build.
//
// src/components/AwardsTimeline reports full unit line and region coverage
// from tests/awards-timeline.test.mjs, but that drives the component through
// tests/tools/fake-dom.mjs. Two failure modes survive that:
//
//   * `logo` is resolved through @docusaurus/useBaseUrl and served out of
//     static/img/awards/, so a record naming a file that was never mirrored
//     renders an <img> that 404s. The fake DOM never issues the request.
//   * Winners are grouped into years by a Map built at render time and sorted
//     descending. Only a real render of the shipped data proves the page a
//     reader receives is ordered and complete.
//
// data/awards.json is hand-maintained and audited against an upstream page
// (see its verifiedAgainst field), so every case below is driven from that
// file rather than a hardcoded winner list: a newly added winner is covered on
// arrival instead of needing this spec edited.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const AWARDS_PATH = '/community/awards';

// Playwright transpiles these .js specs to CommonJS (the package is not
// "type": "module"), so import.meta is unavailable. Playwright runs from the
// directory holding playwright.config.js, so the data file is addressed from
// the project root.
const awardsData = JSON.parse(
  readFileSync(resolve('data/awards.json'), 'utf8'),
);
const awards = awardsData.awards;

// Years, newest first — the order AwardsTimeline sorts its groups into.
const years = [...new Set(awards.map((entry) => entry.year))].sort(
  (a, b) => b - a,
);

// An organization can win in more than one year (Spotify took the award in
// both 2021 and 2023), so a card is only uniquely addressable once the year
// group it belongs to has been selected. Groups render in `years` order, so
// the index into that list identifies the group without depending on the
// hashed CSS-module class names for anything but the group boundary itself.
function yearGroup(page, year) {
  return page.locator('[class*="yearGroup"]').nth(years.indexOf(year));
}

function cardFor(page, entry) {
  return yearGroup(page, entry.year)
    .locator('article')
    .filter({
      has: page.getByRole('heading', {
        level: 3,
        name: entry.organization,
        exact: true,
      }),
    });
}

// A guard on the fixture itself: if data/awards.json ever loads empty, the
// assertions below would silently degrade into checks over nothing and this
// file would pass while proving the page renders no winners at all.
test('the awards data exposes winners to cover', () => {
  expect(Array.isArray(awards)).toBe(true);
  expect(awards.length).toBeGreaterThan(0);
  // Cards are addressed by organization within a year group, so the data has
  // to keep that pair unique for the cases below to mean anything.
  const pairs = awards.map((entry) => `${entry.year}|${entry.organization}`);
  expect(new Set(pairs).size).toBe(pairs.length);
});

test.describe('awards timeline', () => {
  test('renders one descending year group per year in the data', async ({
    page,
  }) => {
    await page.goto(AWARDS_PATH);

    const expectedYears = years;

    const badges = page.locator('[class*="yearBadge"]');
    await expect(badges).toHaveCount(expectedYears.length);

    const rendered = (await badges.allTextContents()).map((text) =>
      Number(text.trim()),
    );
    expect(rendered).toEqual(expectedYears);
  });

  test('renders a card for every winner with its citation and event', async ({
    page,
  }) => {
    await page.goto(AWARDS_PATH);

    const timeline = page.locator('[class*="timeline"]').first();
    await expect(timeline.locator('article')).toHaveCount(awards.length);

    for (const entry of awards) {
      const card = cardFor(page, entry);
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(entry.awardLabel);
      await expect(card).toContainText(entry.citation);
      await expect(card).toContainText(entry.event);
    }
  });

  test('serves every winner logo the data declares', async ({ page }) => {
    const withLogos = awards.filter((entry) => entry.logo);
    // Guard: if the data ever stops declaring logos, the image assertions
    // below would pass over an empty set.
    expect(withLogos.length).toBeGreaterThan(0);

    const failed = [];
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failed.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto(AWARDS_PATH);

    const images = page.locator('[class*="timeline"] article img');
    await expect(images).toHaveCount(withLogos.length);

    // `loading="lazy"` means an image far down the timeline is not fetched
    // until it scrolls into view, so every card is brought into the viewport
    // before decoding is checked.
    await images.last().scrollIntoViewIfNeeded();

    const count = await images.count();
    for (let i = 0; i < count; i += 1) {
      const image = images.nth(i);
      await image.scrollIntoViewIfNeeded();
      await expect(image).toHaveAttribute('alt', /\S/);
      // naturalWidth stays 0 for an <img> whose source failed to decode, which
      // is how a missing or corrupt mirrored asset shows up in a browser.
      await expect
        .poll(() => image.evaluate((node) => node.naturalWidth))
        .toBeGreaterThan(0);
    }

    expect(failed).toEqual([]);
  });

  test('links each winner card to the destinations the data declares', async ({
    page,
  }) => {
    await page.goto(AWARDS_PATH);

    for (const entry of awards) {
      const card = cardFor(page, entry);

      // The logo is wrapped in a link to the announcement, falling back to the
      // talk when no announcement exists; a record with neither renders the
      // anchor with no href at all.
      const primaryUrl = entry.announcementUrl || entry.talkUrl;
      const logoLink = card.getByRole('link', {
        name: `${entry.organization} — ${entry.awardLabel}`,
      });
      if (primaryUrl) {
        await expect(logoLink).toHaveAttribute('href', primaryUrl);
      }

      for (const [name, url] of [
        ['Announcement', entry.announcementUrl],
        ['Case study', entry.caseStudyUrl],
        ['Watch the talk', entry.talkUrl],
      ]) {
        const link = card.getByRole('link', { name, exact: true });
        if (url) {
          await expect(link).toHaveAttribute('href', url);
          await expect(link).toHaveAttribute('rel', /noopener/);
          await expect(link).toHaveAttribute('target', '_blank');
        } else {
          await expect(link).toHaveCount(0);
        }
      }
    }
  });

  test('credits the upstream source the winner history was audited against', async ({
    page,
  }) => {
    // The note only renders when both fields are present, so the data decides
    // whether there is anything to assert.
    test.skip(
      !awardsData.verifiedAt || !awardsData.verifiedAgainst,
      'data/awards.json declares no verification provenance',
    );

    await page.goto(AWARDS_PATH);

    const note = page.getByText(
      /Winner history audited for completeness against/,
    );
    await expect(note).toBeVisible();

    await expect(
      note.getByRole('link', { name: 'contribute.cncf.io/community/awards' }),
    ).toHaveAttribute('href', awardsData.verifiedAgainst);
  });
});
