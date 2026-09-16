import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';
import {
  buildTable,
  START,
  END,
} from '../scripts/lib/launch-metrics-table.mjs';

const SCRIPT = 'validate-launch-metrics.mjs';

const validSignal = {
  id: 'github-stars',
  label: 'GitHub stars',
  source: 'https://github.com/cncf/endusers',
  baseline: 0,
  target90Day: 50,
  targetWindow: '90 days post-launch',
};

function launchMetricsFixture(overrides = {}) {
  const data = {
    preLaunchCheckpointAt: '2026-08-08',
    checkpointLabel: 'W-6 pre-launch checkpoint',
    inboundLinkMeasurementProcedure:
      'run the same GitHub code search query each time',
    signals: [
      validSignal,
      { ...validSignal, id: 'github-watchers', label: 'GitHub watchers' },
      { ...validSignal, id: 'github-forks', label: 'GitHub forks' },
    ],
    ...overrides,
  };
  return {
    'data/launch-metrics.json': JSON.stringify(data),
    'ROADMAP.md': `# Roadmap\n\n${START}\n\n${buildTable(data)}\n\n${END}\n`,
  };
}

test('accepts a valid launch metrics file with a synced table', () => {
  const result = runScriptWithFixtures(SCRIPT, launchMetricsFixture());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 3 launch success signals/);
});

test('rejects an invalid preLaunchCheckpointAt date', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    launchMetricsFixture({ preLaunchCheckpointAt: 'not-a-date' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /valid date/);
});

test('rejects a missing inboundLinkMeasurementProcedure', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    launchMetricsFixture({ inboundLinkMeasurementProcedure: undefined }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /reproducible/);
});

test('rejects fewer than 3 signals', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    launchMetricsFixture({ signals: [validSignal] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /between 3 and 5/);
});

test('rejects more than 5 signals', () => {
  const signals = Array.from({ length: 6 }, (_, i) => ({
    ...validSignal,
    id: `signal-${i}`,
  }));
  const result = runScriptWithFixtures(
    SCRIPT,
    launchMetricsFixture({ signals }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /between 3 and 5/);
});

test('rejects duplicate signal ids', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    launchMetricsFixture({
      signals: [
        validSignal,
        { ...validSignal },
        { ...validSignal, id: 'github-forks' },
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate or missing signal id/);
});

test('rejects a signal missing target90Day', () => {
  const { target90Day, ...withoutTarget } = validSignal;
  const result = runScriptWithFixtures(
    SCRIPT,
    launchMetricsFixture({
      signals: [
        withoutTarget,
        { ...validSignal, id: 'github-watchers' },
        { ...validSignal, id: 'github-forks' },
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /target90Day must be a finite, non-negative integer/,
  );
});

test('rejects a non-integer baseline', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    launchMetricsFixture({
      signals: [
        { ...validSignal, baseline: 1.5 },
        { ...validSignal, id: 'github-watchers' },
        { ...validSignal, id: 'github-forks' },
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /finite, non-negative integer/);
});

test('rejects a negative target90Day', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    launchMetricsFixture({
      signals: [
        { ...validSignal, target90Day: -1 },
        { ...validSignal, id: 'github-watchers' },
        { ...validSignal, id: 'github-forks' },
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /finite, non-negative integer/);
});

test('rejects a non-finite baseline (Infinity)', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    launchMetricsFixture({
      signals: [
        { ...validSignal, baseline: Infinity },
        { ...validSignal, id: 'github-watchers' },
        { ...validSignal, id: 'github-forks' },
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /finite, non-negative integer/);
});

test('rejects a source pointing at the pre-transfer castrojo/endusers fork', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    launchMetricsFixture({
      signals: [
        { ...validSignal, source: 'https://github.com/castrojo/endusers' },
        { ...validSignal, id: 'github-watchers' },
        { ...validSignal, id: 'github-forks' },
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /canonical cncf\/endusers URL/);
});

test('warns when target90Day is lower than baseline', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    launchMetricsFixture({
      signals: [
        { ...validSignal, baseline: 10, target90Day: 5 },
        { ...validSignal, id: 'github-watchers' },
        { ...validSignal, id: 'github-forks' },
      ],
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /lower than baseline/);
});

test('rejects a ROADMAP.md table that has drifted from the JSON', () => {
  const fixtures = launchMetricsFixture();
  fixtures['ROADMAP.md'] = fixtures['ROADMAP.md'].replace('50', '999');
  const result = runScriptWithFixtures(SCRIPT, fixtures);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /out of sync/);
});

test('rejects a ROADMAP.md missing the table markers', () => {
  const fixtures = launchMetricsFixture();
  fixtures['ROADMAP.md'] = '# Roadmap\n\nno markers here\n';
  const result = runScriptWithFixtures(SCRIPT, fixtures);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing.*markers/);
});
