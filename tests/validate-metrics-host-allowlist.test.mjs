// Host allow-list coverage for scripts/validate-metrics.mjs.
//
// Every URL in data/metrics.json is rendered under hard-coded anchor text
// ("cncf/architecture" in src/components/ReferenceArchitectures, "Source ↗" in
// src/components/MetricsDashboard), so an https URL on a host that is not
// CNCF's publishes as a CNCF-labelled link to an unrelated origin. These cases
// pin the allow-list at every checkUrl() call site.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

function run(data) {
  return runScriptWithFixtures(SCRIPT, {
    'data/metrics.json': JSON.stringify(data),
  });
}

const OFF_ALLOWLIST = 'https://evil.example/x';

test('accepts github.com and cncf.io subdomains across every URL field', () => {
  const result = run({
    ...validData,
    sources: {
      landscape: {
        revision: 'abc123',
        repository: 'https://github.com/cncf/landscape',
        sourceUrl: 'https://github.com/cncf/landscape/blob/main/landscape.yml',
      },
      architectures: {
        revision: 'def456',
        repository: 'https://github.com/cncf/architecture',
        sourceUrl: 'https://github.com/cncf/architecture',
      },
    },
    referenceArchitectureLifecycle: { sourceUrl: 'https://www.cncf.io/' },
    series: {
      projects: {
        label: 'Projects',
        sourceUrl: 'https://landscape.cncf.io/',
        values: [{ date: '2026-01-01', value: 1 }],
      },
    },
    breakdowns: {
      industries: {
        label: 'Industries',
        sourceUrl: 'https://github.com/cncf/landscape',
        values: [{ name: 'Telecom', value: 1 }],
      },
    },
  });
  assert.equal(result.status, 0, result.stderr);
});

test('rejects an off-allow-list host in sources.*.repository', () => {
  const result = run({
    ...validData,
    sources: {
      landscape: { revision: 'abc123', repository: OFF_ALLOWLIST },
      architectures: { revision: 'def456' },
    },
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /repository must be on cncf\.io or github\.com, got evil\.example/,
  );
});

test('rejects an off-allow-list host in sources.*.sourceUrl', () => {
  const result = run({
    ...validData,
    sources: {
      landscape: { revision: 'abc123' },
      architectures: { revision: 'def456', sourceUrl: OFF_ALLOWLIST },
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sources\.architectures/);
  assert.match(result.stderr, /must be on cncf\.io or github\.com/);
});

test('rejects an off-allow-list host in referenceArchitectureLifecycle.sourceUrl', () => {
  const result = run({
    ...validData,
    referenceArchitectureLifecycle: { sourceUrl: OFF_ALLOWLIST },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /referenceArchitectureLifecycle/);
  assert.match(result.stderr, /must be on cncf\.io or github\.com/);
});

test('rejects an off-allow-list host in metric.sourceUrl', () => {
  const result = run({
    ...validData,
    metrics: [{ ...validMetric, sourceUrl: OFF_ALLOWLIST }],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be on cncf\.io or github\.com/);
});

test('rejects an off-allow-list host in series.*.sourceUrl', () => {
  const result = run({
    ...validData,
    series: {
      projects: {
        label: 'Projects',
        sourceUrl: OFF_ALLOWLIST,
        values: [{ date: '2026-01-01', value: 1 }],
      },
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /series\.projects/);
  assert.match(result.stderr, /must be on cncf\.io or github\.com/);
});

test('rejects an off-allow-list host in breakdowns.*.sourceUrl', () => {
  const result = run({
    ...validData,
    breakdowns: {
      industries: {
        label: 'Industries',
        sourceUrl: OFF_ALLOWLIST,
        values: [{ name: 'Telecom', value: 1 }],
      },
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /breakdowns\.industries/);
  assert.match(result.stderr, /must be on cncf\.io or github\.com/);
});

test('rejects a host that merely ends with an allowed label, not an allowed domain', () => {
  const result = run({
    ...validData,
    metrics: [
      { ...validMetric, sourceUrl: 'https://notcncf.io/x' },
      {
        ...validMetric,
        id: 'suffix-trap',
        sourceUrl: 'https://evil-github.com/x',
      },
    ],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /got notcncf\.io/);
  assert.match(result.stderr, /got evil-github\.com/);
});

test('reports userinfo rather than the allow-list when both would fail', () => {
  const result = run({
    ...validData,
    metrics: [
      { ...validMetric, sourceUrl: 'https://www.cncf.io@evil.example/x' },
    ],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not carry a userinfo component/);
  assert.doesNotMatch(result.stderr, /must be on cncf\.io or github\.com/);
});

test('the committed data/metrics.json satisfies the allow-list', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    'data/metrics.json': readFileSync(
      new URL('../data/metrics.json', import.meta.url),
      'utf8',
    ),
  });
  assert.equal(result.status, 0, result.stderr);
});
