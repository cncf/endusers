// AwardsTimeline renders the whole /awards page: an audit-provenance banner,
// one section per award year and one WinnerCard per winner. Until now nothing
// loaded the module — tests/awards-data.test.mjs gates data/awards.json and
// reads the component only as TEXT, on the (now obsolete) premise that
// `node --test` has no JSX transform. tests/helpers-jsx.mjs supplies one, so
// the render contract can be asserted against the real element tree instead of
// against regexes over source.
//
// The component reads data/awards.json at module scope and takes no props, so
// the assertions below are invariants that hold for any shape of that file
// rather than snapshots of today's winners. Branches the live data does not
// reach (a winner with no logo, or with no announcementUrl) are driven by
// calling the unexported WinnerCard with a synthetic entry.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importSource } from './helpers-jsx.mjs';
import {
  findAllByType,
  textOf,
  walkElements,
} from './tools/react-element-tree.mjs';

const { default: AwardsTimeline } = await importSource(
  'src/components/AwardsTimeline/index.js',
);
const { default: awardsData } = await importSource('data/awards.json');

const timeline = AwardsTimeline();

/** @returns {any[]} every element in the tree, in document order */
function elements(tree) {
  return [...walkElements(tree)];
}

/**
 * Locates a nested component by function name.
 *
 * WinnerCard is not exported, so the only handle a test has on it is the
 * element the timeline returns; `element.type` is the function itself, which
 * can then be called with any props to render one level deeper.
 */
function componentNamed(tree, name) {
  const element = elements(tree).find(
    (candidate) =>
      typeof candidate.type === 'function' && candidate.type.name === name,
  );
  assert.ok(element, `expected a <${name}> element in the tree`);
  return element.type;
}

const WinnerCard = componentNamed(timeline, 'WinnerCard');

function cardElements(tree = timeline) {
  return elements(tree).filter((element) => element.type === WinnerCard);
}

/** The year badge text of each rendered section, in document order. */
function renderedYears() {
  return elements(timeline)
    .filter((element) => element.props?.className === 'yearBadge')
    .map((element) => Number(textOf(element)));
}

/** @returns {any[]} the per-year <section> elements, in document order */
function yearSections() {
  return elements(timeline).filter(
    (element) => element.props?.className === 'yearGroup',
  );
}

/** @returns {number} the year a section's rail badge announces */
function sectionYear(section) {
  return Number(
    textOf(
      elements(section).find(
        (element) => element.props?.className === 'yearBadge',
      ),
    ),
  );
}

/** @returns {string} the text of the audit banner, or '' when suppressed */
function bannerText(tree) {
  return textOf(
    [...walkElements(tree)].find(
      (element) => element.props?.className === 'verification',
    ),
  );
}

const OUTBOUND_LINK_LABELS = {
  announcementUrl: 'Announcement',
  caseStudyUrl: 'Case study',
  talkUrl: 'Watch the talk',
};

function sampleEntry(overrides = {}) {
  return {
    year: 2026,
    slug: 'example-org',
    award: 'top-end-user',
    awardLabel: 'Top End User Award',
    organization: 'Example Org',
    citation: 'For running everything on Kubernetes.',
    event: 'KubeCon NA 2026',
    logo: '/img/awards/example-org.svg',
    announcementUrl: 'https://www.cncf.io/announcements/example/',
    caseStudyUrl: 'https://www.cncf.io/case-studies/example/',
    talkUrl: 'https://www.youtube.com/watch?v=example',
    ...overrides,
  };
}

test('every award in the data file becomes exactly one card', () => {
  assert.equal(cardElements().length, awardsData.awards.length);
});

test('year groups are rendered newest first, with no year repeated', () => {
  const years = renderedYears();
  const distinct = [...new Set(awardsData.awards.map((entry) => entry.year))];

  assert.deepEqual(
    years,
    [...distinct].sort((a, b) => b - a),
    'year sections must appear in descending year order',
  );
  assert.equal(
    years.length,
    new Set(years).size,
    'each year must be grouped into a single section',
  );
});

test('each card lands in the section for its own year, in file order', () => {
  const sections = yearSections();
  assert.equal(sections.length, renderedYears().length);

  for (const section of sections) {
    const year = sectionYear(section);
    const expected = awardsData.awards.filter((entry) => entry.year === year);
    const rendered = cardElements(section).map((card) => card.props.entry);

    assert.deepEqual(
      rendered.map((entry) => entry.slug),
      expected.map((entry) => entry.slug),
      `year ${year} must keep the winners in the order data/awards.json lists them`,
    );
    for (const entry of rendered) assert.equal(entry.year, year);
  }
});

test('cards carry a key that is unique among the siblings in their year', () => {
  // The key is `${slug}-${i}` with `i` scoped to the year group, so the same
  // slug winning in two years is fine; a collision inside one year is not,
  // because React would then drop or reuse a card.
  for (const section of yearSections()) {
    const keys = cardElements(section).map((card) => card.key);
    assert.equal(
      keys.filter(Boolean).length,
      keys.length,
      'every card needs a React key',
    );
    assert.equal(
      new Set(keys).size,
      keys.length,
      `duplicate card key within one year section: ${keys.join(', ')}`,
    );
  }
});

test('the audit banner names the source it links to and dates it in UTC', () => {
  const banner = elements(timeline).find(
    (element) => element.props?.className === 'verification',
  );

  if (!awardsData.verifiedAt || !awardsData.verifiedAgainst) {
    assert.equal(
      banner,
      undefined,
      'the banner must be suppressed unless both verifiedAt and verifiedAgainst are present',
    );
    return;
  }

  assert.ok(banner, 'expected the audit-provenance banner');
  const link = findAllByType(banner, 'a')[0];
  assert.equal(link.props.href, awardsData.verifiedAgainst);

  const expected = new Date(awardsData.verifiedAt).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  assert.match(textOf(banner), new RegExp(`on ${expected}\\.$`));
});

