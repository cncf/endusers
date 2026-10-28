// Render contract for the `selects` option list of
// src/components/shared/FilterToolbar.js.
//
// FilterToolbar accepts two option shapes: a bare string, where the value and
// the visible label are the same token, and a `{ value, label }` pair, where
// they deliberately differ. Only MemberDirectory passes the pair shape (its
// `MEMBERSHIP_FILTERS`, e.g. value `unknown` shown as "Membership not
// specified"); CaseStudies and ArchitectureFilters pass bare strings.
//
// Every existing assertion over a rendered `<select>` reads option *values*
// (tests/member-directory.test.mjs `optionValues`) or drives `onChange`
// directly, so collapsing the component's `typeof option === 'string'`
// ternary to one arm leaves the membership dropdown rendering raw values with
// the whole unit suite still green. These tests read the labels, so that
// regression fails here.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importSource } from './helpers-jsx.mjs';
import {
  findAllByType,
  findByType,
  textOf,
} from './tools/react-element-tree.mjs';

const FilterToolbar = (
  await importSource('src/components/shared/FilterToolbar.js')
).default;

const { MEMBERSHIP_FILTERS } = await importSource(
  'src/components/MemberDirectory/hooks.js',
);

/** Renders the toolbar with a single `<select>` built from `options`. */
function renderToolbar(options, overrides = {}) {
  const calls = [];
  const tree = FilterToolbar({
    searchId: 'toolbar-search',
    searchLabel: 'Search the catalog',
    searchValue: '',
    searchPlaceholder: 'Search',
    onSearchChange: (value) => calls.push(['search', value]),
    resultCount: 1,
    totalCount: 2,
    resultNoun: 'entries',
    activeCount: 0,
    onClear: () => calls.push(['clear']),
    selects: [
      {
        id: 'toolbar-filter',
        label: 'Filter entries',
        value: '',
        onChange: (value) => calls.push(['filter', value]),
        options,
        allLabel: 'All entries',
      },
    ],
    ...overrides,
  });
  return { tree, calls };
}

function optionEntries(options) {
  return findAllByType(renderToolbar(options).tree, 'option').map((option) => ({
    value: option.props.value,
    label: textOf(option),
  }));
}

test('string options use the same token as value and as visible label', () => {
  assert.deepEqual(optionEntries(['retail', 'manufacturing']), [
    { value: '', label: 'All entries' },
    { value: 'retail', label: 'retail' },
    { value: 'manufacturing', label: 'manufacturing' },
  ]);
});

test('object options render their label, not their value', () => {
  assert.deepEqual(optionEntries(MEMBERSHIP_FILTERS), [
    { value: '', label: 'All entries' },
    { value: 'member', label: 'End User Members' },
    { value: 'contributor', label: 'End User Contributors' },
    { value: 'unknown', label: 'Membership not specified' },
  ]);
});

test('a select may mix both option shapes in one list', () => {
  assert.deepEqual(
    optionEntries(['retail', { value: 'unknown', label: 'Not specified' }]),
    [
      { value: '', label: 'All entries' },
      { value: 'retail', label: 'retail' },
      { value: 'unknown', label: 'Not specified' },
    ],
  );
});

test('a select without an allLabel renders only its own options', () => {
  const { tree } = renderToolbar(['newest', 'oldest']);
  const { tree: noAll } = renderToolbar([], {
    selects: [
      {
        id: 'toolbar-sort',
        label: 'Sort entries',
        value: 'newest',
        onChange: () => {},
        options: ['newest', 'oldest'],
      },
    ],
  });
  assert.equal(findAllByType(tree, 'option').length, 3);
  assert.deepEqual(
    findAllByType(noAll, 'option').map((option) => option.props.value),
    ['newest', 'oldest'],
  );
});

test('every option keys off its value, so labels may repeat', () => {
  const { tree } = renderToolbar([
    { value: 'a', label: 'Shared label' },
    { value: 'b', label: 'Shared label' },
  ]);
  assert.deepEqual(
    findAllByType(tree, 'option')
      .map((option) => option.key)
      .filter((key) => key !== null),
    ['a', 'b'],
  );
});

test('the search box and each select report the changed value, not the event', () => {
  const { tree, calls } = renderToolbar(['retail']);
  findByType(tree, 'input').props.onChange({ target: { value: ' acme ' } });
  findByType(tree, 'select').props.onChange({ target: { value: 'retail' } });
  assert.deepEqual(calls, [
    ['search', ' acme '],
    ['filter', 'retail'],
  ]);
});

test('Clear filters renders only while a filter is active, and resets', () => {
  assert.equal(
    findAllByType(renderToolbar(['retail']).tree, 'button').length,
    0,
    'Clear filters rendered with no active filter',
  );

  const { tree, calls } = renderToolbar(['retail'], { activeCount: 1 });
  const button = findByType(tree, 'button');
  assert.equal(button.props.type, 'button');
  assert.equal(textOf(button), 'Clear filters');
  button.props.onClick();
  assert.deepEqual(calls, [['clear']]);
});
