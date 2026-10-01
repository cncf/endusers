// End-to-end coverage for /resources/radar-reports, the only route that
// renders src/components/RadarReports. tests/e2e/smoke.spec.js already asserts
// that the page is not blank (the section is visible, it holds at least one
// <li>, and the first link is absolute); everything below is the part of the
// list that the smoke test leaves untouched.
//
// tests/radar-reports.test.mjs reports full unit line and region coverage for
// the component, but it drives the JSX through tests/tools/fake-dom.mjs
// against a synthetic corpus: no document outline is ever built and the real
// data/radar-reports.json is never the thing rendered. So the unit suite
// cannot see two failure modes that only exist in the built site:
//
//   * a report present in the data file that never reaches the page — the
//     smoke test's "more than zero <li>" passes just as well with one entry as
//     with six, so a collector that silently drops reports looks identical;
//   * an outbound link that loses rel="noreferrer" in the shipped bundle,
//     which is what actually severs window.opener access for target="_blank".
//     tests/e2e/footer.spec.js and tests/e2e/metrics-dashboard.spec.js already
//     assert this against the hydrated document; this route is the remaining
//     external-link surface that did not.
//
// The corpus is also rebuilt daily from cncf.io by `npm run
// collect:radar-reports` via .github/workflows/refresh-radar-reports.yml, so
// it can change — or go empty — with no source change at all. These cases
// therefore assert the page against data/radar-reports.json rather than
// against any particular published report.
import { test, expect } from '../tools/e2e-coverage.cjs';
import radarData from '../../data/radar-reports.json';

const RADAR_PATH = '/resources/radar-reports';
const SECTION_NAME = 'CNCF Technology Radar reports';

// The component formats both `publishedAt` and `generatedAt` with
// `toLocaleDateString('en-US', { year, month: 'long', day })`, which resolves
// against the *renderer's* timezone. A date-only string such as "2026-09-07"
// parses as UTC midnight, so a build west of UTC legitimately renders
// "September 6, 2026". Asserting the exact day would therefore encode the
// build host's timezone into the suite; the shape is asserted instead.
const US_LONG_DATE = /^[A-Z][a-z]+ \d{1,2}, \d{4}$/;

const reports = radarData.radarReports ?? [];

function sectionOf(page) {
  return page.getByRole('region', { name: SECTION_NAME });
}

test.describe('radar reports list', () => {
  test('renders every report in the corpus, in feed order', async ({
    page,
  }) => {
    await page.goto(RADAR_PATH);
    const section = sectionOf(page);
    await expect(section).toBeVisible();

    // Guards the per-report loop below from passing vacuously on an empty
    // corpus, which is exactly what a failed refresh would produce.
    expect(
      reports.length,
      'data/radar-reports.json should list reports',
    ).toBeGreaterThan(0);

    const items = section.locator('ul > li');
    await expect(items).toHaveCount(reports.length);

    // Order is meaningful: the collector writes newest first and the component
    // maps the array as-is, so the page is the reverse-chronological feed.
    const renderedHrefs = await section
      .locator('ul > li h3 a')
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.href));
    expect(renderedHrefs).toEqual(reports.map((report) => report.url));
  });

  test('each entry pairs its title link with a date and a summary', async ({
    page,
  }) => {
    await page.goto(RADAR_PATH);
    const section = sectionOf(page);

    for (const report of reports) {
      const item = section.locator('ul > li').filter({
        has: page.locator(`h3 a[href="${report.url}"]`),
      });
      await expect(item, `${report.url} should render once`).toHaveCount(1);

      // The title is the link, so a report whose title stops rendering leaves
      // an anchor with no accessible name rather than a missing element.
      await expect(item.locator('h3 a')).toHaveText(report.title);

      const paragraphs = item.locator('p');
      await expect(paragraphs).toHaveCount(2);
      await expect(paragraphs.nth(0)).toHaveText(US_LONG_DATE);
      await expect(paragraphs.nth(1)).toHaveText(report.summary);
    }
  });

  test('the list is a flat set of level-3 headings', async ({ page }) => {
    await page.goto(RADAR_PATH);
    const section = sectionOf(page);

    // Each report is an <h3> under the page's <h1>/<h2>. The unit suite reads
    // the JSX tag name; only a real document has an outline that assistive
    // technology and the theme's table of contents actually walk.
    await expect(section.getByRole('heading', { level: 3 })).toHaveCount(
      reports.length,
    );
    await expect(section.getByRole('heading', { level: 4 })).toHaveCount(0);
  });
});

test.describe('radar reports provenance', () => {
  test('credits cncf.io with the date the mirror was taken', async ({
    page,
  }) => {
    test.skip(
      !radarData.generatedAt,
      'the component renders no provenance line for a corpus without generatedAt',
    );

    await page.goto(RADAR_PATH);
    const section = sectionOf(page);

    const provenance = section.locator('p').first();
    await expect(provenance).toContainText('Mirrored from');

    const source = provenance.getByRole('link', { name: 'cncf.io/reports' });
    await expect(source).toHaveAttribute('href', radarData.sourceUrl);

    // Only the formatted date is left once the static wording is removed, so
    // this catches an `Invalid Date` reaching the page — the visible symptom
    // of a malformed `generatedAt`.
    const text = (await provenance.innerText()).trim();
    const renderedDate = text
      .replace(/^Mirrored from\s+cncf\.io\/reports\s+on\s+/, '')
      .replace(/\.$/, '');
    expect(renderedDate).toMatch(US_LONG_DATE);
  });
});

test.describe('radar reports outbound links', () => {
  test('no outbound link can reach back through window.opener', async ({
    page,
  }) => {
    await page.goto(RADAR_PATH);
    const section = sectionOf(page);

    // The component sets rel="noreferrer" on the provenance link and on every
    // report title. In a real engine that attribute is what severs opener
    // access, so assert it against the hydrated document rather than the JSX.
    const newTabLinks = section.locator('a[target="_blank"]');
    // One per report plus the provenance link.
    await expect(newTabLinks).toHaveCount(
      reports.length + (radarData.generatedAt ? 1 : 0),
    );

    const rels = await newTabLinks.evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute('rel') ?? ''),
    );
    for (const rel of rels) {
      expect(rel).toMatch(/noreferrer/);
    }
  });

  test('every report link is an absolute https URL', async ({ page }) => {
    await page.goto(RADAR_PATH);
    const section = sectionOf(page);

    // The hrefs are mirrored verbatim from cncf.io into the corpus, so a
    // relative or http value would be served exactly as collected.
    const hrefs = await section
      .locator('ul > li h3 a')
      .evaluateAll((anchors) =>
        anchors.map((anchor) => anchor.getAttribute('href') ?? ''),
      );
    expect(hrefs).toHaveLength(reports.length);
    for (const href of hrefs) {
      expect(href).toMatch(/^https:\/\//);
    }
  });
});
