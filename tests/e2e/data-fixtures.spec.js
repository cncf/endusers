// End-to-end coverage for the component branches that only the overlaid
// coverage data can reach.
//
// Each case below renders a path the site will take as soon as upstream data
// shifts -- an archived user-group repository, a person listed with neither
// role nor company, an organization holding both membership roles. None of
// those shapes occur in
// the checked-in data/*.json, so against `npm run build:production` there is
// nothing to assert: the branches are not merely untested, they are
// unreachable. tests/tools/e2e-data-fixtures.cjs overlays the missing shapes
// into the E2E_COVERAGE=1 build only, which is what makes these assertions
// possible without changing a byte of what the site ships.
//
// The whole file is therefore skipped outside the coverage run: the gating
// "End-to-end tests" job builds with the real data, where every expectation
// here would be false.
//
// One related branch class is deliberately absent, in two places. AwardsTimeline
// renders its provenance paragraph only when data/awards.json carries a
// verifiedAt, and the ': null' arm beside it only when it does not; the same
// shape holds for ReferenceArchitectures' SyncStatus, whose sync-date ternary
// reads data/metrics.json's generatedAt (src/components/ReferenceArchitectures/
// index.js line 23). Each is a single document-level field on the one file one
// page reads, so an overlay that clears it does not add a case -- it swaps
// which arm is reachable, covering one line at the cost of the many that
// render the populated text (measured: thirteen for AwardsTimeline, five for
// SyncStatus). Those branches need per-route data, not a per-build overlay,
// and get a second build of their own rather than a second record; see
// tests/e2e/data-variants.spec.js.
import { test, expect } from '../tools/e2e-coverage.cjs';
import { loadSiteData } from '../tools/e2e-data-fixtures.cjs';

// The overlays are applied by the E2E_COVERAGE=1 build only, so outside the
// coverage run there is no fixture data to assert against.
const describeCoverage =
  process.env.E2E_COVERAGE === '1' ? test.describe : test.describe.skip;

// Addressed through the overlay rather than by a hard-coded string so a
// renamed fixture fails here instead of silently passing on the real data.
const groups = loadSiteData('community-groups.json').groups;
const stale = groups.filter((group) => group.archived || !group.reachable);
const people = loadSiteData('community-people.json').people.staff || [];
const anonymous = people.find((person) => !person.role && !person.company);
const byName = (name) => people.find((person) => person.name === name);
// websiteUrl() resolves the free-text "blog" field of a third-party GitHub
// profile. Each fixture below holds open one arm of that resolution; they are
// addressed through the overlay so a renamed or dropped record fails here
// rather than quietly stopping the coverage it was added for.
const absentWebsite = byName('Coverage Fixture Absent Website');
const bareHostWebsite = byName('Coverage Fixture Bare Host Website');
const unparseableWebsite = byName('Coverage Fixture Unparseable Website');
const members = loadSiteData('members.json').members;
const dualRole = members.find(
  (member) => member.membershipStatus === 'member-and-contributor',
);
// data/architectures/catalog.json has a JSON array for its root, so no dotted
// `set`/`append` path reaches into it; the overlay patches it with `setWhere`
// instead. Addressed through the overlay for the same reason as the fixtures
// above: a selector that no longer matches the regenerated catalog fails here.
const catalog = loadSiteData('architectures/catalog.json');
const noIndustries = catalog.find(
  (architecture) => architecture.industries.length === 0,
);
const someIndustries = catalog.find(
  (architecture) => architecture.industries.length > 0,
);

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

async function openStaffProfile(page, name) {
  await page.goto('/community');
  const trigger = page.getByRole('button', { name: `Open ${name} profile` });
  await waitForHydration(trigger);
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#profile-name')).toHaveText(name);
  return dialog;
}

