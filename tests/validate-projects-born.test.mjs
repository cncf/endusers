import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-projects-born.mjs';

const validEntry = {
  name: 'Envoy',
  origin: 'Lyft',
  description: 'Originally built at Lyft before becoming a CNCF project.',
  url: 'https://www.envoyproxy.io/',
};

const validData = [
  validEntry,
  {
    name: 'Jaeger',
    origin: 'Uber',
    description: 'Open sourced by Uber to make distributed tracing practical.',
    url: 'https://www.jaegertracing.io/',
  },
];

function fixture(data) {
  return { 'data/projects-born.json': JSON.stringify(data) };
}

test('accepts a valid projects-born file', () => {
  const result = runScriptWithFixtures(SCRIPT, fixture(validData));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 2 born projects/);
});

test('rejects a file that is not an array', () => {
  const result = runScriptWithFixtures(SCRIPT, fixture({ projects: [] }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be a non-empty array/);
});

test('rejects an empty array', () => {
  const result = runScriptWithFixtures(SCRIPT, fixture([]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be a non-empty array/);
});

// The control this validator exists for: the visible prefix reads as the
// project's own site while the request resolves to the userinfo-suffixed host.
test('rejects a url carrying a userinfo component', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture([
      { ...validEntry, url: 'https://www.envoyproxy.io@evil.example/' },
    ]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not carry a userinfo component/);
  assert.match(result.stderr, /evil\.example/);
});

test('rejects a non-https url', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture([{ ...validEntry, url: 'http://www.envoyproxy.io/' }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must use https, got http:/);
});

test('rejects a javascript: url', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture([{ ...validEntry, url: 'javascript:alert(1)' }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must use https, got javascript:/);
});

test('rejects an unparseable url', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture([{ ...validEntry, url: 'www.envoyproxy.io' }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be an absolute https URL/);
});

test('rejects a missing url', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture([{ ...validEntry, url: undefined }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /url must be a non-empty string/);
});

test('rejects a blank url', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture([{ ...validEntry, url: '   ' }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /url must be a non-empty string/);
});

test('rejects a non-string url', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture([{ ...validEntry, url: 42 }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /url must be a non-empty string/);
});

for (const field of ['name', 'origin', 'description']) {
  test(`rejects a missing ${field}`, () => {
    const result = runScriptWithFixtures(
      SCRIPT,
      fixture([{ ...validEntry, [field]: undefined }]),
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      new RegExp(`${field} must be a non-empty string`),
    );
  });

  test(`rejects a blank ${field}`, () => {
    const result = runScriptWithFixtures(
      SCRIPT,
      fixture([{ ...validEntry, [field]: '  ' }]),
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      new RegExp(`${field} must be a non-empty string`),
    );
  });
}

// A non-string name still has to produce a readable error path rather than
// crashing the report, so the entry is labelled "unknown".
test('labels an entry with a non-string name as unknown', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture([{ ...validEntry, name: 7 }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown: name must be a non-empty string/);
});

test('rejects duplicate names', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture([validEntry, { ...validEntry }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate name/);
});

// A null entry must be reported rather than crash the walk on property access.
test('reports a null entry instead of throwing', () => {
  const result = runScriptWithFixtures(SCRIPT, fixture([null]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown: name must be a non-empty string/);
  assert.match(result.stderr, /unknown: url must be a non-empty string/);
});
