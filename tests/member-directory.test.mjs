// Render contract for src/components/MemberDirectory/.
//
// The directory is the whole of /community/members and is the largest
// component in the repository, but no test loaded a line of it: the exported
// `MemberDirectory` bakes `@site/data/members.json` in at module scope, holds
// five filters in local state, and reaches `MemberCard` — and through it the
// `MemberProfile` dialog — only via that state.
//
// The components are therefore driven through React's hook dispatcher, which
// reaches the conditional rendering inside them without a DOM or a renderer.
// The dispatcher is deliberately local to this file rather than an extension
// of ./tools/react-hook-driver.mjs: like tests/community-people.test.mjs it
// collects effects without running them, so `useFocusTrap` contributes its two
// refs and nothing that needs a `document`. That hook's effect is already
// covered at 100% by tests/use-focus-trap.test.mjs.
//
// `DirectoryFreshness` reads two further data files at module scope, so the
// branches the checked-in data does not happen to reach are exercised through
// ./helpers-component-data.mjs instead.

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';

import { importSource } from './helpers-jsx.mjs';
import {
  findAllByType,
  findByType,
  textOf,
  walkElements,
} from './tools/react-element-tree.mjs';

const DIR = 'src/components/MemberDirectory';

const MemberDirectory = (await importSource(`${DIR}/index.js`)).default;
const { MemberCard } = await importSource(`${DIR}/MemberCard.js`);
const { MemberProfile } = await importSource(`${DIR}/MemberProfile.js`);
const { DirectoryFreshness } = await importSource(
  `${DIR}/DirectoryFreshness.js`,
);
const { useFilterOptions } = await importSource(`${DIR}/hooks.js`);
const { initials, formatCount, formatDate } = await importSource(
  `${DIR}/utils.js`,
);

const membersData = (await importSource('data/members.json')).default;
const metrics = (await importSource('data/metrics.json')).default;
const awardsData = (await importSource('data/awards.json')).default;

const MEMBERS = membersData.members;

const Internals =
  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false;
  return a.length === b.length && a.every((dep, i) => Object.is(dep, b[i]));
}

/**
 * Renders a function component that uses useState, useRef, useMemo or
 * useEffect, re-rendering synchronously whenever a state setter is called.
 *
 * Effects are recorded rather than invoked, so no DOM is required.
 *
 * @param {Function} Component component under test
 * @param {object} [props] props to render it with
 * @returns {{ tree: any, effects: Function[] }} live view of the last render
 */
function render(Component, props = {}) {
  const states = [];
  const refs = [];
  const memos = [];
  const view = { tree: null, effects: [] };

  function run() {
    let stateSlot = 0;
    let refSlot = 0;
    let memoSlot = 0;
    const effects = [];
    const previousDispatcher = Internals.H;
    Internals.H = {
      useState(initial) {
        const slot = stateSlot++;
        if (slot === states.length) {
          states.push(typeof initial === 'function' ? initial() : initial);
        }
        const setState = (next) => {
          const value = typeof next === 'function' ? next(states[slot]) : next;
          if (Object.is(value, states[slot])) return;
          states[slot] = value;
          run();
        };
        return [states[slot], setState];
      },
      useRef(initial) {
        const slot = refSlot++;
        if (slot === refs.length) refs.push({ current: initial });
        return refs[slot];
      },
      useMemo(factory, deps) {
        const slot = memoSlot++;
        const previous = memos[slot];
        if (previous && sameDeps(previous.deps, deps)) return previous.value;
        const value = factory();
        memos[slot] = { deps, value };
        return value;
      },
      useEffect(create) {
        effects.push(create);
      },
    };
    try {
      view.tree = Component(props);
    } finally {
      Internals.H = previousDispatcher;
    }
    view.effects = effects;
  }

  run();
  return view;
}

function findByClass(tree, className) {
  for (const element of walkElements(tree)) {
    if (element.props?.className === className) return element;
  }
  return undefined;
}

function findAllByClass(tree, className) {
  return [...walkElements(tree)].filter(
    (element) => element.props?.className === className,
  );
}

/** Every function-typed element in the tree, i.e. the nested components. */
function childComponents(tree) {
  return [...walkElements(tree)].filter(
    (element) => typeof element.type === 'function',
  );
}

