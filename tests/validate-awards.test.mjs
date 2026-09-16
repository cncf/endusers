import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-awards.mjs';

const validEntry = {
  year: 2024,
  slug: 'acme',
  award: 'Top End User Award',
  awardLabel: 'Winner',
  organization: 'Acme Corp',
  citation: 'For outstanding adoption of cloud native.',
  event: 'KubeCon NA 2024',
  announcementUrl: 'https://www.cncf.io/announcements/2024/example',
};

function awardsFixture(awards, overrides = {}) {
  return {
    'data/awards.json': JSON.stringify({
      verifiedAt: '2026-08-08',
      verifiedAgainst: 'https://contribute.cncf.io/community/awards/',
      awards,
      ...overrides,
    }),
  };
}

test('accepts a valid awards file', () => {
  const result = runScriptWithFixtures(SCRIPT, awardsFixture([validEntry]));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 award/);
});

test('rejects an empty awards array', () => {
  const result = runScriptWithFixtures(SCRIPT, awardsFixture([]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-empty array/);
});

test('rejects a missing verifiedAt', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([validEntry], { verifiedAt: undefined }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /verifiedAt must be a parseable date/);
});

test('rejects a non-https verifiedAgainst', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([validEntry], {
      verifiedAgainst: 'contribute.cncf.io/community/awards/',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /verifiedAgainst must be an https URL/);
});

test('rejects years before 2015', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([{ ...validEntry, year: 2014 }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid year/);
});

test('rejects entries sorted oldest first', () => {
  const older = { ...validEntry, year: 2022, slug: 'older' };
  const newer = { ...validEntry, year: 2023, slug: 'newer' };
  const result = runScriptWithFixtures(SCRIPT, awardsFixture([older, newer]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /newest first/);
});

test('accepts entries sorted newest first', () => {
  const newer = { ...validEntry, year: 2024, slug: 'newer' };
  const older = { ...validEntry, year: 2023, slug: 'older' };
  const result = runScriptWithFixtures(SCRIPT, awardsFixture([newer, older]));
  assert.equal(result.status, 0, result.stderr);
});

test('rejects missing required fields', () => {
  const { citation, ...withoutCitation } = validEntry;
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([withoutCitation]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing citation/);
});

test('rejects non-https URLs', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([
      { ...validEntry, announcementUrl: 'http://example.com/award' },
    ]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be https/);
});

test('rejects entries with neither announcementUrl nor talkUrl', () => {
  const { announcementUrl, ...withoutUrl } = validEntry;
  const result = runScriptWithFixtures(SCRIPT, awardsFixture([withoutUrl]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /announcementUrl or talkUrl/);
});

test('accepts a talkUrl in place of an announcementUrl', () => {
  const { announcementUrl, ...rest } = validEntry;
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([{ ...rest, talkUrl: 'https://youtube.com/watch?v=1' }]),
  );
  assert.equal(result.status, 0, result.stderr);
});

test('rejects logos outside /img/awards/', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([{ ...validEntry, logo: '/img/other/logo.svg' }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\/img\/awards\//);
});

test('rejects logo files missing from static/', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([{ ...validEntry, logo: '/img/awards/missing.svg' }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /logo file missing/);
});

test('accepts a logo that exists under static/img/awards/', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    ...awardsFixture([{ ...validEntry, logo: '/img/awards/acme.svg' }]),
    'static/img/awards/acme.svg':
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  });
  assert.equal(result.status, 0, result.stderr);
});
