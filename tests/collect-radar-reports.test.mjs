import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptInSandbox } from './helpers-script-sandbox.mjs';

const OUTPUT = 'data/radar-reports.json';
const PLACEHOLDER_SUMMARY = 'Summary needed \u2014 see the report for details.';

// `lf_report` (underscore) never appears in the taxonomy request URL
// (`lf-report-type`, hyphen), so the two routes cannot collide.
const POSTS_ROUTE = 'lf_report';
const TYPES_ROUTE = 'lf-report-type';

function radarTypeTerm(id = 42) {
  return { id, slug: 'radar', name: 'Radar' };
}

function post(overrides = {}) {
  return {
    id: 1,
    slug: 'radar-one',
    link: 'https://www.cncf.io/reports/radar-one/',
    title: { rendered: 'Radar One' },
    date: '2024-05-06T07:08:09',
    ...overrides,
  };
}

function existingCatalog(radarReports) {
  return JSON.stringify({ radarReports }, null, 2) + '\n';
}

function collect({ routes, fixtures = {} }) {
  return runScriptInSandbox({
    script: 'collect-radar-reports.mjs',
    routes,
    fixtures,
    outputs: [OUTPUT],
  });
}

function readCatalog(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.outputs[OUTPUT]);
}

test('writes a radar catalog keyed off the discovered radar term id', () => {
  const result = collect({
    routes: [
      { match: POSTS_ROUTE, body: [post()] },
      {
        match: TYPES_ROUTE,
        body: [{ id: 7, slug: 'annual', name: 'Annual' }, radarTypeTerm(42)],
      },
    ],
  });

  const catalog = readCatalog(result);
  assert.equal(catalog.source, 'cncf.io reports (Radar type)');
  assert.equal(
    catalog.sourceUrl,
    'https://www.cncf.io/reports?_sft_lf-report-type=radar',
  );
  // The apiUrl must carry the id resolved from the taxonomy, not a hard-coded
  // one, so a term renumbering on cncf.io stays visible in the output.
  assert.equal(
    catalog.apiUrl,
    'https://www.cncf.io/wp-json/wp/v2/lf_report?lf-report-type=42',
  );
  assert.match(catalog.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(catalog.description, /preserved across refreshes/);
  assert.deepEqual(catalog.radarReports, [
    {
      id: 1,
      title: 'Radar One',
      slug: 'radar-one',
      url: 'https://www.cncf.io/reports/radar-one/',
      publishedAt: '2024-05-06',
      summary: PLACEHOLDER_SUMMARY,
    },
  ]);
  assert.match(result.stdout, /Collected 1 radar reports at /);
});

test('preserves hand-written summaries across a refresh, by report id', () => {
  const result = collect({
    routes: [
      {
        match: POSTS_ROUTE,
        body: [
          post({ id: 1, slug: 'kept', date: '2024-01-01T00:00:00' }),
          post({ id: 2, slug: 'fresh', date: '2023-01-01T00:00:00' }),
        ],
      },
      { match: TYPES_ROUTE, body: [radarTypeTerm()] },
    ],
    fixtures: {
      [OUTPUT]: existingCatalog([
        { id: 1, summary: 'Hand-written summary worth keeping.' },
        // A blank summary must not shadow the placeholder.
        { id: 2, summary: '' },
        // An id that no longer exists upstream is simply dropped.
        { id: 99, summary: 'Stale entry.' },
      ]),
    },
  });

  const catalog = readCatalog(result);
  assert.deepEqual(
    catalog.radarReports.map((report) => [report.id, report.summary]),
    [
      [1, 'Hand-written summary worth keeping.'],
      [2, PLACEHOLDER_SUMMARY],
    ],
  );
});

test('sorts reports newest first and tolerates a missing date', () => {
  const result = collect({
    routes: [
      {
        match: POSTS_ROUTE,
        body: [
          post({ id: 1, slug: 'older', date: '2022-02-02T00:00:00' }),
          post({ id: 2, slug: 'undated', date: null }),
          post({ id: 3, slug: 'newer', date: '2025-03-03T00:00:00' }),
        ],
      },
      { match: TYPES_ROUTE, body: [radarTypeTerm()] },
    ],
  });

  const catalog = readCatalog(result);
  assert.deepEqual(
    catalog.radarReports.map((report) => report.slug),
    ['newer', 'older', 'undated'],
  );
  assert.equal(catalog.radarReports.at(-1).publishedAt, null);
});

test('decodes HTML entities and falls back to the slug for a blank title', () => {
  const result = collect({
    routes: [
      {
        match: POSTS_ROUTE,
        body: [
          post({
            id: 1,
            slug: 'entities',
            date: '2024-04-04T00:00:00',
            title: {
              rendered: 'CI&#038;CD &amp; GitOps&#8217;s &#8211; &#8212;',
            },
          }),
          post({
            id: 2,
            slug: 'blank-title-slug',
            date: '2023-04-04T00:00:00',
            title: { rendered: '   ' },
          }),
          post({
            id: 3,
            slug: 'missing-title-slug',
            date: '2022-04-04T00:00:00',
            title: undefined,
          }),
        ],
      },
      { match: TYPES_ROUTE, body: [radarTypeTerm()] },
    ],
  });

  assert.deepEqual(
    readCatalog(result).radarReports.map((report) => report.title),
    [
      'CI&CD & GitOps\u2019s \u2013 \u2014',
      'blank-title-slug',
      'missing-title-slug',
    ],
  );
});

test('fails loudly when cncf.io no longer exposes a radar term', () => {
  const result = collect({
    routes: [
      { match: POSTS_ROUTE, body: [post()] },
      { match: TYPES_ROUTE, body: [{ id: 7, slug: 'annual', name: 'Annual' }] },
    ],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no longer exposes an lf-report-type term/);
  assert.equal(result.outputs[OUTPUT], null);
});

test('follows x-wp-totalpages pagination and stops on an empty batch', () => {
  const paginated = collect({
    routes: [
      {
        match: '&page=2',
        body: [post({ id: 2, slug: 'page-two', date: '2023-01-01T00:00:00' })],
        headers: { 'x-wp-totalpages': '2' },
      },
      {
        match: POSTS_ROUTE,
        body: [post({ id: 1, slug: 'page-one', date: '2024-01-01T00:00:00' })],
        headers: { 'x-wp-totalpages': '2' },
      },
      { match: TYPES_ROUTE, body: [radarTypeTerm()] },
    ],
  });

  assert.deepEqual(
    readCatalog(paginated).radarReports.map((report) => report.slug),
    ['page-one', 'page-two'],
  );

  const emptySecondPage = collect({
    routes: [
      { match: '&page=2', body: [], headers: { 'x-wp-totalpages': '9' } },
      {
        match: POSTS_ROUTE,
        body: [post({ id: 1, slug: 'solo' })],
        headers: { 'x-wp-totalpages': '9' },
      },
      { match: TYPES_ROUTE, body: [radarTypeTerm()] },
    ],
  });

  assert.deepEqual(
    readCatalog(emptySecondPage).radarReports.map((report) => report.slug),
    ['solo'],
  );
});

test('treats a 400 past the last page as the end of the catalog', () => {
  const result = collect({
    routes: [
      { match: '&page=2', status: 400 },
      {
        match: POSTS_ROUTE,
        body: [post({ id: 1, slug: 'only' })],
        // WordPress advertises more pages than it will serve; the 400 on page
        // 2 is the real end and must not fail the run.
        headers: { 'x-wp-totalpages': '5' },
      },
      { match: TYPES_ROUTE, body: [radarTypeTerm()] },
    ],
  });

  assert.deepEqual(
    readCatalog(result).radarReports.map((report) => report.slug),
    ['only'],
  );
});

test('leaves the catalog untouched when nothing changed (#648)', () => {
  const routes = [
    { match: POSTS_ROUTE, body: [post({ id: 1, slug: 'stable' })] },
    { match: TYPES_ROUTE, body: [radarTypeTerm()] },
  ];

  const first = collect({ routes });
  assert.equal(first.status, 0, first.stderr);
  const firstCatalog = JSON.parse(first.outputs[OUTPUT]);

  // Re-run against the exact catalog the first run produced, as the daily
  // workflow would the next day with unchanged upstream content.
  const second = collect({
    routes,
    fixtures: { [OUTPUT]: first.outputs[OUTPUT] },
  });

  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /No radar report changes detected/);
  // The file on disk — including generatedAt — must be byte-for-byte the
  // same; a second run must not open a no-op refresh PR.
  assert.equal(second.outputs[OUTPUT], first.outputs[OUTPUT]);
  assert.equal(
    JSON.parse(second.outputs[OUTPUT]).generatedAt,
    firstCatalog.generatedAt,
  );
});

test('rewrites the catalog and bumps generatedAt when a report actually changes', () => {
  const routes = [
    { match: POSTS_ROUTE, body: [post({ id: 1, slug: 'stable' })] },
    { match: TYPES_ROUTE, body: [radarTypeTerm()] },
  ];
  const first = collect({ routes });
  assert.equal(first.status, 0, first.stderr);

  const second = collect({
    routes: [
      {
        match: POSTS_ROUTE,
        body: [
          post({ id: 1, slug: 'stable' }),
          post({ id: 2, slug: 'new-report', date: '2025-01-01T00:00:00' }),
        ],
      },
      { match: TYPES_ROUTE, body: [radarTypeTerm()] },
    ],
    fixtures: { [OUTPUT]: first.outputs[OUTPUT] },
  });

  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Collected 2 radar reports at /);
  assert.deepEqual(
    JSON.parse(second.outputs[OUTPUT]).radarReports.map((r) => r.slug),
    ['new-report', 'stable'],
  );
});