/** Every `<li>` under an element, in document order. */
function liItems(node) {
  return [...walkElements(node)].filter((element) => element.type === 'li');
}

/** The `<select>` whose id is `id`, with its option values in order. */
function optionValues(tree, id) {
  const select = [...walkElements(tree)].find(
    (element) => element.type === 'select' && element.props?.id === id,
  );
  return findAllByType(select, 'option').map((option) => option.props.value);
}

/** Re-renders the directory after applying `mutate` to its live controls. */
function renderDirectory() {
  const view = render(MemberDirectory);
  return {
    view,
    search(value) {
      findByType(view.tree, 'input').props.onChange({ target: { value } });
    },
    select(id, value) {
      const element = [...walkElements(view.tree)].find(
        (node) => node.type === 'select' && node.props?.id === id,
      );
      element.props.onChange({ target: { value } });
    },
    toggle(label, checked) {
      const box = findAllByClass(view.tree, 'toggle')
        .map((wrapper) => findByType(wrapper, 'input'))
        .find(
          (input, index) =>
            input &&
            textOf(findAllByClass(view.tree, 'toggle')[index]) === label,
        );
      box.props.onChange({ target: { checked } });
    },
    listItems() {
      return findAllByClass(view.tree, 'listItem');
    },
    shownCount() {
      return Number(
        textOf(findByType(findByClass(view.tree, 'resultsBar'), 'strong')),
      );
    },
    clearButtons() {
      return findAllByClass(view.tree, 'clearButton');
    },
  };
}

const MEMBER_WITHOUT_LOGO = MEMBERS.find((member) => !member.logo);
const MEMBER_WITH_LOGO = MEMBERS.find((member) => member.logo);
const MEMBER_WITH_ARCHITECTURES = MEMBERS.find(
  (member) => member.architectures.length > 0,
);
const MEMBER_WITH_AWARDS = MEMBERS.find((member) => member.awards.length > 0);

// Neither shape occurs in the checked-in corpus, and both are rendered
// branches, so they are supplied as fixtures rather than found in the data.
const BARE_MEMBER = {
  id: 'example-org',
  name: 'Example Org Holdings',
  slug: 'example-org',
  logo: null,
  industries: [],
  projects: [],
  architectures: [],
  awards: [],
  sourceAttribution: ['https://www.cncf.io/example/'],
};

const RICH_MEMBER = {
  id: 'rich-org',
  name: 'Rich Org',
  slug: 'rich-org',
  logo: '/img/members/rich-org.svg',
  industries: ['Finance', 'Retail'],
  projects: ['Kubernetes', 'Prometheus'],
  architectures: [
    { id: 'rich-org-platform', title: 'Rich Org platform' },
    { id: 'rich-org-edge', title: 'Rich Org edge' },
  ],
  awards: [
    {
      year: 2025,
      award: 'top-end-user',
      awardLabel: 'Top End User Award',
      citation: 'For running everything on Kubernetes.',
      event: 'KubeCon + CloudNativeCon Europe, London',
      announcementUrl: 'https://www.cncf.io/announcements/rich-org/',
      caseStudyUrl: 'https://www.cncf.io/case-studies/rich-org/',
      talkUrl: 'https://www.youtube.com/watch?v=rich-org',
    },
  ],
  sourceAttribution: ['https://www.cncf.io/announcements/rich-org/'],
};

function openProfile(member) {
  const card = render(MemberCard, { member });
  findByClass(card.tree, 'cardButton').props.onClick();
  return card;
}

function renderProfile(member, onClose = () => {}) {
  return render(MemberProfile, {
    member,
    onClose,
    triggerRef: { current: null },
  });
}

// --- utils ----------------------------------------------------------------

test('initials takes the first letter of the first two words, uppercased', () => {
  assert.equal(initials('Example Org Holdings'), 'EO');
  assert.equal(initials('ant group'), 'AG');
  assert.equal(initials('Spotify'), 'S');
});

test('formatCount picks the singular only for exactly one', () => {
  assert.equal(formatCount(1, 'award', 'awards'), '1 award');
  assert.equal(formatCount(2, 'award', 'awards'), '2 awards');
  assert.equal(formatCount(0, 'award', 'awards'), '0 awards');
});

