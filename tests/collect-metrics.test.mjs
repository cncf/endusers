import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptInSandbox } from './helpers-script-sandbox.mjs';

const LANDSCAPE_YML = `landscape:
  - name: Orchestration
    subcategories:
      - name: Scheduling
        items:
          - name: Kubernetes
            project: graduated
          - name: Example Corp (member)
          - name: Nested group
            items:
              - name: Nested Project
                project: incubating
              - name: Not A Project
      - name: Service Mesh
        items:
          - name: Mesh One
            project: incubating
  - name: Observability
    subcategories:
      - name: Monitoring
        items:
          - name: Prometheus
            project: graduated
          - name: Sandbox Thing
            project: sandbox
  - name: Empty category
`;

const MEMBER_ONLY_LANDSCAPE = `landscape:
  - name: Members
    subcategories:
      - name: Companies
        items:
          - homepage_url: https://example.com
            name: Example Corp (member)
          - homepage_url: https://second.example.com
            name: Second Corp (member)
          - homepage_url: https://third.example.com
            name: Third Corp
`;

const ISSUE_ROUTE = 'repos/cncf/tab/issues';
const PULLS_ROUTE = 'repos/cncf/architecture/pulls?';
const FILES_ROUTE = '/files';

function landscapeRepo(yml = LANDSCAPE_YML) {
  return { 'landscape.yml': yml };
}

function architectureRepo(names = ['acme-platform', 'globex-edge']) {
  const tree = {};
  for (const name of names) {
    tree[`content/en/architectures/${name}/index.md`] = `# ${name}\n`;
  }
  return tree;
}

function issue(overrides = {}) {
  return {
    number: 1,
    state: 'open',
    created_at: '2024-01-01T00:00:00Z',
    labels: [{ name: 'area/reference-architecture' }],
    ...overrides,
  };
}

function pull(overrides = {}) {
  return {
    number: 1,
    state: 'closed',
    title: 'Add reference architecture',
    body: '',
    created_at: '2024-01-01T00:00:00Z',
    merged_at: '2024-01-11T00:00:00Z',
    ...overrides,
  };
}

function run({
  landscape = LANDSCAPE_YML,
  architectures = ['acme-platform', 'globex-edge'],
  commitDates = [
    '2024-01-10T00:00:00Z',
    '2024-01-20T00:00:00Z',
    '2024-03-05T00:00:00Z',
  ],
  routes,
} = {}) {
  return runScriptInSandbox({
    script: 'collect-metrics.mjs',
    repos: {
      landscape: landscapeRepo(landscape),
      architecture: architectureRepo(architectures),
    },
    repoCommitDates: { architecture: commitDates },
    routes: routes ?? [
      { match: FILES_ROUTE, body: [] },
      { match: ISSUE_ROUTE, body: [issue()] },
      { match: PULLS_ROUTE, body: [pull()] },
    ],
    outputs: ['data/metrics.json'],
  });
}

function metricsFrom(result) {
  assert.equal(
    result.status,
    0,
    `expected success, stderr was:\n${result.stderr}`,
  );
  const raw = result.outputs['data/metrics.json'];
  assert.ok(raw, 'data/metrics.json was not written');
  return JSON.parse(raw);
}

function cardValue(data, id) {
  const card = data.referenceArchitectureLifecycle.cards.find(
    (entry) => entry.id === id,
  );
  assert.ok(card, `missing lifecycle card ${id}`);
  return card.value;
}

test('collect-metrics writes metrics.json with project and architecture counts', () => {
  const data = metricsFrom(run());

  assert.equal(data.generated, true);
  assert.ok(
    Date.parse(data.generatedAt) > 0,
    'generatedAt must be a timestamp',
  );

  const byId = Object.fromEntries(
    data.metrics.map((entry) => [entry.id, entry]),
  );
  // Five items carry a `project:` key, including one nested under item.items.
  assert.equal(byId['cncf-projects'].value, 5);
  assert.equal(byId['reference-architectures'].value, 2);
  assert.equal(byId['cncf-projects'].source, 'landscape');
  assert.equal(byId['reference-architectures'].source, 'architectures');
  for (const entry of data.metrics) {
    assert.equal(entry.collectedAt, data.generatedAt);
    assert.ok(entry.label, 'every metric has a label');
    assert.ok(entry.note, 'every metric explains its provenance');
    assert.ok(entry.sourceUrl.startsWith('https://'));
  }
});

