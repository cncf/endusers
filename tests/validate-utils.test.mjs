import assert from 'node:assert/strict';
import test from 'node:test';
import { collectError, reportAndExit } from '../scripts/lib/validate-utils.mjs';

// reportAndExit writes to console and may call process.exit(1). Swap all three
// out so the assertions can inspect what a validator run would have emitted
// without terminating the test runner.
function withCapturedConsole(fn) {
  const original = {
    warn: console.warn,
    error: console.error,
    exit: process.exit,
  };
  const warnings = [];
  const errors = [];
  const exitCodes = [];
  console.warn = (message) => warnings.push(String(message));
  console.error = (message) => errors.push(String(message));
  process.exit = (code) => exitCodes.push(code);
  try {
    fn();
  } finally {
    console.warn = original.warn;
    console.error = original.error;
    process.exit = original.exit;
  }
  return { warnings, errors, exitCodes };
}

test('collectError appends a structured entry', () => {
  const errors = [];
  collectError(errors, 'data/awards.json', 'error', 'missing title');
  assert.deepEqual(errors, [
    { path: 'data/awards.json', severity: 'error', message: 'missing title' },
  ]);
});

test('collectError accumulates entries in call order', () => {
  const errors = [];
  collectError(errors, 'first.json', 'warn', 'first message');
  collectError(errors, 'second.json', 'error', 'second message');
  assert.equal(errors.length, 2);
  assert.deepEqual(
    errors.map((e) => e.path),
    ['first.json', 'second.json'],
  );
});

test('collectError keeps entries already present in the array', () => {
  const errors = [{ path: 'pre.json', severity: 'warn', message: 'existing' }];
  collectError(errors, 'new.json', 'error', 'added');
  assert.equal(errors.length, 2);
  assert.equal(errors[0].path, 'pre.json');
});

test('reportAndExit stays silent and does not exit when there are no errors', () => {
  const { warnings, errors, exitCodes } = withCapturedConsole(() => {
    reportAndExit([], 'architecture assets');
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(exitCodes, []);
});

test('reportAndExit prints warnings without exiting', () => {
  const collected = [];
  collectError(collected, 'data/one.json', 'warn', 'missing optional field');
  collectError(collected, 'data/two.json', 'warn', 'deprecated key');

  const { warnings, errors, exitCodes } = withCapturedConsole(() => {
    reportAndExit(collected, 'architecture assets');
  });

  assert.deepEqual(exitCodes, [], 'warnings alone must not fail the validator');
  assert.deepEqual(errors, []);
  assert.match(warnings[0], /2 warning\(s\) in architecture assets:/);
  assert.deepEqual(warnings.slice(1), [
    '  [warn] data/one.json: missing optional field',
    '  [warn] data/two.json: deprecated key',
  ]);
});

test('reportAndExit prints errors and exits with status 1', () => {
  const collected = [];
  collectError(collected, 'data/metrics.json', 'error', 'unknown metric id');

  const { warnings, errors, exitCodes } = withCapturedConsole(() => {
    reportAndExit(collected, 'metrics');
  });

  assert.deepEqual(exitCodes, [1]);
  assert.deepEqual(warnings, []);
  assert.match(errors[0], /1 error\(s\) in metrics:/);
  assert.equal(errors[1], '  [error] data/metrics.json: unknown metric id');
});

test('reportAndExit reports warnings before errors and still exits', () => {
  const collected = [];
  collectError(collected, 'data/a.json', 'warn', 'soft problem');
  collectError(collected, 'data/b.json', 'error', 'hard problem');

  const { warnings, errors, exitCodes } = withCapturedConsole(() => {
    reportAndExit(collected, 'awards');
  });

  assert.deepEqual(exitCodes, [1], 'any error severity must fail the run');
  assert.match(warnings[0], /1 warning\(s\) in awards:/);
  assert.equal(warnings[1], '  [warn] data/a.json: soft problem');
  assert.match(errors[0], /1 error\(s\) in awards:/);
  assert.equal(errors[1], '  [error] data/b.json: hard problem');
});

test('reportAndExit ignores entries with an unrecognised severity', () => {
  const collected = [
    { path: 'data/c.json', severity: 'info', message: 'just a note' },
  ];

  const { warnings, errors, exitCodes } = withCapturedConsole(() => {
    reportAndExit(collected, 'architectures');
  });

  assert.deepEqual(exitCodes, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(errors, []);
});

test('reportAndExit includes the context label supplied by each validator', () => {
  for (const label of ['metrics', 'awards', 'architecture assets']) {
    const { errors } = withCapturedConsole(() => {
      reportAndExit(
        [{ path: 'x.json', severity: 'error', message: 'boom' }],
        label,
      );
    });
    assert.match(errors[0], new RegExp(`in ${label}:`));
  }
});
