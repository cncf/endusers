// End-to-end coverage for the KubeCon NA 2026 end user talk schedule that
// `<EndUserTalkSchedule />` renders into /events.
//
// The component reports 100.00% lines and 100.00% regions in the browser
// coverage report, but that number is incidental: tests/e2e/events.spec.js
// predates the component (it was added with the schedule in #1369) and
// asserts only the page's Markdown-sourced headings, hero photo, figcaption
// link and outbound hosts. Loading /events for any of those executes every
// line of the component, so the schedule is *executed* by the suite without a
// single assertion being made about what it produced. A regression here keeps
// the coverage number at 100% while the page shows the reader nothing.
//
// tests/end-user-talk-schedule.test.mjs is a thorough unit contract, but it
// calls `EndUserTalkSchedule()` and walks the returned React element tree
// through tests/tools/react-element-tree.mjs. Three failure modes survive
// that, in the same way awards.spec.js records for AwardsTimeline:
//
//   * The component is imported into docs/events/index.md as MDX. The element
//     tree proves what the function returns; it cannot prove MDX compiled the
//     import and mounted it, so a build or theme regression can leave /events
//     serving its Markdown sections with the schedule silently absent.
//   * The day navigation is a row of in-page `#<day.id>` anchors pointing at
//     `<h5 id={day.id}>` headings. The unit test matches those hrefs against
//     ids in the element tree. Only the built document proves the ids survive
//     into the DOM Docusaurus serves and that each anchor therefore resolves
//     to a real target rather than scrolling nowhere.
//   * Every talk card carries an outbound link to the official schedule, and
//     the provenance line links the Sessionize API and the live schedule.
//     Those hrefs are asserted here as rendered attributes only — never
//     requested — so this spec makes no third-party traffic from CI.
//
// Every expectation is derived from data/end-user-talks.json
// rather than hardcoded, the way awards.spec.js drives itself from
// data/awards.json: re-running `npm run collect:end-user-talks` is covered on
// arrival instead of needing this spec rewritten.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';

const EVENTS_PATH = '/events/';

