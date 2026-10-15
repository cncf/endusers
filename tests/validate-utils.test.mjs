import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  checkIsoTimestamp,
  checkNonEmptyArray,
  checkUrl,
  collectError,
  isSafeUrl,
  publishableCncfUrl,
  reportAndExit,
} from '../scripts/lib/validate-utils.mjs';

const MODULE_URL = new URL('../scripts/lib/validate-utils.mjs', import.meta.url)
  .href;

// reportAndExit writes its report straight to stderr's file descriptor and may
// call process.exit(1). Swap fs.writeSync and process.exit out so the
// assertions can inspect what a validator run would have emitted without
// polluting the test runner's own output or terminating it.
function withCapturedStderr(fn, { writeSync } = {}) {
  const originalWriteSync = fs.writeSync;
  const originalExit = process.exit;
  const chunks = [];
  const exitCodes = [];
  fs.writeSync = (fd, buffer, offset) => {
    assert.equal(fd, process.stderr.fd, 'the report must go to stderr');
    const written = writeSync
      ? writeSync(buffer, offset)
      : buffer.length - offset;
    chunks.push(buffer.subarray(offset, offset + written).toString('utf8'));
    return written;
  };
  process.exit = (code) => exitCodes.push(code);
  try {
    fn();
  } finally {
    fs.writeSync = originalWriteSync;
    process.exit = originalExit;
  }

  // Reassemble the accepted bytes and sort each line into the report it
  // belongs to; a report starts at its "N warning(s)/error(s)" header.
  const warnings = [];
  const errors = [];
  let target = null;
  for (const line of chunks.join('').replace(/\n$/, '').split('\n')) {
    if (line.includes('warning(s) in ')) target = warnings;
    else if (line.includes('error(s) in ')) target = errors;
    else if (!target) continue;
    if (line === '') continue;
    target.push(target.length === 0 ? `\n${line}` : line);
  }
  return { warnings, errors, exitCodes, chunks };
}

test('checkUrl accepts a valid https URL and pushes no error', () => {
  const errors = [];
  checkUrl(errors, 'data/awards.json', 'announcementUrl', 'https://cncf.io/x');
  assert.deepEqual(errors, []);
});

test('checkUrl rejects an unparseable value with the default message', () => {
  const errors = [];
  checkUrl(errors, 'path', 'field', 'not a url');
  assert.deepEqual(errors, [
    {
      path: 'path',
      severity: 'error',
      message: 'field must be an absolute https URL',
    },
  ]);
});

test('checkUrl uses a custom unparsedMessage when supplied', () => {
  const errors = [];
  checkUrl(errors, 'path', 'url', 'not a url', {
    unparsedMessage: `url must be an absolute https URL: ${JSON.stringify('not a url')}`,
  });
  assert.equal(
    errors[0].message,
    'url must be an absolute https URL: "not a url"',
  );
});

test('checkUrl allowEmpty treats null, undefined, and the empty string as valid', () => {
  for (const value of [null, undefined, '']) {
    const errors = [];
    checkUrl(errors, 'path', 'field', value, { allowEmpty: true });
    assert.deepEqual(
      errors,
      [],
      `value ${JSON.stringify(value)} must be accepted`,
    );
  }
});

test('checkUrl without allowEmpty rejects an empty value as unparseable', () => {
  const errors = [];
  checkUrl(errors, 'path', 'field', '');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /must be an absolute https URL/);
});

test('checkUrl requireNonEmptyString rejects a non-string value', () => {
  const errors = [];
  checkUrl(errors, 'path', 'field', null, { requireNonEmptyString: true });
  assert.deepEqual(errors, [
    {
      path: 'path',
      severity: 'error',
      message: 'field must be a non-empty string',
    },
  ]);
});

test('checkUrl requireNonEmptyString rejects a blank string', () => {
  const errors = [];
  checkUrl(errors, 'path', 'field', '   ', { requireNonEmptyString: true });
  assert.match(errors[0].message, /must be a non-empty string/);
});

test('checkUrl requireNonEmptyString trims the value before parsing', () => {
  const errors = [];
  checkUrl(errors, 'path', 'field', '  https://cncf.io/x  ', {
    requireNonEmptyString: true,
  });
  assert.deepEqual(errors, []);
});

test('checkUrl rejects a protocol outside the allowed set', () => {
  const errors = [];
  checkUrl(errors, 'path', 'field', 'http://cncf.io');
  assert.deepEqual(errors, [
    {
      path: 'path',
      severity: 'error',
      message: 'field must use https, got http:',
    },
  ]);
});

test('checkUrl joins multiple allowed protocols with "or" in the rejection message', () => {
  const errors = [];
  checkUrl(errors, 'path', 'field', 'javascript:alert(1)', {
    protocols: ['http:', 'https:'],
  });
  assert.equal(
    errors[0].message,
    'field must use http or https, got javascript:',
  );
});

