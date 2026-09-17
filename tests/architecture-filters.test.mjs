import assert from 'node:assert/strict';
import test from 'node:test';

import { importSource } from './helpers-jsx.mjs';

const { filterArchitectures } = await importSource(
  'src/components/ArchitectureFilters/index.js',
);

const NO_FILTERS = { query: '', industry: '', project: '', organization: '' };

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
    industries: ['Manufacturing'],
    projects: ['KubeEdge', 'Kubernetes'],
  }),
  architecture({
    organization: 'Initech',
    title: 'Observability rollout',
    summary: 'Unifying metrics and traces.',
    industries: ['Financial Services', 'Retail'],
    projects: ['Prometheus'],
  }),
];

function titles(results) {
  return results.map((entry) => entry.title);
}

test('returns every architecture when no filter is set', () => {
  const result = filterArchitectures(CORPUS, NO_FILTERS);
  assert.deepEqual(titles(result), titles(CORPUS));
});

test('does not mutate or alias the input array', () => {
  const input = [...CORPUS];
  const result = filterArchitectures(input, NO_FILTERS);
  assert.notEqual(result, input);
  assert.equal(input.length, CORPUS.length);
});

test('query matches organization, title and summary', () => {
  for (const [query, expected] of [
    ['globex', ['Edge inference']],
    ['observability', ['Observability rollout']],
    ['clusters', ['Multi-cluster platform']],
  ]) {
    const result = filterArchitectures(CORPUS, { ...NO_FILTERS, query });
    assert.deepEqual(titles(result), expected, `query=${query}`);
  }
});

test('query is case-insensitive and ignores surrounding whitespace', () => {
  const result = filterArchitectures(CORPUS, {
    ...NO_FILTERS,
    query: '  EDGE Inference  ',
  });
  assert.deepEqual(titles(result), ['Edge inference']);
});

test('a whitespace-only query is treated as no query', () => {
  const result = filterArchitectures(CORPUS, { ...NO_FILTERS, query: '   ' });
  assert.deepEqual(titles(result), titles(CORPUS));
});

test('a query matching nothing returns an empty list', () => {
  const result = filterArchitectures(CORPUS, {
    ...NO_FILTERS,
    query: 'mainframe',
  });
  assert.deepEqual(result, []);
});

test('query does not match industry or project names', () => {
  // Only organization, title and summary are searchable; a project name that
  // appears in no other field must not produce a hit.
  const result = filterArchitectures(CORPUS, {
    ...NO_FILTERS,
    query: 'prometheus',
  });
  assert.deepEqual(result, []);
});

test('industry filter keeps architectures listing that industry', () => {
  const result = filterArchitectures(CORPUS, {
    ...NO_FILTERS,
    industry: 'Retail',
  });
  assert.deepEqual(titles(result), [
    'Multi-cluster platform',
    'Observability rollout',
  ]);
});

test('project filter matches any entry in the project list', () => {
  const result = filterArchitectures(CORPUS, {
    ...NO_FILTERS,
    project: 'Kubernetes',
  });
  assert.deepEqual(titles(result), [
    'Multi-cluster platform',
    'Edge inference',
  ]);
});

test('organization filter requires an exact match', () => {
  assert.deepEqual(
    titles(
      filterArchitectures(CORPUS, { ...NO_FILTERS, organization: 'Globex' }),
    ),
    ['Edge inference'],
  );
  assert.deepEqual(
    filterArchitectures(CORPUS, { ...NO_FILTERS, organization: 'globex' }),
    [],
  );
});

test('industry and project filters require an exact match too', () => {
  assert.deepEqual(
    filterArchitectures(CORPUS, { ...NO_FILTERS, industry: 'retail' }),
    [],
  );
  assert.deepEqual(
    filterArchitectures(CORPUS, { ...NO_FILTERS, project: 'Kube' }),
    [],
  );
});

test('filters combine as AND', () => {
  const result = filterArchitectures(CORPUS, {
    query: 'edge',
    industry: 'Manufacturing',
    project: 'Kubernetes',
    organization: 'Globex',
  });
  assert.deepEqual(titles(result), ['Edge inference']);
});

test('combined filters that no architecture satisfies return nothing', () => {
  const result = filterArchitectures(CORPUS, {
    ...NO_FILTERS,
    industry: 'Manufacturing',
    project: 'Prometheus',
  });
  assert.deepEqual(result, []);
});

test('an empty corpus stays empty', () => {
  assert.deepEqual(filterArchitectures([], { ...NO_FILTERS, query: 'x' }), []);
});
