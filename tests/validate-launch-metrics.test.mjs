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

// checkUrl distinguishes two ways a URL field can be wrong: unparseable at all
// (the `new URL` throw), and parseable but not https. Only the second arm was
// exercised, so a value like 'api.github.com/repos' -- the shape a hand-edited
// file is most likely to carry -- went through an untested branch.
test('rejects a source that is not an absolute URL', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, source: 'api.github.com/repos/cncf/endusers' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /source must be an absolute URL/);
});

test('rejects a signal sourceUrl that is not an absolute URL', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      signals: [
        { ...validSignal, sourceUrl: 'github.com/cncf/endusers/stargazers' },
        validData.signals[1],
        validData.signals[2],
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an absolute URL/);
});

// An empty string is the documented "field not supplied" escape in checkUrl, so
// it must not be reported as a malformed URL.
test('accepts an omitted source rather than calling it malformed', () => {
  const { source, ...rest } = validData;
  const result = runScriptWithFixtures(SCRIPT, fixture(rest));
  assert.equal(result.status, 0, result.stderr);
});

test('rejects a signal missing its label', () => {
  const { label, ...rest } = validSignal;
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      signals: [rest, validData.signals[1], validData.signals[2]],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing label/);
});

// collectedAt is what dates every signal on the launch dashboard. A present but
// unparseable value passes the provenance check -- which only asks whether the
// field is truthy -- so this is the only guard standing between a typo and a
// signal rendered with an invalid date.
test('rejects a signal collectedAt that is not ISO 8601', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      signals: [
        { ...validSignal, collectedAt: '21-09-2026' },
        validData.signals[1],
        validData.signals[2],
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /collectedAt must be ISO 8601/);
});

// checkUrl's third arm: parseable and https, but carrying userinfo, so the
// visible prefix and the real host disagree ("https://api.github.com@evil.example"
// resolves to evil.example). Provenance URLs are rendered as hrefs, so this is
// rejected on its own terms rather than passing on the https scheme alone.
test('rejects a source carrying a userinfo component', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      source: 'https://api.github.com@evil.example/repos/cncf/endusers',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /source must not carry a userinfo component/);
  assert.match(result.stderr, /evil\.example/);
  assert.doesNotMatch(result.stderr, /must use https/);
});

test('rejects a signal sourceUrl carrying a password-only userinfo component', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      signals: [
        { ...validSignal, sourceUrl: 'https://:token@evil.example/stargazers' },
        validData.signals[1],
        validData.signals[2],
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must not carry a userinfo component/);
});

// `data.signals || []` keeps a file with no signals key from throwing on
// .length, so the count check reports it as a data problem instead of the
// script dying with a TypeError. The `|| []` arm is invisible to line
// coverage because the assignment line runs for every file.
test('reports a missing signals key as a count failure, not a crash', () => {
  const withoutSignals = { ...validData };
  delete withoutSignals.signals;
  const result = runScriptWithFixtures(SCRIPT, fixture(withoutSignals));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /signals must define 3-5 signals, got 0/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});

// A signal with no id has no natural label, so every error it raises is
// filed under '(missing id)' rather than the empty string `signal.id` would
// otherwise contribute.
test('labels an id-less signal "(missing id)" in every error it raises', () => {
  const anonymous = { ...validSignal };
  delete anonymous.id;
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, signals: [...validData.signals, anonymous] }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\[error\] \(missing id\): duplicate or missing signal id/,
  );
  assert.doesNotMatch(result.stderr, /\[error\] undefined:/);
});