describeCoverage('drifted upstream data', () => {
  test('GroupLinkStatus warns about an archived or unreachable group', async ({
    page,
  }) => {
    expect(stale.length).toBeGreaterThan(0);

    await page.goto('/community');
    const warning = page.getByText(
      /archived or unreachable upstream repositor(y|ies) — verify the group is still active/,
    );
    await expect(warning).toBeVisible();
    for (const group of stale) {
      await expect(warning).toContainText(group.name);
    }
  });

  test('PersonDialog falls back to "Community member" with no role or company', async ({
    page,
  }) => {
    expect(anonymous).toBeTruthy();

    await page.goto('/community');
    const trigger = page.getByRole('button', {
      name: `Open ${anonymous.name} profile`,
    });
    await waitForHydration(trigger);
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#profile-name')).toHaveText(anonymous.name);
    await expect(
      dialog.getByText('Community member', { exact: true }),
    ).toHaveCount(1);
  });

  test('PersonDialog resolves a website given as a bare host', async ({
    page,
  }) => {
    expect(bareHostWebsite).toBeTruthy();
    expect(bareHostWebsite.blog).toBe('fixture.example');

    const dialog = await openStaffProfile(page, bareHostWebsite.name);

    // The value carries no scheme, so websiteUrl resolves it against https
    // rather than concatenating it: the rendered href is an absolute URL whose
    // authority is the value itself, which is what stops a value such as
    // "trusted.example@attacker.example" from linking somewhere else.
    const website = dialog.getByRole('link', { name: 'Website' });
    await expect(website).toHaveAttribute(
      'href',
      `https://${bareHostWebsite.blog}/`,
    );
  });

  test('PersonDialog drops a website that parses as no URL at all', async ({
    page,
  }) => {
    expect(unparseableWebsite).toBeTruthy();
    expect(unparseableWebsite.blog).toBe('https://[');
    // The value opens with a scheme, so websiteUrl passes it to the URL parser
    // unchanged; the parser is what rejects it.
    expect(() => new URL(unparseableWebsite.blog)).toThrow();

    const dialog = await openStaffProfile(page, unparseableWebsite.name);

    // The links array is filtered on href, so an unresolvable value renders no
    // anchor rather than a dead one.
    await expect(dialog.getByRole('link', { name: 'Website' })).toHaveCount(0);
    await expect(dialog.locator('a[href]')).toHaveCount(0);
  });

  test('PersonDialog drops a website the profile does not carry', async ({
    page,
  }) => {
    expect(absentWebsite).toBeTruthy();
    expect(absentWebsite.blog).toBe(null);

    const dialog = await openStaffProfile(page, absentWebsite.name);

    // A non-string reaches websiteUrl before it is trimmed, so the guard that
    // rejects it is a different one from the empty-string case the role-less
    // fixture above covers.
    await expect(dialog.getByRole('link', { name: 'Website' })).toHaveCount(0);
    await expect(dialog.locator('a[href]')).toHaveCount(0);
  });

  test('MemberCard labels an organization holding both membership roles', async ({
    page,
  }) => {
    expect(dualRole).toBeTruthy();

    await page.goto('/community/members');
    const section = page.getByRole('region', {
      name: 'End User Community organization directory',
    });
    const search = section.getByLabel('Search organizations by name');
    await waitForHydration(search);
    await search.fill(dualRole.name);

    const card = section.locator('article', { hasText: dualRole.name });
    await expect(card).toHaveCount(1);
    await expect(
      card.getByText('End User Member and Contributor').first(),
    ).toBeVisible();
  });

  // `matchesMembership` answers the contributor filter with
  //
  //   status === 'contributor' || status === 'member-and-contributor'
  //
  // (src/components/MemberDirectory/utils.js:42-44). The committed
  // data/members.json holds no `member-and-contributor` organization, so
  // against the real build the left operand is true for every record the
  // filter admits and the right one never evaluates -- the dual-role arm is
  // not merely untested in a browser, it is unreachable. The overlay supplies
  // the one record that makes it reachable, which is the same reason the case
  // above exists; this one drives the filter rather than the card label.
  //
  // tests/e2e/interactions.spec.js covers the plain `contributor` arm against
  // the real data, where it runs in the gating "End-to-end tests" job too.
  test('the contributor filter admits an organization holding both roles', async ({
    page,
  }) => {
    expect(dualRole).toBeTruthy();

    await page.goto('/community/members');
    const section = page.getByRole('region', {
      name: 'End User Community organization directory',
    });
    const search = section.getByLabel('Search organizations by name');
    await waitForHydration(search);

    const membership = section.getByLabel('Filter by membership status');
    await membership.selectOption('contributor');
    await expect(
      section.locator('article', { hasText: dualRole.name }),
    ).toHaveCount(1);

    // The same record must drop out under the filter that does not admit it,
    // or the assertion above would also pass against a filter that stopped
    // filtering.
    await membership.selectOption('unknown');
    await expect(
      section.locator('article', { hasText: dualRole.name }),
    ).toHaveCount(0);
  });

  // ArchitectureCard's eyebrow is `industries.join(' · ') || 'Reference
  // architecture'`. Every entry the catalog ships carries a non-empty
  // industries array, so the fallback has never rendered in a browser. The
  // overlay empties one entry's industries, which is an additive case rather
  // than a swap: the other entries keep theirs, so both arms of the `||`
  // render on the same page in the same build.
  test('ArchitectureCard falls back to a generic eyebrow with no industries', async ({
    page,
  }) => {
    expect(noIndustries).toBeTruthy();
    expect(someIndustries).toBeTruthy();

    await page.goto('/architectures');
    // docs/architectures/index.md renders the catalog inside an autogenerated
    // docs sidebar that links every sibling page, so an unscoped
    // `a[href$="/architectures/<id>"]` matches the sidebar entry as well as
    // the card. Scope to the component's own landmark so these assertions
    // speak about ArchitectureCard and nothing else.
    const catalogSection = page.getByRole('region', {
      name: 'Reference architecture catalog',
    });
    const fallbackCard = catalogSection.locator(
      `a[href$="/architectures/${noIndustries.id}"]`,
    );
    await expect(fallbackCard).toHaveCount(1);
    await expect(
      fallbackCard.getByText('Reference architecture', { exact: true }),
    ).toBeVisible();

    // The populated arm on the same page is what makes this evidence that the
    // fallback is the branch rendering, not that every eyebrow went generic.
    const populatedCard = catalogSection.locator(
      `a[href$="/architectures/${someIndustries.id}"]`,
    );
    await expect(populatedCard).toHaveCount(1);
    await expect(
      populatedCard.getByText(someIndustries.industries.join(' · '), {
        exact: true,
      }),
    ).toBeVisible();
  });
});