test('formatDate renders a long en-US date and rejects a bad timestamp', () => {
  assert.equal(formatDate('2026-08-08'), 'August 8, 2026');
  assert.equal(formatDate('2026-07-27T03:29:35.945Z'), 'July 27, 2026');
  assert.equal(formatDate('not a date'), null);
  assert.equal(formatDate(undefined), null);
  // `new Date(null)` is the epoch rather than an invalid date, so an explicit
  // JSON null is formatted rather than rejected. Recorded, not endorsed.
  assert.equal(formatDate(null), 'January 1, 1970');
});

// --- useFilterOptions -----------------------------------------------------

test('useFilterOptions returns the sorted distinct industries and projects', () => {
  const { tree: result } = render(() => useFilterOptions(MEMBERS));

  const expectedIndustries = [
    ...new Set(MEMBERS.flatMap((member) => member.industries)),
  ].sort();
  const expectedProjects = [
    ...new Set(MEMBERS.flatMap((member) => member.projects)),
  ].sort();

  assert.deepEqual(result.industries, expectedIndustries);
  assert.deepEqual(result.projects, expectedProjects);
  assert.ok(result.industries.length > 0);
  assert.ok(result.projects.length > 0);
});

// --- DirectoryFreshness ---------------------------------------------------

// `DirectoryFreshness` reads `@site/data/metrics.json` and
// `@site/data/awards.json` inside its own body, and the hooks in
// ./tools/jsx-hooks.mjs hand the component and this test the same module
// instance for each. Patching those objects for the duration of one call is
// therefore enough to reach the branches the checked-in data never takes —
// and, unlike importing a rewritten copy, it exercises the real source file.
function withFreshnessData(metricsPatch, awardsPatch, run) {
  const metricsBackup = { ...metrics };
  const awardsBackup = { ...awardsData };
  Object.assign(metrics, metricsPatch);
  Object.assign(awardsData, awardsPatch);
  try {
    run();
  } finally {
    Object.assign(metrics, metricsBackup);
    Object.assign(awardsData, awardsBackup);
  }
}

test('the freshness note dates both upstream sources and links the repo', () => {
  const tree = DirectoryFreshness();
  const text = textOf(tree);
  assert.match(text, /Architecture-derived profiles last synced from/);
  assert.ok(text.includes(formatDate(metrics.generatedAt)));
  assert.ok(text.includes(formatDate(awardsData.verifiedAt)));

  const link = findByType(tree, 'a');
  assert.equal(link.props.href, metrics.sources.architectures.repository);
  assert.equal(link.props.target, '_blank');
  assert.match(link.props.rel, /noreferrer/);
  assert.equal(textOf(link), 'cncf/architecture');
});

test('the freshness note is plain text when no upstream repository is known', () => {
  withFreshnessData(
    { generatedAt: '2026-01-02T00:00:00.000Z', sources: {} },
    { verifiedAt: '2026-03-04' },
    () => {
      const tree = DirectoryFreshness();
      assert.equal(findByType(tree, 'a'), undefined);
      const text = textOf(tree);
      assert.ok(text.includes('cncf/architecture'));
      assert.ok(text.includes('January 2, 2026'));
      assert.ok(text.includes('March 4, 2026'));
    },
  );
});

test('the freshness note renders nothing when neither date is usable', () => {
  withFreshnessData(
    { generatedAt: 'nonsense' },
    { verifiedAt: undefined },
    () => {
      assert.equal(DirectoryFreshness(), null);
    },
  );
});

test('the freshness note keeps the award date when the metrics date is absent', () => {
  withFreshnessData(
    { generatedAt: undefined },
    { verifiedAt: '2026-03-04' },
    () => {
      const text = textOf(DirectoryFreshness());
      assert.equal(text.includes('last synced'), false);
      assert.match(text, /Award data last verified on March 4, 2026\./);
    },
  );
});

// --- MemberDirectory ------------------------------------------------------

test('the directory labels itself and opens with the freshness note', () => {
  const { view } = renderDirectory();
  assert.equal(
    view.tree.props['aria-label'],
    'End User Community member directory',
  );
  assert.equal(childComponents(view.tree)[0].type, DirectoryFreshness);
});

