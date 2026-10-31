// End-to-end coverage for the slides and recording links a talk card on the
// KubeCon NA 2026 page carries once they are curated.
//
// `<EndUserTalkSchedule />` renders those links from `slides` and `recording`
// on each talk in data/end-user-talks.json, which the collector fills from
// data/end-user-talk-links.json. Nothing has been published yet, so against
// `npm run build:production` neither arm is reachable and the file is skipped.
// The E2E_COVERAGE=1 build appends a fixture day
// (tests/e2e/fixtures/data/end-user-talks.json) whose two talks hold both
// arms open: one with slides and a recording and no abstract, one with a
// recording alone and a two-paragraph abstract.
//
// What this proves that tests/end-user-talk-schedule.test.mjs cannot is that
// the links reach the served document as anchors a reader can follow, that
// the per-talk title lands in the computed accessible name, and that
// a talk with no abstract renders no empty toggle. The hrefs are asserted as
// rendered attributes only, so the suite requests neither host.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';

const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

const EVENTS_PATH = '/events/2026/kubecon-na/';

// Addressed through the overlay rather than by hard-coded strings so a
// renamed fixture fails here instead of silently passing on the real data.
const talks = loadSiteData('end-user-talks.json').days.flatMap((day) =>
  day.slots.flatMap((slot) => slot.talks),
);
const bothLinks = talks.find((talk) => talk.slides && talk.recording);
const recordingOnly = talks.find(
  (talk) => talk.recording && !talk.slides && talk.description,
);

function cardFor(page, talk) {
  return page.locator('article').locator('li', {
    has: page.locator(`a[href="${talk.url}"]`),
  });
}

describeCoverage('end user talk slides and recording links', () => {
  test('a talk with slides and a recording links both, named for the talk', async ({
    page,
  }) => {
    expect(bothLinks).toBeDefined();
    await page.goto(EVENTS_PATH);

    const card = cardFor(page, bothLinks);
    await expect(card).toHaveCount(1);

    // The visible label is the short "Slides" / "Recording (YouTube)"; the
    // accessible name appends the talk title so a screen reader's link list
    // does not read the same two labels eighty times over.
    const slides = card.getByRole('link', {
      name: `Slides: ${bothLinks.title}`,
    });
    await expect(slides).toHaveAttribute('href', bothLinks.slides);
    await expect(slides).toHaveAttribute('rel', 'noreferrer');
    const recording = card.getByRole('link', {
      name: `Recording (YouTube): ${bothLinks.title}`,
    });
    await expect(recording).toHaveAttribute('href', bothLinks.recording);
    await expect(recording).toHaveAttribute('rel', 'noreferrer');

    // No abstract means no toggle, rather than a toggle that opens on nothing.
    expect(bothLinks.description).toBe('');
    await expect(card.locator('details')).toHaveCount(0);
  });

  test('a talk with a recording alone renders no slides link beside its abstract', async ({
    page,
  }) => {
    expect(recordingOnly).toBeDefined();
    await page.goto(EVENTS_PATH);

    const card = cardFor(page, recordingOnly);
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('link', { name: /^Slides/ })).toHaveCount(0);
    await expect(
      card.getByRole('link', {
        name: `Recording (YouTube): ${recordingOnly.title}`,
      }),
    ).toHaveAttribute('href', recordingOnly.recording);

    const abstract = card.locator('details');
    await expect(abstract).toHaveCount(1);
    await expect(abstract.locator('p')).toHaveCount(
      recordingOnly.description.split(/\n\s*\n/).length,
    );
  });
});