// Read through loadSiteData so this spec describes whichever build it is
// running against, as CONTRIBUTING.md asks of specs that assert on data files.
const schedule = loadSiteData('end-user-talks.json');
const days = schedule.days ?? [];
const talks = days.flatMap((day) =>
  (day.slots ?? []).flatMap((slot) => slot.talks ?? []),
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function gotoEvents(page) {
  const response = await page.goto(EVENTS_PATH);

  // `docusaurus serve` answers an unknown path with the 404 page, so the
  // status alone is not conclusive; both are asserted.
  expect(response?.status(), `${EVENTS_PATH} should not 404`).toBeLessThan(400);
  await expect(
    page.getByRole('heading', { name: 'Page Not Found' }),
  ).toHaveCount(0);

  return response;
}

// The navigation's aria-label is the component's own stable handle on itself:
// the CSS-module class names are build-hashed and the headings it emits are
// indistinguishable from the page's Markdown ones by role alone.
function dayNav(page) {
  return page.getByRole('navigation', { name: 'End user talk days' });
}

// A guard on the fixture itself. Without it every assertion below would
// degrade into a check over an empty list and this file would pass while
// proving the schedule renders nothing at all.
test('the end user talks data exposes a schedule to cover', () => {
  expect(Array.isArray(days)).toBe(true);
  expect(days.length).toBeGreaterThan(0);
  expect(talks.length).toBeGreaterThan(0);
  expect(talks.length).toBe(schedule.talkCount);
});

test.describe('end user talk schedule on /events', () => {
  test('mounts under the "End user talks" heading with its summary', async ({
    page,
  }) => {
    await gotoEvents(page);

    // The MDX import is what this proves: the component sits inside the
    // article the docs plugin renders, not merely somewhere on the page.
    const nav = page.locator('article').locator(dayNav(page));
    await expect(nav).toBeVisible();

    // The summary sentence states the session count and the timezone the
    // times below are in. A reader who misreads either misses talks, so both
    // are asserted against the data rather than against prose.
    const article = page.locator('article');
    await expect(
      article.getByText(`${schedule.talkCount} sessions in`, { exact: false }),
    ).toBeVisible();
    await expect(
      article.getByText(schedule.timezone, { exact: false }).first(),
    ).toBeVisible();
  });

  test('renders one jump link per day, each resolving to a real section', async ({
    page,
  }) => {
    await gotoEvents(page);

    const nav = dayNav(page);
    const hrefs = await nav.getByRole('link').evaluateAll((anchors) =>
      anchors.map((anchor) => ({
        href: anchor.getAttribute('href'),
        text: anchor.textContent.trim(),
      })),
    );

    expect(
      hrefs,
      'the day navigation does not list exactly the days in the data',
    ).toEqual(days.map((day) => ({ href: `#${day.id}`, text: day.label })));

    // An in-page anchor that names no element scrolls nowhere, and nothing
    // about the anchor itself reveals that. Each target is resolved in the
    // served document, which is the half the unit test cannot reach.
    for (const day of days) {
      const target = page.locator(`[id="${day.id}"]`);
      await expect(
        target,
        `the day navigation points at #${day.id}, which no element in the page carries`,
      ).toHaveCount(1);
      await expect(target).toHaveText(new RegExp(escapeRegExp(day.label)));
    }
  });

  test('renders every talk in the corpus with its speakers and room', async ({
    page,
  }) => {
    await gotoEvents(page);

    // Collected in one browser round trip rather than per talk: the corpus is
    // 80+ sessions, and a locator assertion each would dominate the suite's
    // wall time without testing anything the single read does not.
    const rendered = await page
      .locator('article')
      .locator('[class*="card"]')
      .evaluateAll((cards) =>
        cards.map((card) => ({
          title:
            card.querySelector('[class*="title"] a')?.textContent.trim() ??
            null,
          url:
            card.querySelector('[class*="title"] a')?.getAttribute('href') ??
            null,
          speakers:
            card.querySelector('[class*="speakers"]')?.textContent.trim() ??
            null,
          room:
            card.querySelector('[class*="location"] p')?.textContent.trim() ??
            null,
        })),
      );

    expect(
      rendered.length,
      'the page renders a different number of talk cards than the data holds',
    ).toBe(talks.length);

    // Order matters: the schedule is grouped by day and then by start time, so
    // a reader scanning down the page is reading a timeline. Comparing the
    // whole list in corpus order asserts the grouping survived the build.
    expect(rendered).toEqual(
      talks.map((talk) => ({
        title: talk.title,
        url: talk.url,
        speakers: talk.speakers,
        room: talk.room,
      })),
    );
  });

  test('renders each slot as a machine-readable time range', async ({
    page,
  }) => {
    await gotoEvents(page);

    const slots = days.flatMap((day) => day.slots ?? []);
    const rendered = await page
      .locator('article')
      .locator('time[datetime]')
      .evaluateAll((times) =>
        times.map((time) => ({
          dateTime: time.getAttribute('datetime'),
          label: time.textContent.trim(),
        })),
      );

    // `<time dateTime>` is what makes the schedule legible to anything that is
    // not a human reader; the label beside it is what a human reads. They are
    // emitted as a pair per slot boundary, start then end, in corpus order.
    expect(rendered).toEqual(
      slots.flatMap((slot) => [
        { dateTime: slot.start, label: slot.startLabel },
        { dateTime: slot.end, label: slot.endLabel },
      ]),
    );
  });

  test('cites the Sessionize source and the live schedule', async ({
    page,
  }) => {
    await gotoEvents(page);

    const article = page.locator('article');

    // Scoped to the component's own provenance paragraph rather than the
    // article: docs/events/index.md links the same official schedule URL from
    // its "Full schedule" bullet, so an article-wide match would pass on that
    // bullet alone even with the component's citation gone.
    const provenance = article.locator('[class*="source"]');
    await expect(provenance).toHaveCount(1);

    // Provenance is the page's claim about where these 80+ sessions came from
    // and how stale they may be. Both links are asserted as rendered hrefs
    // only, so the suite issues no request to either host.
    await expect(
      provenance.locator(`a[href="${schedule.apiUrl}"]`),
      'the provenance line no longer links the Sessionize API the data was collected from',
    ).toHaveCount(1);
    await expect(
      provenance.locator(`a[href="${schedule.sourceUrl}"]`),
      'the provenance line no longer links the live official schedule',
    ).toHaveCount(1);

    // The verified date is rendered from `generatedAt` in UTC, which is the
    // one formatting decision in the component that a reader in another
    // timezone would otherwise see shifted by a day.
    const verified = new Date(schedule.generatedAt).toLocaleDateString(
      'en-US',
      { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' },
    );
    await expect(
      provenance.getByText(`Verified ${verified}`, { exact: false }),
    ).toBeVisible();
  });
});
