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
  renderElement,
  textOf,
} from './tools/react-element-tree.mjs';

const {
  default: ArchitectureFilters,
  useArchitectureFilterOptions,
  useArchitectureFilters,
  SORT_OPTIONS,
} = await importSource('src/components/ArchitectureFilters/index.js');
const { default: FilterToolbar } = await importSource(
  'src/components/shared/FilterToolbar.js',
);

function architecture(overrides = {}) {
  return {
    organization: 'Acme Corp',
    title: 'Multi-cluster platform',
    summary: 'Running fleets of clusters across regions.',
    industries: ['Retail'],
    projects: ['Kubernetes'],
    tags: [],
    updated: '2026-01-15',
    ...overrides,
  };
}

const CORPUS = [
  architecture({ tags: ['Kubernetes', 'private cloud'] }),
  architecture({
    organization: 'Globex',
    title: 'Edge inference',
    summary: 'Serving models at the edge.',
    industries: ['Manufacturing', 'Retail'],
    projects: ['KubeEdge', 'Kubernetes'],
    tags: ['kubernetes', 'edge'],
    updated: '2026-06-01',
  }),
  architecture({
    organization: 'Initech',
    title: 'Observability rollout',
    summary: 'Unifying metrics and traces.',
    industries: ['Financial Services'],
    projects: ['Prometheus'],
    tags: ['observability'],
    updated: '2026-03-20',
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
  // Tags differing only in case are listed once, in their first-seen form.
  assert.deepEqual(result.tags, [
    'edge',
    'Kubernetes',
    'observability',
    'private cloud',
  ]);
});

test('tags differing only in separators are listed once', () => {
  const { result } = renderHook(() =>
    useArchitectureFilterOptions([
      architecture({ tags: ['public cloud'] }),
      architecture({
        tags: ['Public-Cloud', 'public_cloud', 'public - cloud'],
      }),
      // Separators are folded, not dropped: run-together words stay distinct.
      architecture({ tags: ['publiccloud'] }),
    ]),
  );
  assert.deepEqual(result.tags, ['public cloud', 'publiccloud']);
});

test('addTag selects a tag and removeTag drops it', () => {
  const hook = renderHook(() => useArchitectureFilters(CORPUS));

  hook.result.addTag('edge');
  hook.result.addTag('observability');

  assert.deepEqual(hook.result.filters.tags, ['edge', 'observability']);
  assert.equal(hook.result.activeCount, 1);
  assert.deepEqual(
    hook.result.filtered.map((a) => a.organization),
    ['Globex', 'Initech'],
  );

  hook.result.removeTag('edge');
  assert.deepEqual(hook.result.filters.tags, ['observability']);

  hook.result.clearFilters();
  assert.deepEqual(hook.result.filters.tags, []);
  assert.equal(hook.result.activeCount, 0);
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
    tags: [],
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
    tags: [],
  });
  assert.equal(hook.result.activeCount, 0);
  assert.equal(hook.result.filtered.length, CORPUS.length);
});

test('architectures are listed alphabetically until another sort is chosen', () => {
  const reversed = Array.from(CORPUS).reverse();
  const hook = renderHook(() => useArchitectureFilters(reversed));

  assert.equal(hook.result.sort, 'alphabetical');
  assert.deepEqual(
    hook.result.filtered.map((a) => a.organization),
    ['Acme Corp', 'Globex', 'Initech'],
  );

  hook.result.setSort('updated');

  assert.equal(hook.result.sort, 'updated');
  assert.deepEqual(
    hook.result.filtered.map((a) => a.organization),
    ['Globex', 'Initech', 'Acme Corp'],
  );
});

test('the sort order is not a filter: it is not counted and survives a clear', () => {
  const hook = renderHook(() => useArchitectureFilters(CORPUS));

  hook.result.setSort('updated');
  assert.equal(hook.result.activeCount, 0);

  hook.result.setIndustry('Retail');
  assert.deepEqual(
    hook.result.filtered.map((a) => a.organization),
    ['Globex', 'Acme Corp'],
  );

  hook.result.clearFilters();
  assert.equal(hook.result.sort, 'updated');
  assert.deepEqual(
    hook.result.filtered.map((a) => a.organization),
    ['Globex', 'Initech', 'Acme Corp'],
  );
});

const OPTIONS = {
  organizations: ['Acme Corp', 'Globex'],
  industries: ['Manufacturing', 'Retail'],
  projects: ['KubeEdge', 'Kubernetes'],
  tags: ['edge', 'GitOps', 'private cloud'],
};

const NO_FILTERS = {
  query: '',
  industry: '',
  project: '',
  organization: '',
  tags: [],
};

