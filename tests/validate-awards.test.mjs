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
  assert.match(result.stderr, /verifiedAgainst must be an absolute https URL/);
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
  assert.match(result.stderr, /announcementUrl must use https, got http:/);
});

// The four link fields below are rendered as <a href>, so a value whose
// visible prefix and real authority disagree is the vector these cases pin:
// "https://cncf.io@evil.example" begins with "https://" but resolves to
// evil.example, and a string prefix test cannot tell the difference.
test('rejects a link field carrying a userinfo component', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([
      {
        ...validEntry,
        announcementUrl: 'https://www.cncf.io@evil.example/phish',
      },
    ]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /announcementUrl must not carry a userinfo/);
  assert.match(result.stderr, /evil\.example/);
});

test('rejects a verifiedAgainst carrying a userinfo component', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([validEntry], {
      verifiedAgainst: 'https://contribute.cncf.io@evil.example/awards/',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /verifiedAgainst must not carry a userinfo/);
});

test('rejects an unparseable value that still begins with https://', () => {
  for (const announcementUrl of ['https://', 'https:// evil.example']) {
    const result = runScriptWithFixtures(
      SCRIPT,
      awardsFixture([{ ...validEntry, announcementUrl }]),
    );
    assert.equal(
      result.status,
      1,
      `accepted ${JSON.stringify(announcementUrl)}`,
    );
    assert.match(
      result.stderr,
      /announcementUrl must be an absolute https URL/,
    );
  }
});

test('rejects a javascript: URL in an optional link field', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([
      { ...validEntry, caseStudyUrl: 'javascript:alert(document.domain)' },
    ]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /caseStudyUrl must use https, got javascript:/);
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

test('rejects a logo that escapes /img/awards/ with .. segments', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([
      { ...validEntry, logo: '/img/awards/../../../../../etc/hostname' },
    ]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /logo must live under \/img\/awards\//);
  assert.doesNotMatch(result.stderr, /logo file missing/);
});

test('rejects a logo that escapes static/ entirely via .. segments', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([{ ...validEntry, logo: '/img/awards/../../package.json' }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /logo must live under \/img\/awards\//);
});

test('rejects a non-string logo without crashing', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([{ ...validEntry, logo: 42 }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /logo must be a string path/);
  assert.doesNotMatch(result.stderr, /TypeError/);
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