test('collect-metrics records the cloned revisions as sources', () => {
  const data = metricsFrom(run());

  assert.equal(
    data.sources.landscape.repository,
    'https://github.com/cncf/landscape',
  );
  assert.match(data.sources.landscape.revision, /^[0-9a-f]{40}$/);
  assert.equal(
    data.sources.architectures.repository,
    'https://github.com/cncf/architecture',
  );
  assert.match(data.sources.architectures.revision, /^[0-9a-f]{40}$/);
  assert.notEqual(
    data.sources.landscape.revision,
    data.sources.architectures.revision,
  );
});

test('collect-metrics breaks projects down by category and maturity, sorted by count', () => {
  const data = metricsFrom(run());

  assert.deepEqual(data.breakdowns.projectCategories.values, [
    { name: 'Orchestration', value: 3 },
    { name: 'Observability', value: 2 },
  ]);
  assert.deepEqual(data.breakdowns.projectMaturity.values, [
    { name: 'graduated', value: 2 },
    { name: 'incubating', value: 2 },
    { name: 'sandbox', value: 1 },
  ]);
  const counts = data.breakdowns.projectMaturity.values.map(
    (entry) => entry.value,
  );
  assert.deepEqual(
    counts,
    [...counts].sort((a, b) => b - a),
    'breakdown values are sorted descending',
  );
});

test('collect-metrics counts landscape member entries into the member series', () => {
  const data = metricsFrom(run({ landscape: MEMBER_ONLY_LANDSCAPE }));

  assert.equal(data.series.endUserMembers.values.length, 1);
  assert.equal(data.series.endUserMembers.values[0].value, 2);
  assert.match(
    data.series.endUserMembers.values[0].date,
    /^\d{4}-\d{2}-\d{2}$/,
  );
});

test('collect-metrics builds a cumulative monthly architecture timeline from git history', () => {
  const data = metricsFrom(run());

  assert.deepEqual(data.series.referenceArchitectures.values, [
    { date: '2024-01', value: 2 },
    { date: '2024-03', value: 3 },
  ]);
});

test('collect-metrics tolerates a landscape with no projects', () => {
  const data = metricsFrom(
    run({
      landscape: MEMBER_ONLY_LANDSCAPE,
      architectures: [],
      routes: [
        { match: FILES_ROUTE, body: [] },
        { match: ISSUE_ROUTE, body: [] },
        { match: PULLS_ROUTE, body: [] },
      ],
    }),
  );

  const byId = Object.fromEntries(
    data.metrics.map((entry) => [entry.id, entry]),
  );
  assert.equal(byId['cncf-projects'].value, 0);
  assert.equal(byId['reference-architectures'].value, 0);
  assert.deepEqual(data.breakdowns.projectCategories.values, []);
  // median() returns 0 rather than NaN for an empty sample.
  assert.equal(cardValue(data, 'median-submission-age'), 0);
  assert.equal(cardValue(data, 'median-pr-cycle'), 0);
});

test('collect-metrics counts only labeled, non-pull-request submissions', () => {
  const data = metricsFrom(
    run({
      routes: [
        { match: FILES_ROUTE, body: [] },
        {
          match: ISSUE_ROUTE,
          body: [
            issue({ number: 1 }),
            issue({ number: 2, state: 'closed' }),
            issue({ number: 3, labels: [{ name: 'kind/bug' }] }),
            issue({ number: 4, labels: undefined }),
            issue({ number: 5, pull_request: { url: 'https://example' } }),
            issue({ number: 6, labels: [{ name: 'Reference-Architecture' }] }),
          ],
        },
        { match: PULLS_ROUTE, body: [] },
      ],
    }),
  );

  // Issues 1 and 6 are open, labeled and not pull requests; the label match is
  // case-insensitive and a missing `labels` array must not throw.
  assert.equal(cardValue(data, 'open-submissions'), 2);
});

test('collect-metrics reports median submission age and PR cycle time in days', () => {
  const now = Date.now();
  const daysAgo = (days) => new Date(now - days * 86400000).toISOString();
  const data = metricsFrom(
    run({
      routes: [
        { match: FILES_ROUTE, body: [] },
        {
          match: ISSUE_ROUTE,
          body: [
            issue({ number: 1, created_at: daysAgo(10) }),
            issue({ number: 2, created_at: daysAgo(20) }),
            issue({ number: 3, created_at: daysAgo(30) }),
          ],
        },
        {
          match: PULLS_ROUTE,
          body: [
            pull({
              number: 1,
              created_at: '2024-01-01T00:00:00Z',
              merged_at: '2024-01-03T00:00:00Z',
            }),
            pull({
              number: 2,
              created_at: '2024-02-01T00:00:00Z',
              merged_at: '2024-02-09T00:00:00Z',
            }),
            pull({ number: 3, state: 'open', merged_at: null }),
          ],
        },
      ],
    }),
  );

  // Odd sample: the middle value, rounded to one decimal.
  assert.ok(Math.abs(cardValue(data, 'median-submission-age') - 20) < 0.1);
  // Even sample of merged PRs (2 and 8 days) averages the two middle values.
  assert.equal(cardValue(data, 'median-pr-cycle'), 5);
  assert.equal(cardValue(data, 'open-architecture-prs'), 1);
});

