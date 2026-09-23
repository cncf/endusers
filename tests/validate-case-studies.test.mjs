import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-case-studies.mjs';

const validEntry = {
  id: 1,
  organization: 'Example Org',
  slug: 'example-org',
  url: 'https://www.cncf.io/case-studies/example-org/',
  publishedAt: '2024-01-01',
  projects: ['Kubernetes'],
  industries: ['Fintech'],
  countries: ['United States'],
};

const validData = {
  generatedAt: '2026-08-07T00:00:00.000Z',
  sourceUrl: 'https://www.cncf.io/case-studies/',
  caseStudies: [validEntry],
};

function fixture(data) {
  return { 'data/case-studies.json': JSON.stringify(data) };
}

test('accepts a minimal valid case studies file', () => {
  const result = runScriptWithFixtures(SCRIPT, fixture(validData));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 case studies/);
});

test('rejects a non-parseable generatedAt', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, generatedAt: 'nope' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /generatedAt must be a parseable date/);
});

test('rejects a non-https sourceUrl', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, sourceUrl: 'http://www.cncf.io/case-studies/' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

test('rejects an empty caseStudies array', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, caseStudies: [] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-empty array/);
});

test('rejects duplicate ids', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, caseStudies: [validEntry, validEntry] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate or missing id/);
});

test('rejects an entry missing organization', () => {
  const { organization, ...withoutOrg } = validEntry;
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, caseStudies: [withoutOrg] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing organization/);
});

test('rejects an entry with a non-array projects field', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      caseStudies: [{ ...validEntry, projects: 'Kubernetes' }],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /projects must be an array/);
});

test('rejects a sourceUrl on a host outside cncf.io', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, sourceUrl: 'https://evil.example/case-studies/' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

test('rejects a sourceUrl that spoofs cncf.io through a userinfo component', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      sourceUrl: 'https://www.cncf.io@evil.example/case-studies/',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

test('rejects an entry url on a host outside cncf.io', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      caseStudies: [{ ...validEntry, url: 'https://evil.example/acme/' }],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /url must be an https URL/);
});

test('rejects an entry url that only prefixes an allowed host', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      caseStudies: [
        { ...validEntry, url: 'https://www.cncf.io.evil.example/acme/' },
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /url must be an https URL/);
});

test('rejects an entry url that spoofs cncf.io through a userinfo component', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      caseStudies: [
        {
          ...validEntry,
          url: 'https://www.cncf.io@evil.example/case-studies/acme/',
        },
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /url must be an https URL/);
});

test('rejects a non-https entry url', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      caseStudies: [
        { ...validEntry, url: 'http://www.cncf.io/case-studies/acme/' },
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /url must be an https URL/);
});

test('accepts an entry url on a cncf.io subdomain', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      caseStudies: [{ ...validEntry, url: 'https://cncf.io/case-studies/acme/' }],
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 case studies/);
});