test('each filter control carries a label that names it', () => {
  const { view } = renderDirectory();
  const labels = findAllByType(view.tree, 'label');
  const forIds = labels.map((label) => label.props.htmlFor).filter(Boolean);
  assert.deepEqual(forIds, [
    'member-search',
    'member-industry',
    'member-project',
  ]);
  assert.equal(
    findByType(view.tree, 'input').props.placeholder,
    'Search members by name',
  );
});

test('the industry and project selects list every distinct value, sorted', () => {
  const { view } = renderDirectory();
  const industries = [
    ...new Set(MEMBERS.flatMap((member) => member.industries)),
  ].sort();
  const projects = [
    ...new Set(MEMBERS.flatMap((member) => member.projects)),
  ].sort();

  assert.deepEqual(optionValues(view.tree, 'member-industry'), [
    '',
    ...industries,
  ]);
  assert.deepEqual(optionValues(view.tree, 'member-project'), [
    '',
    ...projects,
  ]);
});

test('the results bar counts the whole corpus and hides Clear filters', () => {
  const directory = renderDirectory();
  assert.equal(directory.shownCount(), MEMBERS.length);
  assert.match(
    textOf(findByClass(directory.view.tree, 'resultsBar')),
    new RegExp(`Showing ${MEMBERS.length} of ${MEMBERS.length} members`),
  );
  assert.equal(directory.clearButtons().length, 0);
});

test('every member gets one list item, keyed by its id', () => {
  const directory = renderDirectory();
  const items = directory.listItems();
  assert.equal(items.length, MEMBERS.length);
  assert.deepEqual(
    items.map((item) => item.key),
    MEMBERS.map((member) => member.id),
  );
  assert.equal(new Set(items.map((item) => item.key)).size, MEMBERS.length);
  for (const [index, item] of items.entries()) {
    const card = findByType(item, MemberCard);
    assert.equal(card.props.member, MEMBERS[index]);
  }
});

test('searching by name is case-insensitive and trims surrounding space', () => {
  const directory = renderDirectory();
  const target = MEMBERS[0];
  directory.search(`  ${target.name.toUpperCase()}  `);

  const matches = MEMBERS.filter((member) =>
    member.name.toLowerCase().includes(target.name.toLowerCase()),
  );
  assert.equal(directory.shownCount(), matches.length);
  assert.ok(
    directory
      .listItems()
      .some((item) => findByType(item, MemberCard).props.member === target),
  );
  assert.equal(directory.clearButtons().length, 1);
});

test('the industry filter keeps only members carrying that industry', () => {
  const industry = MEMBERS.flatMap((member) => member.industries)[0];
  const directory = renderDirectory();
  directory.select('member-industry', industry);

  const expected = MEMBERS.filter((member) =>
    member.industries.includes(industry),
  );
  assert.ok(expected.length > 0);
  assert.equal(directory.shownCount(), expected.length);
  for (const item of directory.listItems()) {
    assert.ok(
      findByType(item, MemberCard).props.member.industries.includes(industry),
    );
  }
});

test('the project filter keeps only members using that project', () => {
  const project = MEMBERS.flatMap((member) => member.projects)[0];
  const directory = renderDirectory();
  directory.select('member-project', project);

  const expected = MEMBERS.filter((member) =>
    member.projects.includes(project),
  );
  assert.ok(expected.length > 0);
  assert.equal(directory.shownCount(), expected.length);
});

test('the architecture and award toggles drop members without either', () => {
  const withArchitectures = MEMBERS.filter(
    (member) => member.architectures.length > 0,
  );
  const withAwards = MEMBERS.filter((member) => member.awards.length > 0);
  assert.ok(withArchitectures.length > 0);
  assert.ok(withAwards.length > 0);

  const byArchitecture = renderDirectory();
  byArchitecture.toggle('Has architecture', true);
  assert.equal(byArchitecture.shownCount(), withArchitectures.length);

  const byAward = renderDirectory();
  byAward.toggle('Has award', true);
  assert.equal(byAward.shownCount(), withAwards.length);
});

