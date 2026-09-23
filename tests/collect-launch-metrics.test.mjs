import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptInSandbox } from './helpers-script-sandbox.mjs';

const OUTPUT = 'data/launch-metrics.json';
const API = 'https://api.github.com/repos/cncf/endusers';

// The sandbox stub matches routes by substring in declaration order, and the
// bare repository URL is a substring of the contributors and issues URLs, so
// the collection routes must be declared before it.
const REPO_ROUTE = 'repos/cncf/endusers';
const CONTRIBUTORS_ROUTE = '/contributors';
const ISSUES_ROUTE = '/issues';

function repoPayload(overrides = {}) {
  return {
    stargazers_count: 41,
    subscribers_count: 9,
    forks_count: 4,
    ...overrides,
  };
}

function contributor(login, overrides = {}) {
  return { login, type: 'User', ...overrides };
}

function issue(overrides = {}) {
  return { assignees: [{ login: 'octocat' }], ...overrides };
}

function routes({
  repo = repoPayload(),
  contributors = [contributor('alice')],
  issues = [issue()],
  extra = [],
} = {}) {
  return [
    ...extra,
    { match: CONTRIBUTORS_ROUTE, body: contributors },
    { match: ISSUES_ROUTE, body: issues },
    { match: REPO_ROUTE, body: repo },
  ];
}

function collect(routeList) {
  return runScriptInSandbox({
    script: 'collect-launch-metrics.mjs',
    // The script writes straight into data/, which only exists in the sandbox
    // if something is written there first.
    fixtures: { 'data/.keep': '' },
    routes: routeList,
    outputs: [OUTPUT],
  });
}

function readBaseline(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.outputs[OUTPUT]);
}

function signalById(baseline, id) {
  const found = baseline.signals.find((entry) => entry.id === id);
  assert.ok(found, `no signal with id ${id}`);
  return found;
}

test('writes the five launch signals with their 90-day targets', () => {
  const baseline = readBaseline(collect(routes()));

  assert.equal(baseline.generated, true);
  assert.equal(baseline.source, API);
  assert.deepEqual(
    baseline.signals.map((entry) => entry.id),
    [
      'github-stars',
      'github-watchers',
      'github-forks',
      'new-contributors-since-baseline',
      'good-first-issues-claimed',
    ],
  );
  assert.deepEqual(
    Object.fromEntries(
      baseline.signals.map((entry) => [entry.id, entry.target90Day]),
    ),
    {
      'github-stars': 50,
      'github-watchers': 10,
      'github-forks': 5,
      'new-contributors-since-baseline': 5,
      'good-first-issues-claimed': 3,
    },
  );
  for (const entry of baseline.signals) {
    assert.equal(typeof entry.label, 'string');
    assert.ok(entry.label.length > 0, `signal ${entry.id} has no label`);
    assert.ok(
      entry.sourceUrl.startsWith('https://github.com/cncf/endusers'),
      `signal ${entry.id} links off-repo: ${entry.sourceUrl}`,
    );
  }
});

test('star, watcher and fork baselines come from the repository payload', () => {
  const baseline = readBaseline(
    collect(
      routes({
        repo: repoPayload({
          stargazers_count: 123,
          subscribers_count: 45,
          forks_count: 6,
        }),
      }),
    ),
  );

  assert.equal(signalById(baseline, 'github-stars').baseline, 123);
  assert.equal(signalById(baseline, 'github-watchers').baseline, 45);
  assert.equal(signalById(baseline, 'github-forks').baseline, 6);
});

test('the checkpoint block records the LAUNCH.md W-6 date', () => {
  const baseline = readBaseline(collect(routes()));

  assert.equal(baseline.checkpoint.targetDate, '2026-09-28');
  assert.match(baseline.checkpoint.label, /W-6/);
  assert.match(baseline.checkpoint.note, /collect:launch-metrics/);
});