test('fails the run when the first page errors', () => {
  const serverError = collect({
    routes: [
      { match: POSTS_ROUTE, status: 500 },
      { match: TYPES_ROUTE, body: [radarTypeTerm()] },
    ],
  });

  assert.notEqual(serverError.status, 0);
  assert.match(serverError.stderr, /cncf\.io API 500: lf_report/);
  assert.equal(serverError.outputs[OUTPUT], null);

  const badRequest = collect({
    routes: [
      { match: POSTS_ROUTE, body: [post()] },
      { match: TYPES_ROUTE, status: 400 },
    ],
  });

  assert.notEqual(badRequest.status, 0);
  assert.match(
    badRequest.stderr,
    /cncf\.io API 400: lf-report-type \(page 1\)/,
  );
  assert.equal(badRequest.outputs[OUTPUT], null);
});

test('an existing catalog without a radarReports key is treated as empty', () => {
  const result = collect({
    routes: [
      { match: POSTS_ROUTE, body: [post()] },
      { match: TYPES_ROUTE, body: [radarTypeTerm()] },
    ],
    fixtures: {
      [OUTPUT]: JSON.stringify({ source: 'cncf.io reports' }, null, 2) + '\n',
    },
  });

  const catalog = readCatalog(result);
  assert.equal(catalog.radarReports.length, 1);
  assert.equal(catalog.radarReports[0].slug, 'radar-one');
  assert.equal(catalog.radarReports[0].summary, PLACEHOLDER_SUMMARY);
});
