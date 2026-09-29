import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptInSandbox } from './helpers-script-sandbox.mjs';

const OUTPUT = 'data/case-studies.json';

// The case-study query string embeds `lf-project`, `lf-industry` and
// `lf-country` in `_fields`, so its route must be declared before the taxonomy
// routes: the sandbox stub matches by substring in declaration order.
const CASE_STUDY_ROUTE = 'lf_case_study';

function term(id, name) {
  return { id, name };
}

function post(overrides = {}) {
  return {
    id: 1,
    slug: 'acme',
    link: 'https://www.cncf.io/case-studies/acme/',
    title: { rendered: 'Acme' },
    date: '2024-03-04T05:06:07',
    'lf-project': [],
    'lf-industry': [],
    'lf-country': [],
    ...overrides,
  };
}

function taxonomyRoutes({
  projects = [term(10, 'Kubernetes')],
  industries = [term(20, 'Finance')],
  countries = [term(30, 'Germany')],
} = {}) {
  return [
    { match: 'lf-project', body: projects },
    { match: 'lf-industry', body: industries },
    { match: 'lf-country', body: countries },
  ];
}

function collect(routes, { outputs = [OUTPUT], fixtures = {} } = {}) {
  return runScriptInSandbox({
    script: 'collect-case-studies.mjs',
    routes,
    fixtures,
    outputs,
  });
}

function readCatalog(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.outputs[OUTPUT]);
}

