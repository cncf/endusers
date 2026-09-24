import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-metrics.mjs';

const validMetric = {
  id: 'cncf-projects',
  label: 'CNCF projects',
  value: 100,
  source: 'landscape',
  sourceUrl: 'https://landscape.cncf.io/',
  collectedAt: '2026-08-07T00:00:00.000Z',
};

const validData = {
  generated: true,
  generatedAt: '2026-08-07T00:00:00.000Z',
  sources: {
    landscape: {
      repository: 'https://github.com/cncf/landscape',
      revision: 'abc123',
      sourceUrl: 'https://github.com/cncf/landscape/blob/main/landscape.yml',
    },
    architectures: {
      repository: 'https://github.com/cncf/architecture',
      revision: 'def456',
      sourceUrl:
        'https://github.com/cncf/architecture/tree/main/content/en/architectures',
    },
  },
  metrics: [validMetric],
  referenceArchitectureLifecycle: {
    sourceUrl: 'https://github.com/cncf/tab/issues',
    cards: [],
    omitted: [],
  },
  series: {
    endUserMembers: {
      label: 'CNCF member companies',
      source: 'landscape',
      sourceUrl: 'https://landscape.cncf.io/',
      values: [{ date: '2026-01-01', value: 1 }],
    },
  },
  breakdowns: {
    projectMaturity: {
      label: 'Project maturity',
      source: 'landscape',
      sourceUrl: 'https://landscape.cncf.io/',
      values: [{ name: 'graduated', value: 1 }],
    },
  },
};

function fixture(data) {
  return { 'data/metrics.json': JSON.stringify(data) };
}

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

test('accepts a metrics file whose URLs are all https', () => {
  const result = runScriptWithFixtures(SCRIPT, fixture(validData));
  assert.equal(result.status, 0, result.stderr);
});

test('rejects a javascript: metric sourceUrl', () => {
  const data = clone(validData);
  data.metrics[0].sourceUrl = 'javascript:alert(document.domain)';
  const result = runScriptWithFixtures(SCRIPT, fixture(data));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must use https, got javascript:/);
});

test('rejects a data: series sourceUrl', () => {
  const data = clone(validData);
  data.series.endUserMembers.sourceUrl = 'data:text/html,<script></script>';
  const result = runScriptWithFixtures(SCRIPT, fixture(data));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /series\.endUserMembers: sourceUrl must use https/,
  );
});

test('rejects a javascript: breakdown sourceUrl', () => {
  const data = clone(validData);
  data.breakdowns.projectMaturity.sourceUrl = 'javascript:alert(1)';
  const result = runScriptWithFixtures(SCRIPT, fixture(data));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /breakdowns\.projectMaturity: sourceUrl must use https/,
  );
});

test('rejects a javascript: lifecycle sourceUrl', () => {
  const data = clone(validData);
  data.referenceArchitectureLifecycle.sourceUrl = 'javascript:alert(1)';
  const result = runScriptWithFixtures(SCRIPT, fixture(data));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /referenceArchitectureLifecycle: sourceUrl must use https/,
  );
});

test('rejects a javascript: source repository, which is concatenated into a commit href', () => {
  const data = clone(validData);
  data.sources.architectures.repository = 'javascript:alert(1)';
  const result = runScriptWithFixtures(SCRIPT, fixture(data));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /sources\.architectures: repository must use https/,
  );
});

test('rejects an http: source sourceUrl', () => {
  const data = clone(validData);
  data.sources.landscape.sourceUrl = 'http://landscape.cncf.io/';
  const result = runScriptWithFixtures(SCRIPT, fixture(data));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sources\.landscape: sourceUrl must use https/);
});

test('rejects a relative metric sourceUrl', () => {
  const data = clone(validData);
  data.metrics[0].sourceUrl = '/img/architectures/x.svg';
  const result = runScriptWithFixtures(SCRIPT, fixture(data));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an absolute URL/);
});

test('leaves absent optional URLs to the existing presence checks', () => {
  const data = clone(validData);
  delete data.sources.landscape.repository;
  delete data.sources.landscape.sourceUrl;
  delete data.referenceArchitectureLifecycle.sourceUrl;
  const result = runScriptWithFixtures(SCRIPT, fixture(data));
  assert.equal(result.status, 0, result.stderr);
});

// The protocol test alone admits "https://www.cncf.io@evil.example/", whose
// visible prefix and real host disagree. These URLs are rendered as hrefs by
// MetricsDashboard, so userinfo is rejected as its own arm -- and it must be
// reported as userinfo, not mislabelled as a scheme problem.
test('rejects a metric sourceUrl carrying a userinfo component', () => {
  const data = clone(validData);
  data.metrics[0].sourceUrl = 'https://www.cncf.io@evil.example/metrics';
  const result = runScriptWithFixtures(SCRIPT, fixture(data));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must not carry a userinfo component/);
  assert.match(result.stderr, /evil\.example/);
  assert.doesNotMatch(result.stderr, /must use https/);
});

test('rejects a sources entry sourceUrl carrying a userinfo component', () => {
  const data = clone(validData);
  data.sources.landscape.sourceUrl = 'https://github.com@evil.example/l.yml';
  const result = runScriptWithFixtures(SCRIPT, fixture(data));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /sources\.landscape: sourceUrl must not carry a userinfo component/,
  );
});

test('rejects a series sourceUrl carrying a password-only userinfo component', () => {
  const data = clone(validData);
  data.series.endUserMembers.sourceUrl = 'https://:token@evil.example/s';
  const result = runScriptWithFixtures(SCRIPT, fixture(data));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /series\.endUserMembers: sourceUrl must not carry a userinfo component/,
  );
});
