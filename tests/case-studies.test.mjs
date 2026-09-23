// Render contract for src/components/CaseStudies/index.js.
//
// The component bakes `@site/data/case-studies.json` in at module scope and
// keeps every filter in local state, so neither the filtering predicate nor
// the option lists are reachable as exports. Driving the component through
// React's hook dispatcher is therefore the only way to cover them, and it has
// the side benefit of asserting the rendered table against the real mirrored
// data rather than a fixture that can drift from it.

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

const CaseStudies = (await importSource('src/components/CaseStudies/index.js'))
  .default;
const data = (await importSource('data/case-studies.json')).default;

const STUDIES = data.caseStudies ?? [];

// React routes useState/useMemo through a per-render "dispatcher" slot.
// Swapping that slot lets a plain Node test render a function component with
// no renderer and no DOM; the slot is restored as soon as the render returns,
// so it never leaks into another test in this process.
const Internals =
  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false;
  return a.length === b.length && a.every((dep, i) => Object.is(dep, b[i]));
}

/**
 * Renders a component that uses only useState and useMemo, re-rendering
 * synchronously whenever a state setter is called.
 *
 * @param {Function} Component component under test
 * @returns {{ tree: any }} live view of the most recent element tree
 */
function render(Component) {
  const states = [];
  const memos = [];
  const view = { tree: null };

  function run() {
    let stateSlot = 0;
    let memoSlot = 0;
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
      useMemo(create, deps) {
        const slot = memoSlot++;
        const previous = memos[slot];
        if (previous && sameDeps(previous.deps, deps)) return previous.value;
        const value = create();
        memos[slot] = { deps, value };
        return value;
      },
    };
    try {
      view.tree = Component();
    } finally {
      Internals.H = previousDispatcher;
    }
  }

  run();
  return view;
}

function elementById(tree, id) {
  for (const element of walkElements(tree)) {
    if (element.props?.id === id) return element;
  }
  return undefined;
}

/** Fires an onChange handler the way a DOM change event would. */
function change(element, value) {
  element.props.onChange({ target: { value } });
}

/** Every option value a <select> offers, excluding its "all" placeholder. */
function optionValues(select) {
  return findAllByType(select, 'option')
    .map((option) => option.props.value)
    .filter(Boolean);
}

/** The organization cell of every rendered body row, in document order. */
function renderedOrganizations(view) {
  const body = findByType(view.tree, 'tbody');
  return findAllByType(body, 'tr').map((row) => textOf(findByType(row, 'th')));
}

function resultsText(view) {
  const live = [...walkElements(view.tree)].find(
    (element) => element.props?.['aria-live'] === 'polite',
  );
  return textOf(live);
}

