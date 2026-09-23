// The reference-architecture catalog is only browsable through this toolbar:
// the search box, the three <select> filters, the live result count and the
// "Clear filters" escape hatch. Only `filterArchitectures` had unit coverage —
// the two hooks that own the toolbar's state and the rendered controls
// themselves were untested, so a broken setter wiring, an unsorted or
// duplicated option list, a missing accessible label or a "Clear filters"
// button that never appears would all ship unnoticed.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importSource } from './helpers-jsx.mjs';
import { renderHook } from './tools/react-hook-driver.mjs';
import {
  findAllByType,
  findByType,
  textOf,
} from './tools/react-element-tree.mjs';

const {
  default: ArchitectureFilters,
  useArchitectureFilterOptions,
  useArchitectureFilters,
} = await importSource('src/components/ArchitectureFilters/index.js');

function architecture(overrides = {}) {
  return {
    organization: 'Acme Corp',
    title: 'Multi-cluster platform',
    summary: 'Running fleets of clusters across regions.',
    industries: ['Retail'],
    projects: ['Kubernetes'],
    ...overrides,
  };
}

const CORPUS = [
  architecture(),
  architecture({
    organization: 'Globex',
    title: 'Edge inference',
    summary: 'Serving models at the edge.',
    industries: ['Manufacturing', 'Retail'],
    projects: ['KubeEdge', 'Kubernetes'],
  }),
  architecture({
    organization: 'Initech',
    title: 'Observability rollout',
    summary: 'Unifying metrics and traces.',
    industries: ['Financial Services'],
    projects: ['Prometheus'],
  }),
];

test('option lists are de-duplicated and alphabetically sorted', () => {
  const { result } = renderHook(() => useArchitectureFilterOptions(CORPUS));

  assert.deepEqual(result.organizations, ['Acme Corp', 'Globex', 'Initech']);
  assert.deepEqual(result.industries, [
    'Financial Services',
    'Manufacturing',
    'Retail',
  ]);
  assert.deepEqual(result.projects, ['KubeEdge', 'Kubernetes', 'Prometheus']);
});

test('option lists are memoized while the architecture list is unchanged', () => {
  const hook = renderHook(() => useArchitectureFilterOptions(CORPUS));
  const first = hook.result;

  assert.equal(hook.rerender(), first);
});

test('option lists are recomputed when the architecture list changes', () => {
  let input = CORPUS;
  const hook = renderHook(() => useArchitectureFilterOptions(input));
  const first = hook.result;

  input = [architecture({ organization: 'Umbrella' })];
  const second = hook.rerender();

  assert.notEqual(second, first);
  assert.deepEqual(second.organizations, ['Umbrella']);
});

test('the toolbar starts unfiltered, with every architecture showing', () => {
  const { result } = renderHook(() => useArchitectureFilters(CORPUS));

  assert.deepEqual(result.filters, {
    query: '',
    industry: '',
    project: '',
    organization: '',
  });
  assert.equal(result.activeCount, 0);
  assert.equal(result.filtered.length, CORPUS.length);
});

test('setting a query narrows the results and counts as one active filter', () => {
  const hook = renderHook(() => useArchitectureFilters(CORPUS));

  hook.result.setQuery('globex');

  assert.equal(hook.result.filters.query, 'globex');
  assert.equal(hook.result.activeCount, 1);
  assert.deepEqual(
    hook.result.filtered.map((a) => a.organization),
    ['Globex'],
  );
});

test('a whitespace-only query is not counted as an active filter', () => {
  const hook = renderHook(() => useArchitectureFilters(CORPUS));

  hook.result.setQuery('   ');

  assert.equal(hook.result.activeCount, 0);
  assert.equal(hook.result.filtered.length, CORPUS.length);
});

test('the select filters compose, and each one counts as active', () => {
  const hook = renderHook(() => useArchitectureFilters(CORPUS));

  hook.result.setIndustry('Retail');
  hook.result.setProject('Kubernetes');
  hook.result.setOrganization('Globex');

  assert.equal(hook.result.activeCount, 3);
  assert.deepEqual(
    hook.result.filtered.map((a) => a.organization),
    ['Globex'],
  );
});

test('clearFilters resets every control at once', () => {
  const hook = renderHook(() => useArchitectureFilters(CORPUS));

  hook.result.setQuery('edge');
  hook.result.setIndustry('Retail');
  hook.result.setProject('Kubernetes');
  hook.result.setOrganization('Globex');
  assert.equal(hook.result.activeCount, 4);

  hook.result.clearFilters();

  assert.deepEqual(hook.result.filters, {
    query: '',
    industry: '',
    project: '',
    organization: '',
  });
  assert.equal(hook.result.activeCount, 0);
  assert.equal(hook.result.filtered.length, CORPUS.length);
});