// Regression guard: verifiedAt is a bare calendar date parsed as UTC midnight,
// so formatting it without `timeZone: 'UTC'` renders the previous day for every
// visitor west of UTC — and, because Docusaurus prerenders in CI (UTC) and
// rehydrates in the browser, produces a hydration text mismatch as well.
test('the audit date does not drift with the runtime time zone', (t) => {
  if (!awardsData.verifiedAt || !awardsData.verifiedAgainst) return;

  const original = process.env.TZ;
  const control = (zone) => {
    process.env.TZ = zone;
    return new Date(awardsData.verifiedAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  try {
    // Guard against a runtime that ignores a late TZ change: without such a
    // change the assertion below would pass vacuously.
    if (control('America/Los_Angeles') === control('Europe/Berlin')) {
      t.skip('this runtime ignores TZ changes after start-up');
      return;
    }

    process.env.TZ = 'America/Los_Angeles';
    const west = bannerText(AwardsTimeline());
    process.env.TZ = 'Europe/Berlin';
    const east = bannerText(AwardsTimeline());
    assert.equal(
      west,
      east,
      'the banner date must be stamped in UTC, not in the visitor time zone',
    );
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('the banner is suppressed when either audit field is missing', () => {
  // The component closes over the imported data object, and the JSON module is
  // a live object shared with this test, so each field can be removed and
  // restored around a re-render to reach the suppressed branch.
  for (const missing of ['verifiedAt', 'verifiedAgainst']) {
    const saved = awardsData[missing];
    try {
      delete awardsData[missing];
      assert.equal(
        bannerText(AwardsTimeline()),
        '',
        `the banner must not render when ${missing} is absent`,
      );
    } finally {
      awardsData[missing] = saved;
    }
  }
  assert.notEqual(
    bannerText(AwardsTimeline()),
    '',
    'the banner must come back once both fields are restored',
  );
});

test('the logo anchor falls back to the talk when there is no announcement', () => {
  const withAnnouncement = WinnerCard({ entry: sampleEntry() });
  assert.equal(
    findAllByType(withAnnouncement, 'a')[0].props.href,
    'https://www.cncf.io/announcements/example/',
  );

  const talkOnly = WinnerCard({
    entry: sampleEntry({ announcementUrl: undefined }),
  });
  assert.equal(
    findAllByType(talkOnly, 'a')[0].props.href,
    'https://www.youtube.com/watch?v=example',
    'with no announcementUrl the logo anchor must point at the talk',
  );
});

test('the logo anchor is labelled with the organization and its award', () => {
  const anchor = findAllByType(WinnerCard({ entry: sampleEntry() }), 'a')[0];
  assert.equal(
    anchor.props['aria-label'],
    'Example Org — Top End User Award',
    'the logo anchor wraps an image, so aria-label is its only accessible name',
  );
});

test('a missing logo degrades to the organization name, not a broken image', () => {
  const withLogo = WinnerCard({ entry: sampleEntry() });
  const image = findAllByType(withLogo, 'img')[0];
  assert.ok(image, 'an entry with a logo must render an <img>');
  assert.equal(image.props.src, '/img/awards/example-org.svg');
  assert.equal(image.props.alt, 'Example Org logo');
  assert.equal(image.props.loading, 'lazy');

  const withoutLogo = WinnerCard({ entry: sampleEntry({ logo: undefined }) });
  assert.equal(
    findAllByType(withoutLogo, 'img').length,
    0,
    'no logo means no <img> at all',
  );
  const fallback = [...walkElements(withoutLogo)].find(
    (element) => element.props?.className === 'logoFallback',
  );
  assert.ok(fallback, 'expected a text fallback in place of the logo');
  assert.equal(textOf(fallback), 'Example Org');
});

test('every outbound anchor opens in a new tab with a tabnabbing guard', () => {
  for (const card of [
    WinnerCard({ entry: sampleEntry() }),
    ...cardElements().map((element) => element.type(element.props)),
  ]) {
    for (const anchor of findAllByType(card, 'a')) {
      assert.equal(anchor.props.target, '_blank');
      assert.equal(
        anchor.props.rel,
        'noopener noreferrer',
        `${anchor.props.href} opens in a new tab and must not leak window.opener`,
      );
    }
  }
});

test('each optional link renders only when the entry supplies it', () => {
  for (const [field, label] of Object.entries(OUTBOUND_LINK_LABELS)) {
    const present = WinnerCard({ entry: sampleEntry() });
    assert.ok(
      findAllByType(present, 'a').some(
        (anchor) => textOf(anchor) === label && anchor.props.href,
      ),
      `expected a "${label}" link when ${field} is set`,
    );

    const absent = WinnerCard({ entry: sampleEntry({ [field]: undefined }) });
    assert.equal(
      findAllByType(absent, 'a').filter((anchor) => textOf(anchor) === label)
        .length,
      0,
      `"${label}" must not render when ${field} is absent`,
    );
  }
});

test('each card shows the award, organization, citation and event', () => {
  const card = WinnerCard({ entry: sampleEntry() });
  const text = textOf(card);
  for (const field of ['awardLabel', 'organization', 'citation', 'event']) {
    assert.match(
      text,
      new RegExp(sampleEntry()[field].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `the card must render ${field}`,
    );
  }
  assert.equal(
    textOf(
      [...walkElements(card)].find(
        (element) => element.props?.className === 'orgName',
      ),
    ),
    'Example Org',
    'the organization is the card heading',
  );
});