test('Clear filters resets every control and restores the full list', () => {
  const directory = renderDirectory();
  directory.search('ant');
  directory.toggle('Has award', true);
  assert.equal(directory.clearButtons().length, 1);

  directory.clearButtons()[0].props.onClick();

  assert.equal(directory.shownCount(), MEMBERS.length);
  assert.equal(directory.clearButtons().length, 0);
  assert.equal(findByType(directory.view.tree, 'input').props.value, '');
  assert.deepEqual(
    findAllByClass(directory.view.tree, 'toggle')
      .map((toggle) => findByType(toggle, 'input'))
      .map((input) => input.props.checked),
    [false, false],
  );
});

test('a search that matches nothing shows the empty state, not the grid', () => {
  const directory = renderDirectory();
  directory.search('no-such-organization-anywhere');

  assert.equal(directory.shownCount(), 0);
  assert.equal(findByClass(directory.view.tree, 'grid'), undefined);
  const empty = findByClass(directory.view.tree, 'emptyState');
  assert.equal(textOf(findByType(empty, 'h3')), 'No members match');

  // Both the results bar and the empty state offer a way out.
  assert.equal(directory.clearButtons().length, 2);
  directory.clearButtons()[1].props.onClick();
  assert.equal(directory.shownCount(), MEMBERS.length);
});

// --- MemberCard -----------------------------------------------------------

test('a card starts closed, with no dialog in the tree', () => {
  const { tree } = render(MemberCard, { member: RICH_MEMBER });
  assert.equal(findByType(tree, MemberProfile), undefined);
});

test('the card names the member and labels its trigger', () => {
  const { tree } = render(MemberCard, { member: RICH_MEMBER });
  const button = findByClass(tree, 'cardButton');
  assert.equal(button.props.type, 'button');
  assert.equal(button.props['aria-label'], 'Open Rich Org profile');
  assert.equal(textOf(findByClass(tree, 'orgName')), 'Rich Org');
  assert.equal(textOf(findByClass(tree, 'viewLink')), 'View profile →');
});

test('a card with a logo renders a lazy, decorative image at the base URL', () => {
  const { tree } = render(MemberCard, { member: MEMBER_WITH_LOGO });
  const image = findByType(tree, 'img');
  assert.equal(image.props.alt, '');
  assert.equal(image.props.loading, 'lazy');
  assert.equal(
    image.props.src,
    MEMBER_WITH_LOGO.logo.startsWith('/')
      ? MEMBER_WITH_LOGO.logo
      : `/${MEMBER_WITH_LOGO.logo}`,
  );
  assert.equal(findByClass(tree, 'initials'), undefined);
});

test('a card without a logo falls back to the member initials', () => {
  const { tree } = render(MemberCard, { member: MEMBER_WITHOUT_LOGO });
  assert.equal(findByType(tree, 'img'), undefined);
  assert.equal(
    textOf(findByClass(tree, 'initials')),
    initials(MEMBER_WITHOUT_LOGO.name),
  );
  assert.equal(findByClass(tree, 'logoWrapper').props['aria-hidden'], 'true');
});

test('card meta counts architectures and awards, pluralised', () => {
  const { tree } = render(MemberCard, { member: RICH_MEMBER });
  assert.equal(textOf(findByClass(tree, 'cardMeta')), '2 architectures1 award');
});

test('card meta falls back to Community member with neither count', () => {
  const { tree } = render(MemberCard, { member: BARE_MEMBER });
  assert.equal(textOf(findByClass(tree, 'cardMeta')), 'Community member');
  assert.equal(findByClass(tree, 'eyebrow'), undefined);
  assert.equal(findByClass(tree, 'projectsList'), undefined);
});

test('the card shows at most three industries and four project tags', () => {
  const crowded = {
    ...RICH_MEMBER,
    industries: ['A', 'B', 'C', 'D'],
    projects: ['P1', 'P2', 'P3', 'P4', 'P5'],
  };
  const { tree } = render(MemberCard, { member: crowded });
  assert.equal(textOf(findByClass(tree, 'eyebrow')), 'A · B · C');
  assert.deepEqual(
    findAllByClass(tree, 'projectTag').map((tag) => textOf(tag)),
    ['P1', 'P2', 'P3', 'P4'],
  );
  assert.deepEqual(
    findAllByClass(tree, 'projectTag').map((tag) => tag.key),
    ['P1', 'P2', 'P3', 'P4'],
  );
});