test('collect-metrics groups merged architecture PRs into a monthly trend', () => {
  const data = metricsFrom(
    run({
      routes: [
        { match: FILES_ROUTE, body: [] },
        { match: ISSUE_ROUTE, body: [] },
        {
          match: PULLS_ROUTE,
          body: [
            pull({ number: 1, merged_at: '2024-01-05T00:00:00Z' }),
            pull({ number: 2, merged_at: '2024-01-25T00:00:00Z' }),
            pull({ number: 3, merged_at: '2024-02-02T00:00:00Z' }),
            pull({ number: 4, state: 'open', merged_at: null }),
          ],
        },
      ],
    }),
  );

  assert.deepEqual(
    data.referenceArchitectureLifecycle.trends.publications.values,
    [
      { date: '2024-01', value: 2 },
      { date: '2024-02', value: 1 },
    ],
  );
});

test('collect-metrics selects architecture PRs by changed files as well as text', () => {
  const data = metricsFrom(
    run({
      routes: [
        {
          match: 'pulls/7/files',
          body: [{ filename: 'content/en/architectures/acme/index.md' }],
        },
        { match: 'pulls/8/files', body: [{ filename: 'README.md' }] },
        { match: FILES_ROUTE, body: [] },
        { match: ISSUE_ROUTE, body: [] },
        {
          match: PULLS_ROUTE,
          body: [
            // Matched by changed files despite an unrelated title and body.
            pull({
              number: 7,
              state: 'open',
              title: 'chore: tidy',
              body: 'no keyword here',
              merged_at: null,
            }),
            // Excluded: unrelated files, title and body.
            pull({
              number: 8,
              state: 'open',
              title: 'chore: bump deps',
              body: null,
              merged_at: null,
            }),
          ],
        },
      ],
    }),
  );

  assert.equal(cardValue(data, 'open-architecture-prs'), 1);
});

test('collect-metrics follows Link rel=next pagination', () => {
  const data = metricsFrom(
    run({
      routes: [
        { match: FILES_ROUTE, body: [] },
        {
          match: 'issues?state=all',
          body: [issue({ number: 1 })],
          headers: {
            link: '<https://api.github.com/repos/cncf/tab/issues?page=2>; rel="next"',
          },
        },
        { match: 'tab/issues?page=2', body: [issue({ number: 2 })] },
        { match: PULLS_ROUTE, body: [] },
      ],
    }),
  );

  assert.equal(cardValue(data, 'open-submissions'), 2);
});

test('collect-metrics falls back to PR text when the files endpoint fails', () => {
  const result = run({
    routes: [
      { match: FILES_ROUTE, status: 500 },
      { match: ISSUE_ROUTE, body: [] },
      {
        match: PULLS_ROUTE,
        body: [
          pull({
            number: 9,
            state: 'open',
            title: 'Publish architecture',
            merged_at: null,
          }),
          pull({
            number: 10,
            state: 'open',
            title: 'chore: bump deps',
            body: null,
            merged_at: null,
          }),
        ],
      },
    ],
  });
  const data = metricsFrom(result);

  assert.match(result.stderr, /Could not inspect PR #9 files/);
  assert.match(result.stderr, /using title\/body fallback/);
  assert.equal(cardValue(data, 'open-architecture-prs'), 1);
});

test('collect-metrics fails loudly when the GitHub API rejects a request', () => {
  const result = run({
    routes: [
      { match: FILES_ROUTE, body: [] },
      { match: ISSUE_ROUTE, status: 403 },
      { match: PULLS_ROUTE, body: [] },
    ],
  });

  assert.notEqual(result.status, 0, 'a failed API call must not exit 0');
  assert.match(result.stderr, /GitHub API 403/);
  assert.equal(
    result.outputs['data/metrics.json'],
    null,
    'no metrics file is written when collection fails',
  );
});

test('collect-metrics documents the metrics it deliberately omits', () => {
  const data = metricsFrom(run());

  assert.deepEqual(
    data.omitted.map((entry) => entry.id),
    ['member-companies', 'slack-members', 'conference-attendance'],
  );
  for (const entry of data.omitted) {
    assert.ok(entry.reason, `omitted entry ${entry.id} must explain itself`);
  }
  assert.deepEqual(
    data.referenceArchitectureLifecycle.omitted.map((entry) => entry.id),
    ['acceptance-rate', 'validation-duration', 'announcement-rate'],
  );
});