function clearButton(view) {
  return findAllByType(view.tree, 'button').find(
    (button) => textOf(button) === 'Clear filters',
  );
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

test('the mirrored data set is non-empty, so these assertions are meaningful', () => {
  assert.ok(STUDIES.length > 0, 'data/case-studies.json has no caseStudies');
});

test('renders one table row per case study before any filter is applied', () => {
  const view = render(CaseStudies);
  assert.equal(renderedOrganizations(view).length, STUDIES.length);
  assert.equal(
    resultsText(view),
    `Showing ${STUDIES.length} of ${STUDIES.length} case studies`,
  );
});

test('each row links to the case study URL and cannot reach back via opener', () => {
  const view = render(CaseStudies);
  const body = findByType(view.tree, 'tbody');
  const rows = findAllByType(body, 'tr');
  assert.equal(rows.length, STUDIES.length);

  rows.forEach((row, index) => {
    const study = STUDIES[index];
    const link = findByType(row, 'a');
    assert.equal(link.props.href, study.url);
    assert.equal(textOf(link), study.organization);
    assert.equal(link.props.target, '_blank');
    assert.equal(link.props.rel, 'noreferrer');

    const cells = findAllByType(row, 'td');
    assert.deepEqual(cells.map(textOf), [
      study.projects.join(', '),
      study.industries.join(', '),
      study.countries.join(', '),
    ]);
  });
});

test('row headers are scoped so screen readers announce the organization', () => {
  const view = render(CaseStudies);
  const body = findByType(view.tree, 'tbody');
  for (const row of findAllByType(body, 'tr')) {
    assert.equal(findByType(row, 'th').props.scope, 'row');
  }
  const head = findByType(view.tree, 'thead');
  assert.deepEqual(findAllByType(head, 'th').map(textOf), [
    'Organization',
    'Projects',
    'Industry',
    'Country',
  ]);
});

test('each filter select offers the deduplicated, sorted values from the data', () => {
  const view = render(CaseStudies);
  for (const [id, key] of [
    ['case-study-project', 'projects'],
    ['case-study-industry', 'industries'],
    ['case-study-country', 'countries'],
  ]) {
    const select = elementById(view.tree, id);
    assert.deepEqual(
      optionValues(select),
      uniqueSorted(STUDIES.flatMap((study) => study[key])),
      `${id} options do not match the ${key} in the data`,
    );
    const [placeholder] = findAllByType(select, 'option');
    assert.equal(placeholder.props.value, '');
  }
});

test('every control is labelled by a label bound to its id', () => {
  const view = render(CaseStudies);
  const labelled = new Set(
    findAllByType(view.tree, 'label').map((label) => label.props.htmlFor),
  );
  for (const id of [
    'case-study-search',
    'case-study-project',
    'case-study-industry',
    'case-study-country',
  ]) {
    assert.ok(elementById(view.tree, id), `no control with id ${id}`);
    assert.ok(labelled.has(id), `no <label for="${id}">`);
  }
});

test('the search box filters on organization, case-insensitively', () => {
  const view = render(CaseStudies);
  const target = STUDIES[0].organization;
  change(elementById(view.tree, 'case-study-search'), target.toUpperCase());

  const expected = STUDIES.filter((study) =>
    study.organization.toLowerCase().includes(target.toLowerCase()),
  ).map((study) => study.organization);
  assert.deepEqual(renderedOrganizations(view), expected);
  assert.equal(
    resultsText(view),
    `Showing ${expected.length} of ${STUDIES.length} case studies`,
  );
});

test('surrounding whitespace in the query is ignored', () => {
  const view = render(CaseStudies);
  const target = STUDIES[0].organization;

  change(elementById(view.tree, 'case-study-search'), target);
  const trimmedMatches = renderedOrganizations(view);

  change(elementById(view.tree, 'case-study-search'), `   ${target}   `);
  assert.deepEqual(renderedOrganizations(view), trimmedMatches);
});

test('a whitespace-only query is not treated as an active filter', () => {
  const view = render(CaseStudies);
  change(elementById(view.tree, 'case-study-search'), '    ');
  assert.equal(renderedOrganizations(view).length, STUDIES.length);
  assert.equal(clearButton(view), undefined);
});

test('each select narrows the table to studies carrying that value', () => {
  for (const [id, key] of [
    ['case-study-project', 'projects'],
    ['case-study-industry', 'industries'],
    ['case-study-country', 'countries'],
  ]) {
    const view = render(CaseStudies);
    const value = optionValues(elementById(view.tree, id))[0];
    change(elementById(view.tree, id), value);

    const expected = STUDIES.filter((study) => study[key].includes(value)).map(
      (study) => study.organization,
    );
    assert.ok(expected.length > 0, `no study carries ${key}=${value}`);
    assert.deepEqual(renderedOrganizations(view), expected);
  }
});

test('filters intersect rather than union', () => {
  const study = STUDIES.find(
    (entry) =>
      entry.projects.length > 0 &&
      entry.industries.length > 0 &&
      entry.countries.length > 0,
  );
  assert.ok(study, 'no case study carries all three facets');

  const view = render(CaseStudies);
  change(elementById(view.tree, 'case-study-project'), study.projects[0]);
  change(elementById(view.tree, 'case-study-industry'), study.industries[0]);
  change(elementById(view.tree, 'case-study-country'), study.countries[0]);

  const expected = STUDIES.filter(
    (entry) =>
      entry.projects.includes(study.projects[0]) &&
      entry.industries.includes(study.industries[0]) &&
      entry.countries.includes(study.countries[0]),
  ).map((entry) => entry.organization);
  assert.deepEqual(renderedOrganizations(view), expected);
  assert.ok(expected.includes(study.organization));
});

test('an unmatchable query renders the empty state and no rows', () => {
  const view = render(CaseStudies);
  change(
    elementById(view.tree, 'case-study-search'),
    'no-such-organization-zzz',
  );

  assert.deepEqual(renderedOrganizations(view), []);
  assert.equal(
    resultsText(view),
    `Showing 0 of ${STUDIES.length} case studies`,
  );
  const empty = [...walkElements(view.tree)].find(
    (element) =>
      element.type === 'p' && textOf(element).startsWith('No case studies'),
  );
  assert.ok(empty, 'the empty state paragraph was not rendered');
});

test('the empty state is absent while at least one row matches', () => {
  const view = render(CaseStudies);
  const empty = [...walkElements(view.tree)].find(
    (element) =>
      element.type === 'p' && textOf(element).startsWith('No case studies'),
  );
  assert.equal(empty, undefined);
});

test('Clear filters appears only once a filter is active and resets every control', () => {
  const view = render(CaseStudies);
  assert.equal(clearButton(view), undefined);

  change(elementById(view.tree, 'case-study-search'), 'acme');
  change(
    elementById(view.tree, 'case-study-project'),
    optionValues(elementById(view.tree, 'case-study-project'))[0],
  );
  const button = clearButton(view);
  assert.ok(button, 'Clear filters was not rendered while filters were active');
  assert.equal(button.props.type, 'button');

  button.props.onClick();

  assert.equal(elementById(view.tree, 'case-study-search').props.value, '');
  for (const id of [
    'case-study-project',
    'case-study-industry',
    'case-study-country',
  ]) {
    assert.equal(elementById(view.tree, id).props.value, '');
  }
  assert.equal(renderedOrganizations(view).length, STUDIES.length);
  assert.equal(clearButton(view), undefined);
});

test('the sync status credits the upstream source with a safe outbound link', () => {
  const view = render(CaseStudies);
  const syncStatus = [...walkElements(view.tree)].find(
    (element) => typeof element.type === 'function',
  );
  assert.ok(syncStatus, 'the sync status component was not rendered');

  const rendered = syncStatus.type(syncStatus.props ?? {});
  if (!data.generatedAt) {
    assert.equal(rendered, null);
    return;
  }

  const link = findByType(rendered, 'a');
  assert.equal(link.props.href, data.sourceUrl);
  assert.equal(link.props.target, '_blank');
  assert.equal(link.props.rel, 'noreferrer');
  assert.match(
    textOf(rendered),
    /^Mirrored from cncf\.io\/case-studies on .+\.$/,
  );
  assert.ok(
    textOf(rendered).includes(
      new Date(data.generatedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    ),
  );
});

test('the region is labelled and the result count is announced politely', () => {
  const view = render(CaseStudies);
  assert.equal(view.tree.type, 'section');
  assert.equal(view.tree.props['aria-label'], 'CNCF case studies');
  assert.match(resultsText(view), /^Showing \d+ of \d+ case studies$/);
});