test('capturedAt is a single ISO timestamp shared by every signal', () => {
  const baseline = readBaseline(collect(routes()));

  assert.match(baseline.capturedAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  assert.equal(baseline.generatedAt, baseline.capturedAt);
  for (const entry of baseline.signals) {
    assert.equal(
      entry.collectedAt,
      baseline.capturedAt,
      `signal ${entry.id} has a different collectedAt`,
    );
  }
});

test('new contributors start at 0 because the signal is a delta', () => {
  const baseline = readBaseline(
    collect(
      routes({
        contributors: [contributor('alice'), contributor('bob')],
      }),
    ),
  );

  const signal = signalById(baseline, 'new-contributors-since-baseline');
  assert.equal(signal.baseline, 0);
  assert.match(signal.note, /0 by definition/);
  assert.deepEqual(signal.priorContributorLogins, ['alice', 'bob']);
});

test('bots are excluded from the prior-contributor snapshot', () => {
  const baseline = readBaseline(
    collect(
      routes({
        contributors: [
          contributor('dependabot[bot]', { type: 'Bot' }),
          contributor('human-one'),
          // A bot account typed as a User is still caught by the login suffix
          // rules, which is the only signal the API gives for these.
          contributor('renovate[bot]'),
          contributor('SomeBot'),
          contributor('human-two'),
        ],
      }),
    ),
  );

  assert.deepEqual(
    signalById(baseline, 'new-contributors-since-baseline')
      .priorContributorLogins,
    ['human-one', 'human-two'],
  );
});

test('prior contributor logins are sorted for a stable diff', () => {
  const baseline = readBaseline(
    collect(
      routes({
        contributors: [
          contributor('zoe'),
          contributor('adam'),
          contributor('mia'),
        ],
      }),
    ),
  );

  assert.deepEqual(
    signalById(baseline, 'new-contributors-since-baseline')
      .priorContributorLogins,
    ['adam', 'mia', 'zoe'],
  );
});

test('good-first-issues count only assigned issues, never pull requests', () => {
  const baseline = readBaseline(
    collect(
      routes({
        issues: [
          issue(),
          issue({ assignees: [] }),
          // The issues endpoint returns pull requests too; they carry a
          // pull_request key and must not be counted as claimed issues.
          issue({ pull_request: { url: 'https://example.invalid/pr/1' } }),
          issue({ assignees: undefined }),
          issue({ assignees: [{ login: 'a' }, { login: 'b' }] }),
        ],
      }),
    ),
  );

  assert.equal(signalById(baseline, 'good-first-issues-claimed').baseline, 2);
});

test('paginated contributor responses are followed to the last page', () => {
  const baseline = readBaseline(
    collect(
      routes({
        extra: [
          {
            match: 'contributors?page=3',
            body: [contributor('carol')],
          },
          {
            match: 'contributors?page=2',
            body: [contributor('bob')],
            headers: {
              link: `<${API}/contributors?page=3>; rel="next", <${API}/contributors?page=3>; rel="last"`,
            },
          },
          {
            match: CONTRIBUTORS_ROUTE,
            body: [contributor('alice')],
            headers: {
              link: `<${API}/contributors?page=2>; rel="next", <${API}/contributors?page=3>; rel="last"`,
            },
          },
        ],
      }),
    ),
  );

  assert.deepEqual(
    signalById(baseline, 'new-contributors-since-baseline')
      .priorContributorLogins,
    ['alice', 'bob', 'carol'],
  );
});

test('a Link header without rel="next" ends pagination', () => {
  const baseline = readBaseline(
    collect(
      routes({
        extra: [
          {
            match: CONTRIBUTORS_ROUTE,
            body: [contributor('alice')],
            headers: {
              link: `<${API}/contributors?page=1>; rel="prev", <${API}/contributors?page=1>; rel="first"`,
            },
          },
        ],
      }),
    ),
  );

  assert.deepEqual(
    signalById(baseline, 'new-contributors-since-baseline')
      .priorContributorLogins,
    ['alice'],
  );
});

test('the output is pretty-printed JSON with a trailing newline', () => {
  const result = collect(routes());
  assert.equal(result.status, 0, result.stderr);

  const raw = result.outputs[OUTPUT];
  assert.ok(raw.endsWith('}\n'), 'generated file has no trailing newline');
  assert.match(raw, /\n {2}"generated": true,/);
});

test('the run reports how many signals it collected', () => {
  const result = collect(routes());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Collected 5 launch metrics at \d{4}-/);
});

test('a failed repository request aborts before anything is written', () => {
  const result = collect(
    routes({ extra: [{ match: REPO_ROUTE, status: 404 }] }),
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GitHub API 404/);
  assert.equal(result.outputs[OUTPUT], null);
});

test('a failed paginated request aborts before anything is written', () => {
  const result = collect(
    routes({ extra: [{ match: CONTRIBUTORS_ROUTE, status: 403 }] }),
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GitHub API 403/);
  assert.equal(result.outputs[OUTPUT], null);
});
