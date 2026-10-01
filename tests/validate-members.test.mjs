import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-members.mjs';
const LOGO = '/img/awards/example.svg';

const validMember = {
  id: 'example-org',
  name: 'Example Org',
  slug: 'example-org',
  logo: LOGO,
  industries: ['Fintech'],
  projects: ['Kubernetes'],
  architectures: [
    {
      id: 'example-org',
      title: 'Example Org platform',
      sourceUrl:
        'https://github.com/cncf/architecture/tree/abc123/content/en/architectures/example-org',
      sourceCommit: 'abc123',
    },
  ],
  awards: [
    {
      year: 2024,
      award: 'top-end-user',
      awardLabel: 'Top End User Award',
      citation: 'Contributed to CNCF projects.',
      event: 'KubeCon',
      announcementUrl: 'https://www.cncf.io/announcements/example-org/',
      caseStudyUrl: null,
      talkUrl: null,
    },
  ],
  sourceAttribution: ['https://www.cncf.io/announcements/example-org/'],
};

const validData = {
  description: 'CNCF End User Community member organisations.',
  generatedFrom: ['data/architectures/catalog.json', 'data/awards.json'],
  members: [validMember],
};

// The logo check resolves against static/, so every fixture needs the asset
// on disk for a valid case to stay valid.
function fixture(data) {
  return {
    'data/members.json': JSON.stringify(data),
    [`static${LOGO}`]: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  };
}

function withMember(overrides) {
  return fixture({
    ...validData,
    members: [{ ...validMember, ...overrides }],
  });
}

test('accepts a minimal valid members file', () => {
  const result = runScriptWithFixtures(SCRIPT, fixture(validData));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 members/);
});

test('accepts a member with no logo', () => {
  const result = runScriptWithFixtures(SCRIPT, withMember({ logo: null }));
  assert.equal(result.status, 0, result.stderr);
});

test('rejects an empty members array', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, members: [] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /members must be a non-empty array/);
});

test('rejects a members key that is not an array', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, members: { id: 'example-org' } }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /members must be a non-empty array/);
});

test('rejects a missing required text field', () => {
  const result = runScriptWithFixtures(SCRIPT, withMember({ name: '' }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /name must be a non-empty string/);
});

test('reports an unnamed member against the "unknown" path', () => {
  const result = runScriptWithFixtures(SCRIPT, withMember({ id: 42 }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown: id must be a non-empty string/);
});

test('rejects a duplicate id', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, members: [validMember, validMember] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate id/);
});

test('rejects a non-array required collection', () => {
  const result = runScriptWithFixtures(SCRIPT, withMember({ projects: 'k8s' }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /projects must be an array/);
});

// An absolute URL is returned unchanged by Docusaurus useBaseUrl(), so it
// reaches the page as a live <img src> fetched from a third-party host on load.
test('rejects an absolute http(s) logo URL', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    withMember({ logo: 'https://evil.example/beacon.png' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /logo must be a site-local path/);
});

test('rejects a protocol-relative logo URL', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    withMember({ logo: '//evil.example/beacon.png' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /logo must be a site-local path/);
});

test('rejects a non-http scheme in a logo', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    withMember({ logo: 'data:image/svg+xml,<svg onload="alert(1)"/>' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /logo must be a site-local path/);
});

test('rejects a relative logo path', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    withMember({ logo: 'img/awards/example.svg' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /logo must start with "\/"/);
});

test('rejects a logo that traverses out of static/', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    withMember({ logo: '/../data/members.json' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not traverse out of the static directory/);
});

test('rejects a logo that does not exist under static/', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    withMember({ logo: '/img/awards/missing.svg' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /logo does not exist under static\//);
});

test('rejects a non-string logo', () => {
  const result = runScriptWithFixtures(SCRIPT, withMember({ logo: 12 }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /logo must be null or a non-empty site-local/);
});

test('rejects a javascript: URL in sourceAttribution', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    withMember({ sourceAttribution: ['javascript:alert(1)'] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceAttribution\[\] must use https/);
});

test('rejects an empty sourceAttribution entry', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    withMember({ sourceAttribution: ['  '] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceAttribution\[\] must be a non-empty/);
});

test('rejects an unparseable sourceAttribution entry', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    withMember({ sourceAttribution: ['https://'] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be an absolute https URL/);
});

// "https://www.cncf.io@evil.example/" parses with protocol https: while
// resolving to evil.example, so a prefix test would pass it through.
test('rejects a userinfo component that disguises the real host', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    withMember({
      sourceAttribution: ['https://www.cncf.io@evil.example/a'],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not carry a userinfo component/);
});

test('rejects a non-https architectures sourceUrl', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    withMember({
      architectures: [{ id: 'x', sourceUrl: 'http://example.com/a' }],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /architectures\[\]\.sourceUrl must use https/);
});

test('rejects a non-https award URL', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    withMember({
      awards: [{ ...validMember.awards[0], talkUrl: 'http://evil.example/t' }],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /awards\[\]\.talkUrl must use https/);
});

test('accepts award URL fields that are absent rather than null', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    withMember({ awards: [{ year: 2024, award: 'top-end-user' }] }),
  );
  assert.equal(result.status, 0, result.stderr);
});
