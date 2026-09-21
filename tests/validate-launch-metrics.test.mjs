import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-launch-metrics.mjs';

const validSignal = {
  id: 'github-stars',
  label: 'GitHub stars',
  baseline: 0,
  target90Day: 50,
  sourceUrl: 'https://github.com/cncf/endusers/stargazers',
  collectedAt: '2026-09-21T00:00:00.000Z',
};

const validData = {
  generated: true,
  generatedAt: '2026-09-21T00:00:00.000Z',
  capturedAt: '2026-09-21T00:00:00.000Z',
  checkpoint: {
    label: 'W-6 pre-launch checkpoint (LAUNCH.md)',
    targetDate: '2026-09-28',
  },
  source: 'https://api.github.com/repos/cncf/endusers',
  signals: [
    validSignal,
    {
      ...validSignal,
      id: 'github-watchers',
      label: 'GitHub watchers',
      target90Day: 10,
    },
    {
      ...validSignal,
      id: 'github-forks',
      label: 'GitHub forks',
      baseline: 2,
      target90Day: 5,
    },
  ],
};

function fixture(data) {
  return { 'data/launch-metrics.json': JSON.stringify(data) };
}

test('accepts a minimal valid launch-metrics file', () => {
  const result = runScriptWithFixtures(SCRIPT, fixture(validData));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 3 launch metrics/);
});

test('rejects generated: false', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, generated: false }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /generated must be true/);
});

test('rejects a non-ISO generatedAt', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, generatedAt: 'not a date' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /generatedAt must be ISO 8601/);
});

test('rejects a non-ISO capturedAt', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, capturedAt: 'not a date' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /capturedAt must be ISO 8601/);
});

test('rejects a missing checkpoint', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, checkpoint: {} }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /checkpoint requires a label and a targetDate/);
});

test('rejects an invalid checkpoint targetDate', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      checkpoint: { label: 'x', targetDate: 'not a date' },
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /checkpoint.targetDate must be a valid date/);
});

test('rejects a non-https source', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      source: 'http://api.github.com/repos/cncf/endusers',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must use https/);
});

test('rejects fewer than 3 signals', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, signals: [validSignal] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /signals must define 3-5 signals/);
});

test('rejects more than 5 signals', () => {
  const signals = Array.from({ length: 6 }, (_, i) => ({
    ...validSignal,
    id: `signal-${i}`,
  }));
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, signals }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /signals must define 3-5 signals/);
});

test('rejects duplicate signal ids', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      signals: [validSignal, validSignal, { ...validSignal, id: 'x' }],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate or missing signal id/);
});

test('rejects a signal missing provenance', () => {
  const { sourceUrl, ...rest } = validSignal;
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      signals: [rest, validData.signals[1], validData.signals[2]],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing provenance/);
});

test('rejects a non-integer baseline', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      signals: [
        { ...validSignal, baseline: 1.5 },
        validData.signals[1],
        validData.signals[2],
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /baseline must be a finite, non-negative integer/,
  );
});

test('rejects a negative target90Day', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      signals: [
        { ...validSignal, target90Day: -1 },
        validData.signals[1],
        validData.signals[2],
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /target90Day must be a finite, non-negative integer/,
  );
});

test('rejects a target90Day below baseline', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      signals: [
        { ...validSignal, baseline: 10, target90Day: 1 },
        validData.signals[1],
        validData.signals[2],
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be >= baseline/);
});

test('accepts a target90Day equal to baseline (delta metrics start at zero)', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      signals: [
        {
          ...validSignal,
          id: 'new-contributors-since-baseline',
          baseline: 0,
          target90Day: 5,
        },
        validData.signals[1],
        validData.signals[2],
      ],
    }),
  );
  assert.equal(result.status, 0, result.stderr);
});
