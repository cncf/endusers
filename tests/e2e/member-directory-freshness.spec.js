// End-to-end guard for the provenance note at the top of /community/members
// (src/components/MemberDirectory/DirectoryFreshness.js). Its three sentences
// come from three separately scheduled data files, and each sits behind a `&&`
// on its own formatDate() result -- which is null for anything Date cannot
// parse. A refresh that writes a malformed timestamp therefore drops that
// sentence silently, and if all three go the note disappears entirely.
//
// tests/member-directory.test.mjs already asserts the note, but through
// tests/tools/fake-dom.mjs with injected fixtures: it proves that a good
// timestamp renders, and cannot fail when the committed JSON carries a bad
// one. These cases read the committed files instead, the same way
// tests/e2e/community-people.spec.js guards the analogous PeopleFreshness note
// against `npm run fetch:community-people`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '../tools/e2e-coverage.cjs';

const MEMBERS_PATH = '/community/members';

// Playwright transpiles these .js specs to CommonJS (the package is not
// "type": "module"), so import.meta is unavailable. Playwright runs from the
// directory holding playwright.config.js, so the data files are addressed from
// the project root.
const readJson = (file) => JSON.parse(readFileSync(resolve(file), 'utf8'));

const membersData = readJson('data/members.json');
const metricsData = readJson('data/metrics.json');
const awardsData = readJson('data/awards.json');

const landscape = membersData?.sources?.landscape;
const architectures = metricsData?.sources?.architectures;

// DirectoryFreshness renders a sentence only when formatDate() returns a date.
// Each timestamp is asserted rather than used to skip the case: all three are
// already required to be parseable upstream -- scripts/validate-enduser-members.mjs:91
// for the landscape snapshot that generate-members.mjs copies to
// sources.landscape.collectedAt, scripts/validate-metrics.mjs:76 for
// generatedAt, and scripts/validate-awards.mjs:51 for verifiedAt. A value this
// helper rejects is the regression itself, not a reason to stand down, so
// skipping on it would hide exactly the failure this spec exists to catch.
const parses = (value) =>
  Boolean(value) && !Number.isNaN(new Date(value).getTime());

// formatDate() renders en-US long form, e.g. "October 1, 2026".
const LONG_DATE = String.raw`\w+ \d{1,2}, \d{4}`;

const note = (page) => page.locator('p[class*="freshnessNote"]');

test.describe('member directory freshness note', () => {
  test('renders exactly one provenance note', async ({ page }) => {
    await page.goto(MEMBERS_PATH);

    await expect(note(page)).toHaveCount(1);
    await expect(note(page)).toBeVisible();
  });

  test('states when membership data was last synced', async ({ page }) => {
    expect(
      parses(landscape?.collectedAt),
      'data/members.json sources.landscape.collectedAt must be a parseable timestamp',
    ).toBe(true);

    await page.goto(MEMBERS_PATH);

    await expect(note(page)).toContainText(
      new RegExp(
        String.raw`Directory membership data last synced from cncf/landscape on ${LONG_DATE}\.`,
      ),
    );
  });

  test('states when architecture-derived profiles were last synced', async ({
    page,
  }) => {
    expect(
      parses(metricsData?.generatedAt),
      'data/metrics.json generatedAt must be a parseable timestamp',
    ).toBe(true);

    await page.goto(MEMBERS_PATH);

    await expect(note(page)).toContainText(
      new RegExp(
        String.raw`Architecture-derived profiles last synced from cncf/architecture on ${LONG_DATE}\.`,
      ),
    );
  });

  test('states when award data was last verified', async ({ page }) => {
    expect(
      parses(awardsData?.verifiedAt),
      'data/awards.json verifiedAt must be a parseable timestamp',
    ).toBe(true);

    await page.goto(MEMBERS_PATH);

    await expect(note(page)).toContainText(
      new RegExp(String.raw`Award data last verified on ${LONG_DATE}\.`),
    );
  });

  test('links each named source to an absolute external URL', async ({
    page,
  }) => {
    await page.goto(MEMBERS_PATH);

    // The component falls back to plain text when a source carries no URL, so
    // a dropped sourceUrl/repository is caught here as a missing link rather
    // than surfacing later as a dead one.
    for (const [label, url] of [
      ['cncf/landscape', landscape?.sourceUrl],
      ['cncf/architecture', architectures?.repository],
    ]) {
      expect(url, `${label} must carry an absolute https source URL`).toMatch(
        /^https:\/\//,
      );
      const link = note(page).getByRole('link', { name: label, exact: true });
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute('href', url);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noreferrer');
    }
  });
});
