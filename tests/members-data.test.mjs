import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = new URL('..', import.meta.url);

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, repoRoot), 'utf8'));
}

const membersData = readJson('data/members.json');
const awardsData = readJson('data/awards.json');
const members = membersData.members;

// src/components/MemberDirectory/index.js dereferences these without guards
// (member.industries.forEach, member.architectures.length,
// member.sourceAttribution.map), so a non-array value fails the site build.
const REQUIRED_ARRAY_FIELDS = [
  'industries',
  'projects',
  'architectures',
  'awards',
  'sourceAttribution',
];

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// members.json is generated, but nothing reconciles its URLs against the
// validated sources it came from: the awards cross-check below compares only
// the slug/year/award key. This is the only gate on the hrefs the member
// directory renders, so it parses rather than prefix-matches. A `/^https:\/\//`
// test accepts "https://www.cncf.io@evil.example/", whose real host is
// evil.example, and accepts the bare string "https://", which is not a URL at
// all. Mirrors isHttpsUrl() in scripts/validate-architectures.mjs.
function httpsUrlProblem(value) {
  if (typeof value !== 'string') return 'must be a string';
  if (value !== value.trim()) return 'must not have surrounding whitespace';
  let url;
  try {
    url = new URL(value);
  } catch {
    return 'must be a parseable URL';
  }
  if (url.protocol !== 'https:') return `must use https, got ${url.protocol}`;
  if (url.username || url.password)
    return `must not carry userinfo; its real host is ${url.host}`;
  return null;
}

function assertHttpsUrl(value, label) {
  const problem = httpsUrlProblem(value);
  assert.equal(problem, null, `${label} ${problem} (${String(value)})`);
}

test('members.json exposes the generated envelope', () => {
  assert.equal(typeof membersData.description, 'string');
  assert.ok(membersData.description.length > 0);
  assert.ok(
    Array.isArray(membersData.generatedFrom),
    'generatedFrom must list the inputs the file is derived from',
  );
  assert.deepEqual(membersData.generatedFrom, [
    'data/architectures/catalog.json',
    'data/awards.json',
  ]);
  assert.equal(typeof membersData.schema, 'object');
  assert.ok(membersData.schema !== null);
});

test('members is a non-empty array', () => {
  assert.ok(Array.isArray(members), 'members must be an array');
  assert.ok(members.length > 0, 'members must not be empty');
});

test('every member documents each schema key', () => {
  for (const member of members) {
    for (const key of Object.keys(membersData.schema)) {
      assert.ok(
        key in member,
        `${member.id ?? '<unknown>'} is missing schema key ${key}`,
      );
    }
  }
});

test('every member carries the arrays MemberDirectory renders', () => {
  for (const member of members) {
    for (const field of REQUIRED_ARRAY_FIELDS) {
      assert.ok(
        Array.isArray(member[field]),
        `${member.id}.${field} must be an array so MemberDirectory can render it`,
      );
    }
  }
});

test('member ids and slugs are unique kebab-case identifiers', () => {
  const seen = new Set();
  for (const member of members) {
    assert.match(
      member.id,
      SLUG_PATTERN,
      `${member.id} must be a kebab-case identifier`,
    );
    assert.equal(
      member.slug,
      member.id,
      `${member.id} slug must match its id so profile links resolve`,
    );
    assert.ok(!seen.has(member.id), `duplicate member id: ${member.id}`);
    seen.add(member.id);
  }
});

test('every member has a non-empty display name', () => {
  for (const member of members) {
    assert.equal(typeof member.name, 'string');
    assert.ok(member.name.trim().length > 0, `${member.id} needs a name`);
  }
});