test('clicking the card mounts the profile dialog, and closing removes it', () => {
  const card = openProfile(RICH_MEMBER);
  const dialog = findByType(card.tree, MemberProfile);
  assert.equal(dialog.props.member, RICH_MEMBER);
  assert.equal(typeof dialog.props.onClose, 'function');
  assert.ok(dialog.props.triggerRef);

  dialog.props.onClose();
  assert.equal(findByType(card.tree, MemberProfile), undefined);
});

// --- MemberProfile --------------------------------------------------------

test('the dialog is a labelled modal with a named close button', () => {
  const { tree } = renderProfile(RICH_MEMBER);
  const dialog = findByClass(tree, 'dialog');
  assert.equal(dialog.props.role, 'dialog');
  assert.equal(dialog.props['aria-modal'], 'true');
  assert.equal(dialog.props['aria-labelledby'], 'member-profile-name');
  assert.equal(
    findByType(tree, 'h2').props.id,
    dialog.props['aria-labelledby'],
  );

  const close = findByClass(tree, 'closeButton');
  assert.equal(close.props['aria-label'], 'Close Rich Org profile');
});

test('the close button and a backdrop click both invoke onClose', () => {
  let closed = 0;
  const { tree } = renderProfile(RICH_MEMBER, () => {
    closed += 1;
  });
  findByClass(tree, 'closeButton').props.onClick();
  assert.equal(closed, 1);

  const backdrop = findByClass(tree, 'backdrop');
  const target = {};
  backdrop.props.onMouseDown({ target, currentTarget: target });
  assert.equal(closed, 2);

  // A click that started inside the dialog must not close it.
  backdrop.props.onMouseDown({ target: {}, currentTarget: {} });
  assert.equal(closed, 2);
});

test('the dialog lists industries, projects, architectures and awards', () => {
  const { tree } = renderProfile(RICH_MEMBER);
  const headings = findAllByType(tree, 'h3').map((h) => textOf(h));
  assert.deepEqual(headings, [
    'Industries',
    'CNCF projects',
    'Reference architectures',
    'Awards',
    'Sources',
  ]);

  assert.deepEqual(
    findAllByClass(tree, 'tag').map((tag) => textOf(tag)),
    ['Finance', 'Retail', 'Kubernetes', 'Prometheus'],
  );
  assert.deepEqual(
    liItems(findAllByClass(tree, 'linkList')[0]).map((item) => item.key),
    ['rich-org-platform', 'rich-org-edge'],
  );
  assert.equal(
    textOf(findByClass(tree, 'profileMeta')),
    '2 architectures1 award',
  );
  assert.equal(
    textOf(findByClass(tree, 'profileKicker')),
    'End User Community member',
  );
});

test('each architecture links to its own detail page', () => {
  const { tree } = renderProfile(MEMBER_WITH_ARCHITECTURES);
  const items = liItems(findAllByClass(tree, 'linkList')[0]);
  assert.equal(items.length, MEMBER_WITH_ARCHITECTURES.architectures.length);
  for (const [index, item] of items.entries()) {
    const architecture = MEMBER_WITH_ARCHITECTURES.architectures[index];
    // Rendered by `@docusaurus/Link`, which maps `to` onto the href.
    const link = [...walkElements(item)].find(
      (node) => node.props?.to !== undefined,
    );
    assert.equal(link.props.to, `/architectures/${architecture.id}`);
    assert.equal(textOf(link), architecture.title);
  }
});

test('an award renders its citation, event and every optional link', () => {
  const { tree } = renderProfile(RICH_MEMBER);
  const award = RICH_MEMBER.awards[0];
  const item = findByClass(tree, 'awardItem');
  assert.equal(item.key, '2025-0');
  assert.equal(
    textOf(findByClass(item, 'awardLabel')),
    `${award.year} · ${award.awardLabel}`,
  );
  assert.equal(textOf(findByClass(item, 'awardCitation')), award.citation);
  assert.equal(textOf(findByClass(item, 'awardEvent')), award.event);

  assert.deepEqual(
    findAllByType(findByClass(item, 'awardLinks'), 'a').map(
      (a) => a.props.href,
    ),
    [award.announcementUrl, award.caseStudyUrl, award.talkUrl],
  );
});