const OPTIONS = {
  organizations: ['Acme Corp', 'Globex'],
  industries: ['Manufacturing', 'Retail'],
  projects: ['KubeEdge', 'Kubernetes'],
};

const NO_FILTERS = {
  query: '',
  industry: '',
  project: '',
  organization: '',
};

function render(overrides = {}) {
  const calls = [];
  const record = (name) => (value) => calls.push([name, value]);
  const tree = ArchitectureFilters({
    options: OPTIONS,
    filters: NO_FILTERS,
    setQuery: record('setQuery'),
    setIndustry: record('setIndustry'),
    setProject: record('setProject'),
    setOrganization: record('setOrganization'),
    activeCount: 0,
    onClear: record('onClear'),
    resultCount: 2,
    totalCount: 7,
    ...overrides,
  });
  return { tree, calls };
}

function selectById(tree, id) {
  return findAllByType(tree, 'select').find(
    (element) => element.props.id === id,
  );
}

test('every control carries a label bound to its own id', () => {
  const { tree } = render();
  const labels = findAllByType(tree, 'label');
  const controlIds = [
    'architecture-search',
    'architecture-organization',
    'architecture-industry',
    'architecture-project',
  ];

  assert.deepEqual(
    labels.map((label) => label.props.htmlFor),
    controlIds,
  );
  for (const label of labels) {
    assert.ok(
      textOf(label).trim().length > 0,
      `expected label ${label.props.htmlFor} to carry text`,
    );
  }
});

test('the search box is a controlled search input showing the current query', () => {
  const { tree } = render({ filters: { ...NO_FILTERS, query: 'edge' } });
  const input = findByType(tree, 'input');

  assert.equal(input.props.id, 'architecture-search');
  assert.equal(input.props.type, 'search');
  assert.equal(input.props.value, 'edge');
});

test('typing in the search box reports the new value to setQuery', () => {
  const { tree, calls } = render();

  findByType(tree, 'input').props.onChange({ target: { value: 'globex' } });

  assert.deepEqual(calls, [['setQuery', 'globex']]);
});

test('each select offers an "all" reset option ahead of its values', () => {
  const { tree } = render();

  for (const [id, key, allLabel] of [
    ['architecture-organization', 'organizations', 'All organizations'],
    ['architecture-industry', 'industries', 'All industries'],
    ['architecture-project', 'projects', 'All projects'],
  ]) {
    const options = findAllByType(selectById(tree, id), 'option');
    assert.deepEqual(options[0].props.value, '');
    assert.equal(textOf(options[0]), allLabel);
    assert.deepEqual(
      options.slice(1).map((option) => option.props.value),
      OPTIONS[key],
    );
  }
});

test('each select is controlled by its own slice of the filter state', () => {
  const { tree } = render({
    filters: {
      query: '',
      organization: 'Globex',
      industry: 'Retail',
      project: 'KubeEdge',
    },
  });

  assert.equal(
    selectById(tree, 'architecture-organization').props.value,
    'Globex',
  );
  assert.equal(selectById(tree, 'architecture-industry').props.value, 'Retail');
  assert.equal(
    selectById(tree, 'architecture-project').props.value,
    'KubeEdge',
  );
});

test('each select reports changes to its own setter', () => {
  const { tree, calls } = render();

  selectById(tree, 'architecture-organization').props.onChange({
    target: { value: 'Globex' },
  });
  selectById(tree, 'architecture-industry').props.onChange({
    target: { value: 'Retail' },
  });
  selectById(tree, 'architecture-project').props.onChange({
    target: { value: 'KubeEdge' },
  });

  assert.deepEqual(calls, [
    ['setOrganization', 'Globex'],
    ['setIndustry', 'Retail'],
    ['setProject', 'KubeEdge'],
  ]);
});

test('the result count is announced politely as it changes', () => {
  const { tree } = render({ resultCount: 2, totalCount: 7 });
  const status = findByType(tree, 'p');

  assert.equal(status.props['aria-live'], 'polite');
  assert.match(textOf(status), /Showing\s*2\s*of\s*7 architectures/);
});

test('no clear button is offered while nothing is filtered', () => {
  const { tree } = render({ activeCount: 0 });

  assert.deepEqual(findAllByType(tree, 'button'), []);
});

test('the clear button appears once a filter is active and calls onClear', () => {
  const { tree, calls } = render({ activeCount: 2 });
  const button = findByType(tree, 'button');

  assert.ok(button, 'expected a clear button while filters are active');
  assert.equal(
    button.props.type,
    'button',
    'a toolbar button inside a form must not submit',
  );
  assert.match(textOf(button), /Clear filters/);

  button.props.onClick();
  assert.deepEqual(calls, [['onClear', undefined]]);
});