test('members are sorted by display name', () => {
  const names = members.map((member) => member.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(
    names,
    sorted,
    'generate-members.mjs emits members sorted by name; regenerate the file',
  );
});

test('member logos live under /img/ and exist in static/', () => {
  for (const member of members) {
    if (!member.logo) continue;
    assert.ok(
      member.logo.startsWith('/img/'),
      `${member.id} logo must be a site-absolute /img/ path`,
    );
    const file = fileURLToPath(new URL(`static${member.logo}`, repoRoot));
    assert.ok(
      existsSync(file),
      `${member.id} logo file missing: ${member.logo}`,
    );
  }
});

test('member architecture entries carry their provenance', () => {
  for (const member of members) {
    for (const architecture of member.architectures) {
      for (const field of ['id', 'title', 'sourceUrl', 'sourceCommit']) {
        assert.ok(
          architecture[field],
          `${member.id} architecture is missing ${field}`,
        );
      }
      assertHttpsUrl(
        architecture.sourceUrl,
        `${member.id} architecture sourceUrl`,
      );
      assert.match(
        architecture.sourceCommit,
        /^[0-9a-f]{40}$/,
        `${member.id} architecture sourceCommit must be a full commit sha`,
      );
    }
  }
});

test('member award entries carry the fields the profile renders', () => {
  for (const member of members) {
    for (const award of member.awards) {
      for (const field of [
        'year',
        'award',
        'awardLabel',
        'citation',
        'event',
      ]) {
        assert.ok(award[field], `${member.id} award is missing ${field}`);
      }
      assert.ok(
        Number.isInteger(award.year) && award.year >= 2015,
        `${member.id} award year must be an integer from 2015 onwards`,
      );
      for (const field of ['announcementUrl', 'caseStudyUrl', 'talkUrl']) {
        if (!award[field]) continue;
        assertHttpsUrl(award[field], `${member.id} award ${field}`);
      }
    }
  }
});

test('sourceAttribution entries are https URLs', () => {
  for (const member of members) {
    for (const url of member.sourceAttribution) {
      assertHttpsUrl(url, `${member.id} sourceAttribution entry`);
    }
  }
});

test('every awards.json winner has a member entry', () => {
  const memberIds = new Set(members.map((member) => member.id));
  for (const award of awardsData.awards) {
    assert.ok(
      memberIds.has(award.slug),
      `awards.json lists ${award.organization} (${award.slug}) but members.json has no matching member; regenerate with npm run generate:members`,
    );
  }
});

test('every member award matches an awards.json entry', () => {
  const awardKeys = new Set(
    awardsData.awards.map(
      (award) => `${award.slug}/${award.year}/${award.award}`,
    ),
  );
  for (const member of members) {
    for (const award of member.awards) {
      const key = `${member.id}/${award.year}/${award.award}`;
      assert.ok(
        awardKeys.has(key),
        `${member.id} claims award ${key} that awards.json does not list`,
      );
    }
  }
});

test('members with no public detail still carry attribution', () => {
  for (const member of members) {
    const hasDetail =
      member.industries.length > 0 ||
      member.projects.length > 0 ||
      member.architectures.length > 0 ||
      member.awards.length > 0;
    if (hasDetail) continue;
    assert.ok(
      member.sourceAttribution.length > 0,
      `${member.id} has no detail to render, so it needs sourceAttribution`,
    );
  }
});

test('the URL gate rejects what a bare https prefix test would accept', () => {
  for (const value of [
    'https://www.cncf.io@evil.example/phish',
    'https://cncf.io@127.0.0.1/',
    'https://user:pass@evil.example/',
    'https://',
    'http://cncf.io/',
    'javascript:alert(1)',
    ' https://cncf.io/',
    42,
    null,
  ]) {
    assert.notEqual(
      httpsUrlProblem(value),
      null,
      `${String(value)} must be rejected`,
    );
  }
});

test('the URL gate accepts ordinary https source links', () => {
  for (const value of [
    'https://cncf.io/',
    'https://github.com/cncf/endusers',
    'https://www.cncf.io/case-studies/example/?utm=1#section',
  ]) {
    assert.equal(httpsUrlProblem(value), null, `${value} must be accepted`);
  }
});
