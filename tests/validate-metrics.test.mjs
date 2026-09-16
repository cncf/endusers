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

test('rejects a metric without an id', () => {
  const { id, ...withoutId } = validMetric;
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({ ...validData, metrics: [withoutId] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate or missing metric id/);
});

test('rejects a metric with a null value', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      metrics: [{ ...validMetric, value: null }],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing value/);
});

test('accepts an empty metrics array', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({ ...validData, metrics: [] }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 0 metrics/);
});

test('rejects omitted entries without an id', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({ ...validData, omitted: [{ reason: 'not collected' }] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /id and reason/);
});

test('rejects lifecycle cards with a non-finite value', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      referenceArchitectureLifecycle: {
        cards: [{ id: 'open-submissions', label: 'Open submissions' }],
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid lifecycle card/);
});

test('rejects lifecycle omissions without a reason', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      referenceArchitectureLifecycle: {
        omitted: [{ id: 'acceptance-rate' }],
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid lifecycle omission/);
});

test('accepts a fully populated lifecycle section', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      referenceArchitectureLifecycle: {
        cards: [
          { id: 'open-submissions', label: 'Open submissions', value: 0 },
        ],
        omitted: [{ id: 'acceptance-rate', reason: 'not public' }],
      },
    }),
  );
  assert.equal(result.status, 0, result.stderr);
});

test('rejects a time series missing its sourceUrl', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      series: {
        endUserMembers: {
          label: 'Members',
          values: [{ date: '2026-08-07', value: 42 }],
        },
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid time series/);
});

test('rejects time-series points with a non-finite value', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      series: {
        endUserMembers: {
          label: 'Members',
          sourceUrl: 'https://landscape.cncf.io/',
          values: [{ date: '2026-08-07', value: null }],
        },
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid time-series point/);
});

test('accepts a valid time series', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      series: {
        endUserMembers: {
          label: 'Members',
          sourceUrl: 'https://landscape.cncf.io/',
          values: [{ date: '2026-08-07', value: 42 }],
        },
      },
    }),
  );
  assert.equal(result.status, 0, result.stderr);
});

test('rejects a breakdown whose values are not an array', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      breakdowns: {
        projectMaturity: {
          label: 'Maturity',
          sourceUrl: 'https://landscape.cncf.io/',
          values: { graduated: 10 },
        },
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid breakdown/);
});

test('rejects a breakdown missing its label', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      breakdowns: {
        projectMaturity: {
          sourceUrl: 'https://landscape.cncf.io/',
          values: [{ name: 'graduated', value: 10 }],
        },
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid breakdown/);
});

test('rejects breakdown values that are not finite numbers', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      breakdowns: {
        projectMaturity: {
          label: 'Maturity',
          sourceUrl: 'https://landscape.cncf.io/',
          values: [{ name: 'graduated', value: '10' }],
        },
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid breakdown value/);
});

test('accepts a valid breakdown', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    metricsFixture({
      ...validData,
      breakdowns: {
        projectMaturity: {
          label: 'Maturity',
          sourceUrl: 'https://landscape.cncf.io/',
          values: [{ name: 'graduated', value: 10 }],
        },
      },
    }),
  );
  assert.equal(result.status, 0, result.stderr);
});
