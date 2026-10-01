import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-members.mjs';
const REVISION = 'bc9d1b5c87904d9430fc3377938f38192bab3ad0';
const SOURCE_URL = `https://github.com/cncf/landscape/blob/${REVISION}/landscape.yml`;

function source(sourceId, role) {
  return {
    sourceId,
    role,
    sourceName: `${role} organization (${role})`,
    category: 'CNCF Members',
    subcategory:
      role === 'contributor' ? 'End User Supporter and Contributor' : 'Gold',
    homepageUrl: 'https://example.test/',
    joined: '2026-01-01',
    localLogo: null,
    sourceUrl: SOURCE_URL,
  };
}

function member(id, membershipStatus, membershipSources = []) {
  return {
    id,
    name: id,
    slug: id,
    logo: null,
    industries: [],
    projects: [],
    architectures: [],
    awards: [],
    sourceAttribution: [],
    membershipStatus,
    membershipSources,
  };
}

function snapshot(sourceIds) {
  return {
    generated: true,
    collectedAt: '2026-10-01T00:00:00.000Z',
    source: {
      repository: 'https://github.com/cncf/landscape',
      revision: REVISION,
      file: 'landscape.yml',
      sourceUrl: SOURCE_URL,
    },
    records: sourceIds.map((sourceId) => ({
      sourceId,
      included: true,
    })),
  };
}

function run(members, landscape) {
  return runScriptWithFixtures(SCRIPT, {
    'data/members.json': JSON.stringify({
      description: 'directory',
      generatedFrom: ['data/enduser-landscape.json'],
      sources: {
        landscape: {
          repository: 'https://github.com/cncf/landscape',
          revision: REVISION,
          sourceUrl: SOURCE_URL,
        },
      },
      schema: {},
      members,
    }),
    'data/enduser-landscape.json': JSON.stringify(landscape),
  });
}

test('accepts every explicit membership status', () => {
  const memberSource = source('member-source', 'member');
  const contributorSource = source('contributor-source', 'contributor');
  const combinedMemberSource = source('combined-member-source', 'member');
  const combinedContributorSource = source(
    'combined-contributor-source',
    'contributor',
  );
  const result = run(
    [
      member('member-org', 'member', [memberSource]),
      member('contributor-org', 'contributor', [contributorSource]),
      member('combined-org', 'member-and-contributor', [
        combinedMemberSource,
        combinedContributorSource,
      ]),
      member('unknown-org', 'unknown'),
    ],
    snapshot([
      'member-source',
      'contributor-source',
      'combined-member-source',
      'combined-contributor-source',
    ]),
  );
  assert.equal(result.status, 0, result.stderr);
});

test('rejects malformed membership fields and sources', () => {
  const badSource = {
    sourceId: '',
    role: 'supporter',
    sourceName: '',
    category: '',
    subcategory: '',
    sourceUrl: 'http://example.test/',
    localLogo: 'https://evil.example/logo.svg',
  };
  const result = run(
    [
      member('bad-status', 'not-a-status'),
      {
        ...member('bad-array', 'member'),
        membershipSources: 'not-an-array',
      },
      member('bad-source', 'member', [badSource]),
    ],
    snapshot([]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /membershipStatus must be one of/);
  assert.match(result.stderr, /membershipSources must be an array/);
  assert.match(result.stderr, /sourceId must be a non-empty string/);
  assert.match(result.stderr, /role must be member or contributor/);
  assert.match(result.stderr, /must use https/);
  assert.match(result.stderr, /logo must be a site-local path/);
});

test('rejects status and source-role mismatches', () => {
  const memberSource = source('member-source', 'member');
  const contributorSource = source('contributor-source', 'contributor');
  const result = run(
    [
      member('unknown-with-source', 'unknown', [memberSource]),
      member('member-with-contributor', 'member', [contributorSource]),
      member('contributor-with-member', 'contributor', [memberSource]),
      member('combined-with-member', 'member-and-contributor', [memberSource]),
    ],
    snapshot(['member-source', 'contributor-source']),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown membership must not carry/);
  assert.match(result.stderr, /member status must carry only member/);
  assert.match(result.stderr, /contributor status must carry only contributor/);
  assert.match(result.stderr, /member-and-contributor status must carry both/);
});

test('rejects duplicate, missing, unexpected, and stale landscape provenance', () => {
  const memberSource = source('member-source', 'member');
  const result = run(
    [
      member('one', 'member', [memberSource]),
      member('two', 'member', [memberSource]),
      member('unexpected', 'member', [source('unexpected-source', 'member')]),
    ],
    {
      ...snapshot(['member-source', 'missing-source']),
      source: {
        ...snapshot([]).source,
        revision: '0000000000000000000000000000000000000000',
      },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /membership source IDs must be unique/);
  assert.match(result.stderr, /membership source ID set mismatch/);
  assert.match(result.stderr, /landscape provenance must match/);
});

test('requires membership fields for modern landscape-backed output', () => {
  const legacyShape = member('legacy-shape', 'unknown');
  delete legacyShape.membershipStatus;
  delete legacyShape.membershipSources;
  const result = run([legacyShape], snapshot([]));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /landscape-backed output requires membershipStatus and membershipSources/,
  );
});

test('compares membership source metadata with the pinned snapshot', () => {
  const memberSource = source('member-source', 'contributor');
  memberSource.sourceUrl = 'https://wrong.example/source';
  const landscapeRecord = {
    sourceId: 'member-source',
    included: true,
    sourceRole: 'member',
    sourceName: 'Pinned Organization (member)',
    category: 'CNCF Members',
    subcategory: 'Gold',
    homepageUrl: 'https://pinned.example/',
    joined: '2026-02-01',
    localLogo: '/img/end-user-members/pinned.svg',
  };
  const landscape = {
    ...snapshot(['member-source']),
    records: [landscapeRecord],
  };
  const result = run(
    [member('pinned-org', 'member', [memberSource])],
    landscape,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /role does not match/);
  assert.match(result.stderr, /sourceName does not match/);
  assert.match(result.stderr, /homepageUrl does not match/);
  assert.match(result.stderr, /joined does not match/);
  assert.match(result.stderr, /localLogo does not match/);
  assert.match(result.stderr, /sourceUrl does not match landscape provenance/);
});

test('handles a snapshot without a records array', () => {
  const landscape = snapshot([]);
  delete landscape.records;
  const result = run([member('unknown-org', 'unknown')], landscape);
  assert.equal(result.status, 0, result.stderr);
});

// The ID-set mismatch message renders each side independently, so the empty
// side has to read "none" rather than collapsing to an empty gap in the
// sentence. The missing-only direction is exercised above; this covers the
// unexpected-only direction, where a member carries a source the landscape
// snapshot does not include at all.
test('names the empty side of an unexpected-only ID set mismatch', () => {
  const result = run(
    [member('ghost-org', 'member', [source('ghost', 'member')])],
    snapshot([]),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /membership source ID set mismatch \(missing: none; unexpected: ghost\)/,
  );
});

test('names the empty side of a missing-only ID set mismatch', () => {
  const result = run(
    [member('member-org', 'member', [source('member-source', 'member')])],
    snapshot(['member-source', 'absent-source']),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /membership source ID set mismatch \(missing: absent-source; unexpected: none\)/,
  );
});

test('reports a null member entry instead of crashing when a landscape snapshot is present', () => {
  const result = run([null], snapshot([]));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /landscape-backed output requires membershipStatus and membershipSources/,
  );
  assert.doesNotMatch(result.stderr, /TypeError/);
});