test('an award omits the links it has no URL for', () => {
  const { tree } = renderProfile({
    ...RICH_MEMBER,
    awards: [
      {
        ...RICH_MEMBER.awards[0],
        caseStudyUrl: null,
        talkUrl: null,
      },
    ],
  });
  assert.deepEqual(
    findAllByType(findByClass(tree, 'awardLinks'), 'a').map((a) => textOf(a)),
    ['Announcement↗'],
  );
});

test('a member with no details gets the muted fallback instead of sections', () => {
  const { tree } = renderProfile(BARE_MEMBER);
  assert.deepEqual(
    findAllByType(tree, 'h3').map((h) => textOf(h)),
    ['Sources'],
  );
  assert.match(
    textOf(findByClass(tree, 'bioMuted')),
    /^Public details for Example Org Holdings are limited to award announcements\./,
  );
  assert.equal(textOf(findByClass(tree, 'profileMeta')), '');
  assert.equal(
    textOf(findByClass(tree, 'initialsLarge')),
    initials(BARE_MEMBER.name),
  );
});

test('sources are listed with the scheme and trailing slash stripped', () => {
  const { tree } = renderProfile(MEMBER_WITH_AWARDS);
  const list = findAllByClass(tree, 'linkList').at(-1);
  const items = liItems(list);
  assert.equal(items.length, MEMBER_WITH_AWARDS.sourceAttribution.length);
  for (const [index, item] of items.entries()) {
    const url = MEMBER_WITH_AWARDS.sourceAttribution[index];
    assert.equal(item.key, url);
    const anchor = findByType(item, 'a');
    assert.equal(anchor.props.href, url);
    assert.equal(
      textOf(anchor),
      `${url.replace(/^https:\/\//, '').replace(/\/$/, '')}↗`,
    );
  }
});

test('the dialog logo uses the base URL, or initials when there is none', () => {
  const withLogo = renderProfile(RICH_MEMBER);
  assert.equal(
    findByClass(withLogo.tree, 'profileLogo').props.src,
    RICH_MEMBER.logo,
  );
  assert.equal(findByClass(withLogo.tree, 'profileLogo').props.alt, '');
  assert.equal(findByClass(withLogo.tree, 'initialsLarge'), undefined);

  const withoutLogo = renderProfile(MEMBER_WITHOUT_LOGO);
  assert.equal(findByClass(withoutLogo.tree, 'profileLogo'), undefined);
  assert.equal(
    textOf(findByClass(withoutLogo.tree, 'initialsLarge')),
    initials(MEMBER_WITHOUT_LOGO.name),
  );
});

test('the dialog installs a focus trap that is wired to the close button', () => {
  const { tree, effects } = renderProfile(RICH_MEMBER);
  assert.equal(effects.length, 1, 'useFocusTrap registers exactly one effect');
  assert.ok(findByClass(tree, 'dialog').props.ref);
  assert.ok(findByClass(tree, 'closeButton').props.ref);
});

// --- link hygiene ---------------------------------------------------------

test('every outbound link in a card or dialog is safely targeted', () => {
  const trees = [
    render(MemberDirectory).tree,
    DirectoryFreshness(),
    openProfile(RICH_MEMBER).tree,
    renderProfile(RICH_MEMBER).tree,
    renderProfile(MEMBER_WITH_AWARDS).tree,
    renderProfile(BARE_MEMBER).tree,
  ];

  let checked = 0;
  for (const tree of trees) {
    for (const anchor of findAllByType(tree, 'a')) {
      const { href, target, rel } = anchor.props;
      if (!/^https?:/.test(href ?? '')) continue;
      checked += 1;
      assert.equal(target, '_blank', `${href} is not opened in a new tab`);
      assert.match(
        rel ?? '',
        /noreferrer/,
        `${href} is missing rel=noreferrer`,
      );
    }
  }
  assert.ok(checked > 0, 'no outbound links were examined');
});
