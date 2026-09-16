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
  collectedAt: new Date().toISOString(),
};

const validData = {
  generated: true,
  generatedAt: new Date().toISOString(),
  sources: {
    landscape: { revision: 'abc123' },
    architectures: { revision: 'def456' },
  },
  metrics: [validMetric],
};

function metricsFixture(data) {
  return { 'data/metrics.json': JSON.stringify(data) };
}

test('accepts a minimal valid metrics file', () => {
  const result = runScriptWithFixtures(SCRIPT, metricsFixture(validData));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 metrics/);
});

test('rejects generated: false', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({ ...validData, generated: false }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /generated must be true/);
});

test('rejects a non-ISO generatedAt', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({ ...validData, generatedAt: 'not a date' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ISO 8601/);
});

test('rejects generatedAt older than the 48-hour freshness requirement', () => {
  const staleDate = new Date(
    Date.now() - 60 * 60 * 60 * 1000, // 60 hours ago
  ).toISOString();
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({ ...validData, generatedAt: staleDate }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exceeds the 48-hour freshness requirement/);
});

test('accepts generatedAt just inside the 48-hour freshness requirement', () => {
  const recentDate = new Date(
    Date.now() - 47 * 60 * 60 * 1000, // 47 hours ago
  ).toISOString();
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({ ...validData, generatedAt: recentDate }),
  );
  assert.equal(result.status, 0, result.stderr);
});

test('rejects missing source revisions', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({ ...validData, sources: { landscape: {} } }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /source revisions/);
});

test('rejects duplicate metric ids', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({ ...validData, metrics: [validMetric, validMetric] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate or missing metric id/);
});

test('rejects metrics with an empty-string value', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({ ...validData, metrics: [{ ...validMetric, value: '' }] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing value/);
});

test('accepts a metric value of zero', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({ ...validData, metrics: [{ ...validMetric, value: 0 }] }),
  );
  assert.equal(result.status, 0, result.stderr);
});

test('rejects metrics missing provenance', () => {
  const { sourceUrl, ...withoutSourceUrl } = validMetric;
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({ ...validData, metrics: [withoutSourceUrl] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing provenance/);
});

test('rejects omitted entries without a reason', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({ ...validData, omitted: [{ id: 'slack-members' }] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /id and reason/);
});

test('rejects invalid lifecycle cards', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      referenceArchitectureLifecycle: {
        cards: [{ id: 'open-submissions', value: 3 }],
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid lifecycle card/);
});

test('rejects time series with empty values', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      series: {
        endUserMembers: {
          label: 'Members',
          sourceUrl: 'https://landscape.cncf.io/',
          values: [],
        },
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid time series/);
});

test('rejects time-series points without a date', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      series: {
        endUserMembers: {
          label: 'Members',
          sourceUrl: 'https://landscape.cncf.io/',
          values: [{ value: 42 }],
        },
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid time-series point/);
});

test('rejects breakdown values without a name', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      breakdowns: {
        projectMaturity: {
          label: 'Maturity',
          sourceUrl: 'https://landscape.cncf.io/',
          values: [{ value: 10 }],
        },
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid breakdown value/);
});