test('writes a case-study catalog with resolved taxonomy names', () => {
  const result = collect([
    {
      match: CASE_STUDY_ROUTE,
      body: [
        post({
          id: 7,
          slug: 'zeta',
          title: { rendered: 'Zeta' },
          meta: {
            lf_case_study_long_title:
              'Zeta Cuts Deploy Times in Half with Argo',
          },
          'lf-project': [11, 10],
          'lf-industry': [20],
          'lf-country': [30],
        }),
      ],
    },
    ...taxonomyRoutes({
      projects: [term(10, 'Kubernetes'), term(11, 'Argo')],
    }),
  ]);

  const catalog = readCatalog(result);
  assert.equal(catalog.source, 'cncf.io case studies');
  assert.equal(catalog.sourceUrl, 'https://www.cncf.io/case-studies/');
  assert.equal(
    catalog.apiUrl,
    'https://www.cncf.io/wp-json/wp/v2/lf_case_study',
  );
  assert.match(catalog.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(catalog.description, /do not hand-edit/);
  assert.deepEqual(catalog.caseStudies, [
    {
      id: 7,
      title: 'Zeta Cuts Deploy Times in Half with Argo',
      organization: 'Zeta',
      slug: 'zeta',
      url: 'https://www.cncf.io/case-studies/acme/',
      publishedAt: '2024-03-04',
      // Term names are sorted by name, not by the order of the incoming ids.
      projects: ['Argo', 'Kubernetes'],
      industries: ['Finance'],
      countries: ['Germany'],
    },
  ]);
  assert.match(result.stdout, /Collected 1 case studies at /);
});

test('falls back to the organization name when the long title meta is missing or blank', () => {
  const result = collect([
    {
      match: CASE_STUDY_ROUTE,
      body: [
        post({ id: 1, slug: 'no-meta', title: { rendered: 'No Meta' } }),
        post({
          id: 2,
          slug: 'blank-meta',
          title: { rendered: 'Blank Meta' },
          meta: { lf_case_study_long_title: '   ' },
        }),
      ],
    },
    ...taxonomyRoutes(),
  ]);

  assert.deepEqual(
    readCatalog(result).caseStudies.map((entry) => entry.title),
    ['Blank Meta', 'No Meta'],
  );
});

test('decodes HTML entities in the long title meta', () => {
  const result = collect([
    {
      match: CASE_STUDY_ROUTE,
      body: [
        post({
          id: 1,
          slug: 'entities',
          title: { rendered: 'Cilium Co' },
          meta: {
            lf_case_study_long_title: 'Cilium&#8217;s Networking &amp; Scale',
          },
        }),
      ],
    },
    ...taxonomyRoutes(),
  ]);

  assert.deepEqual(
    readCatalog(result).caseStudies.map((entry) => entry.title),
    ['Cilium\u2019s Networking & Scale'],
  );
});

test('sorts case studies by organization name', () => {
  const result = collect([
    {
      match: CASE_STUDY_ROUTE,
      body: [
        post({ id: 1, slug: 'mid', title: { rendered: 'Mango' } }),
        post({ id: 2, slug: 'last', title: { rendered: 'Zulu' } }),
        post({ id: 3, slug: 'first', title: { rendered: 'Apple' } }),
      ],
    },
    ...taxonomyRoutes(),
  ]);

  assert.deepEqual(
    readCatalog(result).caseStudies.map((entry) => entry.organization),
    ['Apple', 'Mango', 'Zulu'],
  );
});

test('decodes HTML entities in organization names', () => {
  const result = collect([
    {
      match: CASE_STUDY_ROUTE,
      body: [
        post({ id: 1, slug: 'amp', title: { rendered: 'Acme &amp; Co' } }),
        post({ id: 2, slug: 'num', title: { rendered: 'Beta &#038; Sons' } }),
        post({ id: 3, slug: 'quote', title: { rendered: 'Cilium&#8217;s' } }),
        post({ id: 4, slug: 'dash', title: { rendered: 'Delta &#8211; EU' } }),
        post({ id: 5, slug: 'em', title: { rendered: 'Echo &#8212; NA' } }),
      ],
    },
    ...taxonomyRoutes(),
  ]);

  assert.deepEqual(
    readCatalog(result).caseStudies.map((entry) => entry.organization),
    [
      'Acme & Co',
      'Beta & Sons',
      'Cilium\u2019s',
      'Delta \u2013 EU',
      'Echo \u2014 NA',
    ],
  );
});

test('falls back to the slug and tolerates missing date and term ids', () => {
  const result = collect([
    {
      match: CASE_STUDY_ROUTE,
      body: [
        post({
          id: 1,
          slug: 'no-title',
          title: undefined,
          date: null,
          'lf-project': undefined,
          'lf-industry': [999],
          'lf-country': [30, 998],
        }),
        post({ id: 2, slug: 'blank-title', title: { rendered: '   ' } }),
      ],
    },
    ...taxonomyRoutes(),
  ]);

  const [fallback, blank] = readCatalog(result).caseStudies;
  assert.equal(fallback.organization, 'blank-title');
  assert.equal(blank.organization, 'no-title');
  assert.equal(blank.publishedAt, null);
  assert.deepEqual(blank.projects, []);
  // Unknown term ids are dropped rather than emitted as null entries.
  assert.deepEqual(blank.industries, []);
  assert.deepEqual(blank.countries, ['Germany']);
});

test('follows x-wp-totalpages pagination', () => {
  const result = collect([
    {
      match: '&page=2',
      body: [post({ id: 2, slug: 'page-two', title: { rendered: 'Bravo' } })],
      headers: { 'x-wp-totalpages': '2' },
    },
    {
      match: CASE_STUDY_ROUTE,
      body: [post({ id: 1, slug: 'page-one', title: { rendered: 'Alpha' } })],
      headers: { 'x-wp-totalpages': '2' },
    },
    ...taxonomyRoutes(),
  ]);

  assert.deepEqual(
    readCatalog(result).caseStudies.map((entry) => entry.slug),
    ['page-one', 'page-two'],
  );
});

test('stops paginating when the API rejects a page past the last one', () => {
  const result = collect([
    { match: '&page=2', status: 400 },
    {
      match: CASE_STUDY_ROUTE,
      body: [post({ id: 1, slug: 'only', title: { rendered: 'Only' } })],
      // WordPress advertises more pages than it will serve; the 400 on page 2
      // is the real end of the catalog and must not fail the run.
      headers: { 'x-wp-totalpages': '5' },
    },
    ...taxonomyRoutes(),
  ]);

  assert.deepEqual(
    readCatalog(result).caseStudies.map((entry) => entry.slug),
    ['only'],
  );
});

test('fails the run when the first page errors', () => {
  const result = collect([
    { match: CASE_STUDY_ROUTE, status: 500 },
    ...taxonomyRoutes(),
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cncf\.io API 500: lf_case_study/);
  assert.equal(result.outputs[OUTPUT], null);
});

test('fails the run when a 400 arrives on the first page', () => {
  const result = collect([
    { match: CASE_STUDY_ROUTE, status: 400 },
    ...taxonomyRoutes(),
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cncf\.io API 400: lf_case_study.*\(page 1\)/);
  assert.equal(result.outputs[OUTPUT], null);
});

test('stops paginating when a page returns an empty batch', () => {
  const result = collect([
    { match: '&page=2', body: [], headers: { 'x-wp-totalpages': '9' } },
    {
      match: CASE_STUDY_ROUTE,
      body: [post({ id: 1, slug: 'solo', title: { rendered: 'Solo' } })],
      headers: { 'x-wp-totalpages': '9' },
    },
    ...taxonomyRoutes(),
  ]);

  assert.deepEqual(
    readCatalog(result).caseStudies.map((entry) => entry.slug),
    ['solo'],
  );
});

test('leaves the catalog untouched when nothing changed (matches #648)', () => {
  const routes = [
    {
      match: CASE_STUDY_ROUTE,
      body: [post({ id: 1, slug: 'stable', title: { rendered: 'Stable' } })],
    },
    ...taxonomyRoutes(),
  ];

  const first = collect(routes);
  assert.equal(first.status, 0, first.stderr);
  const firstCatalog = JSON.parse(first.outputs[OUTPUT]);

  // Re-run against the exact catalog the first run produced, as a maintainer
  // would the next time they run `npm run collect:case-studies` against
  // unchanged upstream content.
  const second = collect(routes, {
    fixtures: { [OUTPUT]: first.outputs[OUTPUT] },
  });

  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /No case study changes detected/);
  // The file on disk -- including generatedAt -- must be byte-for-byte the
  // same; a second run must not open a no-op refresh PR.
  assert.equal(second.outputs[OUTPUT], first.outputs[OUTPUT]);
  assert.equal(
    JSON.parse(second.outputs[OUTPUT]).generatedAt,
    firstCatalog.generatedAt,
  );
});

test('treats an existing catalog without a caseStudies key as empty', () => {
  // A hand-edited or partially written data/case-studies.json can lack the
  // key entirely. Reading it must yield an empty list rather than undefined,
  // so the "nothing changed" comparison against an empty upstream still holds
  // and the run leaves the file alone instead of rewriting generatedAt.
  const existing = JSON.stringify({ generatedAt: '2024-01-01T00:00:00.000Z' });
  const result = collect(
    [{ match: CASE_STUDY_ROUTE, body: [] }, ...taxonomyRoutes()],
    { fixtures: { [OUTPUT]: existing } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No case study changes detected/);
  assert.equal(result.outputs[OUTPUT], existing);
});