test('checkUrl accepts any protocol in a multi-protocol allow-list', () => {
  const errors = [];
  checkUrl(errors, 'path', 'field', 'http://cncf.io', {
    protocols: ['http:', 'https:'],
  });
  assert.deepEqual(errors, []);
});

test('checkUrl rejects a userinfo component that disguises the real host', () => {
  const errors = [];
  checkUrl(errors, 'path', 'field', 'https://cncf.io@evil.example/');
  assert.deepEqual(errors, [
    {
      path: 'path',
      severity: 'error',
      message:
        'field must not carry a userinfo component, which only disguises the real host (evil.example)',
    },
  ]);
});

test('checkUrl allows a host on the allow-list', () => {
  const errors = [];
  checkUrl(errors, 'path', 'field', 'https://docs.cncf.io/x', {
    allowedHostSuffixes: ['cncf.io'],
  });
  assert.deepEqual(errors, []);
});

test('checkUrl rejects a host outside the allow-list', () => {
  const errors = [];
  checkUrl(errors, 'path', 'field', 'https://evil.example/x', {
    allowedHostSuffixes: ['cncf.io', 'github.com'],
  });
  assert.deepEqual(errors, [
    {
      path: 'path',
      severity: 'error',
      message: 'field must be on cncf.io or github.com, got evil.example',
    },
  ]);
});

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
  const { warnings, errors, exitCodes } = withCapturedStderr(() => {
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

  const { warnings, errors, exitCodes } = withCapturedStderr(() => {
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

  const { warnings, errors, exitCodes } = withCapturedStderr(() => {
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

  const { warnings, errors, exitCodes } = withCapturedStderr(() => {
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

  const { warnings, errors, exitCodes } = withCapturedStderr(() => {
    reportAndExit(collected, 'architectures');
  });

  assert.deepEqual(exitCodes, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(errors, []);
});

test('reportAndExit includes the context label supplied by each validator', () => {
  for (const label of ['metrics', 'awards', 'architecture assets']) {
    const { errors } = withCapturedStderr(() => {
      reportAndExit(
        [{ path: 'x.json', severity: 'error', message: 'boom' }],
        label,
      );
    });
    assert.match(errors[0], new RegExp(`in ${label}:`));
  }
});

test('reportAndExit writes each report to stderr in a single call', () => {
  const { chunks } = withCapturedStderr(() => {
    reportAndExit(
      [
        { path: 'a.json', severity: 'warn', message: 'soft' },
        { path: 'b.json', severity: 'error', message: 'boom' },
      ],
      'metrics',
    );
  });

  assert.equal(chunks.length, 2, 'one call per report, warnings first');
  assert.ok(chunks.every((chunk) => chunk.endsWith('\n')));
  assert.match(chunks[0], /warning\(s\) in metrics:/);
  assert.match(chunks[1], /error\(s\) in metrics:/);
});

test('reportAndExit no longer routes its report through console', () => {
  // console.error/console.warn are asynchronous on a POSIX pipe, which is what
  // let process.exit(1) drop the tail of a report.
  const source = fs
    .readFileSync(
      fileURLToPath(
        new URL('../scripts/lib/validate-utils.mjs', import.meta.url),
      ),
      'utf8',
    )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /console\.(error|warn|log)\(/);
});

test('reportAndExit resumes a partially accepted write until the report is complete', () => {
  const collected = [];
  collectError(collected, 'data/a.json', 'error', 'first');
  collectError(collected, 'data/b.json', 'error', 'second');

  // A pipe may accept fewer bytes than offered; the remainder must be retried.
  const { errors, exitCodes, chunks } = withCapturedStderr(
    () => reportAndExit(collected, 'members'),
    {
      writeSync: (buffer, offset) =>
        Math.max(1, Math.ceil((buffer.length - offset) / 3)),
    },
  );

  assert.deepEqual(exitCodes, [1]);
  assert.ok(chunks.length > 1, 'a short write must be followed by another');
  assert.match(errors[0], /2 error\(s\) in members:/);
  assert.deepEqual(errors.slice(1), [
    '  [error] data/a.json: first',
    '  [error] data/b.json: second',
  ]);
});

test('reportAndExit retries a write that stderr refuses with EAGAIN', () => {
  let refused = false;
  const { errors, exitCodes } = withCapturedStderr(
    () =>
      reportAndExit(
        [{ path: 'x.json', severity: 'error', message: 'boom' }],
        'awards',
      ),
    {
      writeSync: (buffer, offset) => {
        if (refused) return buffer.length - offset;
        refused = true;
        throw Object.assign(new Error('resource temporarily unavailable'), {
          code: 'EAGAIN',
        });
      },
    },
  );

  assert.ok(refused, 'the first write must have been refused');
  assert.deepEqual(exitCodes, [1]);
  assert.equal(errors.at(-1), '  [error] x.json: boom');
});

test('reportAndExit propagates a write failure that is not EAGAIN', () => {
  assert.throws(
    () =>
      withCapturedStderr(
        () =>
          reportAndExit(
            [{ path: 'x.json', severity: 'error', message: 'boom' }],
            'awards',
          ),
        {
          writeSync: () => {
            throw Object.assign(new Error('bad file descriptor'), {
              code: 'EBADF',
            });
          },
        },
      ),
    /bad file descriptor/,
  );
});

test('reportAndExit delivers a long report through a pipe without losing its tail', () => {
  // Regression: console.error is asynchronous on a POSIX pipe and
  // process.exit() does not flush it, so the alphabetical tail of a large
  // validator report could be dropped before the parent read it.
  const source = `
    import { reportAndExit } from ${JSON.stringify(MODULE_URL)};
    const errors = Array.from({ length: 2000 }, (unused, index) => ({
      path: 'data/member-' + String(index).padStart(4, '0') + '.json',
      severity: 'error',
      message: 'logo does not exist under static/',
    }));
    reportAndExit(errors, 'members');
  `;
  // The child must not inherit this run's coverage directory or test context:
  // its records would pollute the suite's coverage with an unmappable --eval
  // module.
  const env = { ...process.env };
  delete env.NODE_V8_COVERAGE;
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', source],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env },
  );

  assert.equal(result.status, 1);
  const lines = result.stderr.trimEnd().split('\n');
  assert.match(lines[1], /2000 error\(s\) in members:/);
  assert.equal(lines.length, 2002, 'every collected error must reach the pipe');
  assert.equal(
    lines.at(-1),
    '  [error] data/member-1999.json: logo does not exist under static/',
  );
});

test('every validator that reports errors prints a success line afterwards', () => {
  // process.exitCode = 1 would be an incorrect fix here: each validator prints
  // a "Validated N ..." line after reportAndExit(), which must stay
  // unreachable once errors have been reported.
  const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
  const validators = fs
    .readdirSync(scripts)
    .filter((name) => name.startsWith('validate-') && name.endsWith('.mjs'))
    .map((name) => [name, fs.readFileSync(`${scripts}${name}`, 'utf8')])
    .filter(([, source]) => source.includes('reportAndExit'));

  assert.ok(validators.length >= 12, 'all shared validators must be scanned');
  for (const [name, source] of validators) {
    const call = source.search(/^reportAndExit\(/m);
    assert.notEqual(
      call,
      -1,
      `${name} must call the shared helper at top level`,
    );
    assert.match(
      source.slice(call),
      /\nconsole\.log\(/,
      `${name} prints a success line that reportAndExit must not fall through to`,
    );
  }
});

test('isSafeUrl returns the parsed URL for a safe value', () => {
  const parsed = isSafeUrl('https://www.cncf.io/projects/', {
    allowedHostSuffixes: ['cncf.io'],
  });
  assert.equal(parsed.pathname, '/projects/');
});

test('isSafeUrl returns null for a failing scheme, userinfo, host, or parse', () => {
  const options = { allowedHostSuffixes: ['cncf.io'] };
  for (const value of [
    'http://cncf.io/',
    'https://cncf.io@evil.example/',
    'https://evil.example/',
    'not a url',
  ]) {
    assert.equal(isSafeUrl(value, options), null, value);
  }
});

test('isSafeUrl resolves a bare host against options.defaultScheme', () => {
  const parsed = isSafeUrl('example.test/blog', { defaultScheme: 'https:' });
  assert.equal(parsed.href, 'https://example.test/blog');
});

test('isSafeUrl applies defaultScheme only to values without a scheme', () => {
  const options = { defaultScheme: 'https:' };
  assert.equal(
    isSafeUrl('http://example.test/', { ...options, protocols: ['http:'] })
      .href,
    'http://example.test/',
  );
  // A scheme the protocol check rejects is not rescued by the default.
  assert.equal(isSafeUrl('javascript:alert(1)', options), null);
  // A userinfo authority smuggled into a bare host is still rejected.
  assert.equal(isSafeUrl('www.cncf.io@evil.example/login', options), null);
  // Non-strings pass through untouched and still fail to parse.
  assert.equal(isSafeUrl(42, options), null);
});

test('checkUrl reports the parse failure message for a schemeless value without defaultScheme', () => {
  const errors = [];
  checkUrl(errors, 'p', 'site', 'example.test');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /must be an absolute https URL/);

  const coerced = [];
  checkUrl(coerced, 'p', 'site', 'example.test', { defaultScheme: 'https:' });
  assert.deepEqual(coerced, []);
});

// The predicate the case-studies and radar-reports validators share for the
// cncf.io links they publish: a trimmed https URL on a CNCF host, or null.
test('publishableCncfUrl accepts a trimmed https URL on a CNCF host', () => {
  assert.equal(
    publishableCncfUrl(' https://www.cncf.io/reports/x/ ').href,
    'https://www.cncf.io/reports/x/',
  );
});

test('publishableCncfUrl returns null for non-strings and off-list or spoofed hosts', () => {
  for (const value of [
    undefined,
    42,
    'https://evil.example/',
    'https://www.cncf.io.evil.example/',
    'https://www.cncf.io@evil.example/',
    'http://www.cncf.io/',
  ]) {
    assert.equal(publishableCncfUrl(value), null, String(value));
  }
});

test('checkNonEmptyArray accepts a non-empty array and pushes no error', () => {
  const errors = [];
  const ok = checkNonEmptyArray(errors, 'data/awards.json', 'awards', [1]);
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
});

test('checkNonEmptyArray reports an empty array, a non-array and a missing value', () => {
  for (const value of [[], 'not-an-array', undefined, null]) {
    const errors = [];
    const ok = checkNonEmptyArray(errors, 'data/awards.json', 'awards', value);
    assert.equal(ok, false, String(value));
    assert.deepEqual(errors, [
      {
        path: 'data/awards.json',
        severity: 'error',
        message: 'awards must be a non-empty array',
      },
    ]);
  }
});

test('checkIsoTimestamp accepts a strict ISO 8601 UTC value and pushes no error', () => {
  const errors = [];
  const ok = checkIsoTimestamp(
    errors,
    'data/launch-metrics.json',
    'generatedAt',
    '2026-09-21T00:00:00.000Z',
  );
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
});

test('checkIsoTimestamp rejects a loose Date.parse-able value with the default message', () => {
  const errors = [];
  const ok = checkIsoTimestamp(
    errors,
    'data/launch-metrics.json',
    'generatedAt',
    'March 1, 2026',
  );
  assert.equal(ok, false);
  assert.deepEqual(errors, [
    {
      path: 'data/launch-metrics.json',
      severity: 'error',
      message: 'generatedAt must be ISO 8601',
    },
  ]);
});

test('checkIsoTimestamp uses a custom message when supplied', () => {
  const errors = [];
  checkIsoTimestamp(
    errors,
    'data/community-people.json',
    'fetchedAt',
    'not a date',
    { message: 'fetchedAt must be strict ISO 8601' },
  );
  assert.deepEqual(errors, [
    {
      path: 'data/community-people.json',
      severity: 'error',
      message: 'fetchedAt must be strict ISO 8601',
    },
  ]);
});

test('checkIsoTimestamp treats a missing value as a format failure, not a crash', () => {
  const errors = [];
  const ok = checkIsoTimestamp(
    errors,
    'data/launch-metrics.json',
    'generatedAt',
    undefined,
  );
  assert.equal(ok, false);
  assert.deepEqual(errors, [
    {
      path: 'data/launch-metrics.json',
      severity: 'error',
      message: 'generatedAt must be ISO 8601',
    },
  ]);
});

test('checkIsoTimestamp accepts a value inside the future-tolerance window', () => {
  const errors = [];
  const ok = checkIsoTimestamp(
    errors,
    'data/community-groups.json',
    'checkedAt',
    new Date(Date.now() + 30_000).toISOString(),
    { futureToleranceMs: 60_000 },
  );
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
});

test('checkIsoTimestamp rejects a value beyond the future-tolerance window with the default message', () => {
  const errors = [];
  const ok = checkIsoTimestamp(
    errors,
    'data/community-groups.json',
    'checkedAt',
    new Date(Date.now() + 86_400_000).toISOString(),
    { futureToleranceMs: 60_000 },
  );
  assert.equal(ok, false);
  assert.deepEqual(errors, [
    {
      path: 'data/community-groups.json',
      severity: 'error',
      message: 'checkedAt cannot be in the future',
    },
  ]);
});

test('checkIsoTimestamp uses a custom futureMessage when supplied', () => {
  const errors = [];
  checkIsoTimestamp(
    errors,
    'data/community-people.json',
    'fetchedAt',
    new Date(Date.now() + 86_400_000).toISOString(),
    {
      futureToleranceMs: 60_000,
      futureMessage: 'fetchedAt cannot be in the future',
    },
  );
  assert.deepEqual(errors, [
    {
      path: 'data/community-people.json',
      severity: 'error',
      message: 'fetchedAt cannot be in the future',
    },
  ]);
});