function render(overrides = {}) {
  const calls = [];
  const record = (name) => (value) => calls.push([name, value]);
  const element = ArchitectureFilters({
    options: OPTIONS,
    filters: NO_FILTERS,
    setQuery: record('setQuery'),
    setIndustry: record('setIndustry'),
    setProject: record('setProject'),
    setOrganization: record('setOrganization'),
    addTag: record('addTag'),
    removeTag: record('removeTag'),
    sort: 'alphabetical',
    setSort: record('setSort'),
    activeCount: 0,
    onClear: record('onClear'),
    resultCount: 2,
    totalCount: 7,
    ...overrides,
  });
  // The component composes the shared toolbar as a <FilterToolbar> element;
  // expand it through the harness so the assertions below see its markup.
  return { element, tree: renderElement(element), calls };
}

test('the toolbar is composed as a <FilterToolbar> JSX element', () => {
  const { element } = render();

  assert.equal(element.type, FilterToolbar);
  assert.equal(element.props.searchId, 'architecture-search');
});

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
    'architecture-tag',
    'architecture-sort',
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

test('the tag select adds unselected tags and always rests on its prompt', () => {
  const { tree, calls } = render({
    filters: { ...NO_FILTERS, tags: ['gitops'] },
  });
  const select = selectById(tree, 'architecture-tag');

  assert.equal(select.props.value, '');
  assert.deepEqual(
    findAllByType(select, 'option').map((option) => textOf(option)),
    ['Add a tag', 'edge', 'private cloud'],
  );

  select.props.onChange({ target: { value: 'edge' } });
  assert.deepEqual(calls, [['addTag', 'edge']]);
});

test('selected tags render as removable chips in the search box', () => {
  const { tree, calls } = render({
    filters: { ...NO_FILTERS, tags: ['edge', 'private cloud'] },
  });
  const list = findByType(tree, 'ul');
  assert.equal(list.props['aria-label'], 'Selected tags');

  const buttons = findAllByType(list, 'button');
  assert.deepEqual(
    buttons.map((button) => button.props['aria-label']),
    ['Remove tag edge', 'Remove tag private cloud'],
  );
  buttons[1].props.onClick({
    currentTarget: {
      ownerDocument: { getElementById: () => ({ focus() {} }) },
    },
  });
  assert.deepEqual(calls, [['removeTag', 'private cloud']]);
  assert.equal(
    findByType(tree, 'label').props.children,
    'Search architectures by organization, title, or tag',
  );
});

test('the sort select offers only the sort orders, with no "all" option', () => {
  const { tree, calls } = render({ sort: 'updated' });
  const select = selectById(tree, 'architecture-sort');

  assert.equal(select.props.value, 'updated');
  assert.deepEqual(
    findAllByType(select, 'option').map((option) => [
      option.props.value,
      textOf(option),
    ]),
    [
      ['alphabetical', 'Sort: Alphabetical'],
      ['updated', 'Sort: Recently updated'],
    ],
  );
  assert.deepEqual(
    SORT_OPTIONS.map((option) => option.value),
    ['alphabetical', 'updated'],
  );

  select.props.onChange({ target: { value: 'alphabetical' } });
  assert.deepEqual(calls, [['setSort', 'alphabetical']]);
});

test('each select is controlled by its own slice of the filter state', () => {
  const { tree } = render({
    filters: {
      query: '',
      organization: 'Globex',
      industry: 'Retail',
      project: 'KubeEdge',
      tags: [],
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

test('organizations are sorted even when the corpus lists them out of order', () => {
  const { result } = renderHook(() =>
    useArchitectureFilterOptions([
      architecture({
        organization: 'Zeta',
        industries: ['b'],
        projects: ['y'],
      }),
      architecture({
        organization: 'Alpha',
        industries: ['a'],
        projects: ['x'],
      }),
      architecture({
        organization: 'Alpha',
        industries: ['a'],
        projects: ['x'],
      }),
    ]),
  );
  assert.deepEqual(result.organizations, ['Alpha', 'Zeta']);
  assert.deepEqual(result.industries, ['a', 'b']);
  assert.deepEqual(result.projects, ['x', 'y']);
});

test('each hook setter writes its own filter field', () => {
  for (const [setter, field, value, expected] of [
    ['setIndustry', 'industry', 'Manufacturing', ['Globex']],
    ['setProject', 'project', 'Prometheus', ['Initech']],
    ['setOrganization', 'organization', 'Acme Corp', ['Acme Corp']],
    ['setQuery', 'query', 'traces', ['Initech']],
  ]) {
    const hook = renderHook(() => useArchitectureFilters(CORPUS));
    hook.result[setter](value);
    assert.deepEqual(hook.result.filters, {
      query: '',
      industry: '',
      project: '',
      organization: '',
      tags: [],
      [field]: value,
    });
    assert.deepEqual(
      hook.result.filtered.map((a) => a.organization),
      expected,
      setter,
    );
  }
});
