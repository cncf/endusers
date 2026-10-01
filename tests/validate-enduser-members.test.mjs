import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-enduser-members.mjs';
const REVISION = 'bc9d1b5c87904d9430fc3377938f38192bab3ad0';
const SOURCE_URL = `https://github.com/cncf/landscape/blob/${REVISION}/landscape.yml`;
const LOGO = '/img/end-user-members/acme.svg';

const validSnapshot = {
  generated: true,
  collectedAt: '2026-10-01T00:00:00.000Z',
  source: {
    repository: 'https://github.com/cncf/landscape',
    revision: REVISION,
    file: 'landscape.yml',
    sourceUrl: SOURCE_URL,
  },
  selection: {
    member: 'CNCF Members item.enduser === true and name suffix "(member)"',
    contributor:
      'CNCF Members / End User Supporter and Contributor name suffix "(contributor)"',
    supporter: 'audit-only',
  },
  records: [
    {
      sourceId: 'cncf/landscape#CNCF Members/Gold/Acme (member)',
      sourceRole: 'member',
      included: true,
      classificationReason: 'selected-member',
      sourceName: 'Acme (member)',
      displayName: 'Acme',
      category: 'CNCF Members',
      subcategory: 'Gold',
      enduser: true,
      homepageUrl: 'https://example.test/acme',
      joined: '2026-01-01',
      logoFilename: 'acme.svg',
      localLogo: LOGO,
      logoWarning: null,
    },
    {
      sourceId:
        'cncf/landscape#CNCF Members/End User Supporter and Contributor/Legacy (supporter)',
      sourceRole: 'supporter',
      included: false,
      classificationReason: 'legacy-supporter-audit-only',
      sourceName: 'Legacy (supporter)',
      displayName: 'Legacy',
      category: 'CNCF Members',
      subcategory: 'End User Supporter and Contributor',
      enduser: false,
      homepageUrl: 'https://example.test/legacy',
      joined: '2020-01-01',
      logoFilename: 'legacy.svg',
      localLogo: null,
      logoWarning: null,
    },
  ],
};

function fixture(snapshot = validSnapshot, includeLogo = true) {
  return {
    'data/enduser-landscape.json': JSON.stringify(snapshot),
    ...(includeLogo
      ? { [`static${LOGO}`]: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }
      : {}),
  };
}

test('accepts a complete snapshot with selected and audit-only records', () => {
  const result = runScriptWithFixtures(SCRIPT, fixture());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 2 landscape records/);
});

test('rejects a selected record without complete provenance', () => {
  const snapshot = structuredClone(validSnapshot);
  delete snapshot.records[0].localLogo;
  const result = runScriptWithFixtures(SCRIPT, fixture(snapshot));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /logoWarning: is required/);
});

test('rejects a supporter promoted to the current directory', () => {
  const snapshot = structuredClone(validSnapshot);
  snapshot.records[1].included = true;
  const result = runScriptWithFixtures(SCRIPT, fixture(snapshot));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /supporter records must be audit-only/);
});

test('rejects duplicate source IDs', () => {
  const snapshot = structuredClone(validSnapshot);
  snapshot.records.push({ ...snapshot.records[0] });
  const result = runScriptWithFixtures(SCRIPT, fixture(snapshot));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate sourceId/);
});

test('allows an explicit warning when an optional logo cannot be mirrored', () => {
  const snapshot = structuredClone(validSnapshot);
  snapshot.records[0].localLogo = null;
  snapshot.records[0].logoWarning =
    'Could not mirror landscape logo; using the initials fallback.';
  const result = runScriptWithFixtures(SCRIPT, fixture(snapshot, false));
  assert.equal(result.status, 0, result.stderr);
});

test('reports malformed source, role, URL, date, and asset fields together', () => {
  const snapshot = structuredClone(validSnapshot);
  snapshot.generated = false;
  snapshot.collectedAt = 'not a date';
  snapshot.source = {
    repository: 'https://evil.example/',
    revision: REVISION,
    file: 'other.yml',
    sourceUrl: 'https://github.com/cncf/landscape/blob/wrong/landscape.yml',
  };
  snapshot.selection = {};
  snapshot.records = [
    {
      ...validSnapshot.records[0],
      sourceId: '',
      sourceRole: 'bogus',
      included: true,
      classificationReason: 'wrong',
      sourceName: 'Bad',
      displayName: 'Different',
      category: 'Wrong',
      subcategory: 'Wrong',
      enduser: false,
      homepageUrl: 'ftp://example.test/',
      joined: 'not a date',
      logoFilename: '../bad.exe',
      localLogo: 'relative.png',
    },
    {
      ...validSnapshot.records[0],
      sourceId: 'cncf/landscape#CNCF Members/Gold/No Flag (member)',
      sourceName: 'No Flag (member)',
      displayName: 'No Flag',
      enduser: false,
      included: false,
      localLogo: '/img/end-user-members/missing.svg',
    },
    {
      ...validSnapshot.records[0],
      sourceId:
        'cncf/landscape#CNCF Members/Gold/Bad Contributor (contributor)',
      sourceName: 'Bad Contributor (contributor)',
      displayName: 'Bad Contributor',
      sourceRole: 'contributor',
      subcategory: 'Gold',
      included: false,
      classificationReason: 'wrong',
      enduser: false,
    },
    {
      ...validSnapshot.records[0],
      sourceId:
        'cncf/landscape#CNCF Members/End User Supporter and Contributor/Bad Reason (contributor)',
      sourceName: 'Bad Reason (contributor)',
      displayName: 'Bad Reason',
      sourceRole: 'contributor',
      subcategory: 'End User Supporter and Contributor',
      included: true,
      classificationReason: 'wrong',
      enduser: false,
      logoFilename: null,
      localLogo: null,
    },
    {
      ...validSnapshot.records[1],
      sourceId:
        'cncf/landscape#CNCF Members/End User Supporter and Contributor/Bad Supporter (supporter)',
      sourceName: 'Bad Supporter (supporter)',
      displayName: 'Bad Supporter',
      included: true,
      classificationReason: 'wrong',
    },
    {
      ...validSnapshot.records[0],
      sourceId: 'cncf/landscape#CNCF Members/Gold/Nonstring Logo (member)',
      sourceName: 'Nonstring Logo (member)',
      displayName: 'Nonstring Logo',
      localLogo: 12,
      enduser: true,
    },
    {
      ...validSnapshot.records[0],
      sourceId: 'cncf/landscape#CNCF Members/Gold/Null Homepage (member)',
      sourceName: 'Null Homepage (member)',
      displayName: 'Null Homepage',
      homepageUrl: null,
      joined: null,
      logoFilename: null,
      localLogo: null,
      enduser: true,
    },
    {
      ...validSnapshot.records[0],
      sourceId: 'cncf/landscape#CNCF Members/Gold/Empty Homepage (member)',
      sourceName: 'Empty Homepage (member)',
      displayName: 'Empty Homepage',
      homepageUrl: '',
      logoFilename: null,
      localLogo: null,
      enduser: true,
    },
    {
      ...validSnapshot.records[0],
      sourceId: 'cncf/landscape#CNCF Members/Gold/Bad URL (member)',
      sourceName: 'Bad URL (member)',
      displayName: 'Bad URL',
      homepageUrl: 'https://',
      logoFilename: null,
      localLogo: null,
      enduser: true,
    },
    {
      ...validSnapshot.records[0],
      sourceId: 'cncf/landscape#CNCF Members/Gold/Userinfo URL (member)',
      sourceName: 'Userinfo URL (member)',
      displayName: 'Userinfo URL',
      homepageUrl: 'https://cncf.io@evil.example/',
      logoFilename: null,
      localLogo: null,
      enduser: true,
    },
    {
      ...validSnapshot.records[0],
      sourceId: 'cncf/landscape#CNCF Members/Gold/Traversal Logo (member)',
      sourceName: 'Traversal Logo (member)',
      displayName: 'Traversal Logo',
      localLogo: '/../bad.svg',
      enduser: true,
    },
    {
      ...validSnapshot.records[0],
      sourceId: 'cncf/landscape#CNCF Members/Gold/Extension Logo (member)',
      sourceName: 'Extension Logo (member)',
      displayName: 'Extension Logo',
      localLogo: '/img/end-user-members/bad.exe',
      enduser: true,
    },
  ];
  const result = runScriptWithFixtures(SCRIPT, fixture(snapshot));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /generated.*must be true/);
  assert.match(result.stderr, /source\.repository.*cncf\/landscape/);
  assert.match(result.stderr, /source\.file.*landscape\.yml/);
  assert.match(result.stderr, /source\.sourceUrl.*pinned landscape revision/);
  assert.match(result.stderr, /selection\.member.*non-empty/);
  assert.match(result.stderr, /unsupported role/);
  assert.match(result.stderr, /must use http: or https:/);
  assert.match(result.stderr, /must be null or a parseable date/);
  assert.match(result.stderr, /must be a safe supported image filename/);
  assert.match(result.stderr, /must be an absolute site-local path/);
  assert.match(result.stderr, /asset does not exist/);
  assert.match(result.stderr, /supporter records must be audit-only/);
});

test('rejects a missing source object and empty record selection', () => {
  const snapshot = {
    generated: true,
    collectedAt: '2026-10-01T00:00:00.000Z',
    source: null,
    selection: {},
    records: [],
  };
  const result = runScriptWithFixtures(SCRIPT, fixture(snapshot, false));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /source: must be an object/);
  assert.match(result.stderr, /records: must be a non-empty array/);
  assert.match(
    result.stderr,
    /records: must include at least one selected record/,
  );
});

test('rejects an invalid source revision before checking its pin', () => {
  const snapshot = structuredClone(validSnapshot);
  snapshot.source.revision = 'bad';
  snapshot.source.sourceUrl = 'http://example.test/landscape.yml';
  const result = runScriptWithFixtures(SCRIPT, fixture(snapshot));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /source\.revision: must be a full lowercase commit SHA/,
  );
  assert.match(result.stderr, /source\.sourceUrl: must use https/);
});

test('rejects non-array records and non-string source names', () => {
  const noRecords = structuredClone(validSnapshot);
  noRecords.records = 'records';
  const noRecordsResult = runScriptWithFixtures(SCRIPT, fixture(noRecords));
  assert.equal(noRecordsResult.status, 1);
  assert.match(noRecordsResult.stderr, /records: must be a non-empty array/);

  const badName = structuredClone(validSnapshot);
  badName.records[0].sourceName = null;
  const badNameResult = runScriptWithFixtures(SCRIPT, fixture(badName));
  assert.equal(badNameResult.status, 1);
  assert.match(
    badNameResult.stderr,
    /records\[0\]\.sourceName: must be a non-empty string/,
  );
});

test('rejects malformed owned-asset manifests', () => {
  const invalidJson = runScriptWithFixtures(SCRIPT, {
    ...fixture(),
    'data/enduser-landscape-assets.json': '{',
  });
  assert.equal(invalidJson.status, 1);
  assert.match(invalidJson.stderr, /must contain valid JSON/);

  const invalidShape = runScriptWithFixtures(SCRIPT, {
    ...fixture(),
    'data/enduser-landscape-assets.json': JSON.stringify({
      generated: false,
      assets: 'not-an-array',
    }),
  });
  assert.equal(invalidShape.status, 1);
  assert.match(
    invalidShape.stderr,
    /must be generated and carry an assets array/,
  );

  const unsafePath = runScriptWithFixtures(SCRIPT, {
    ...fixture(),
    'data/enduser-landscape-assets.json': JSON.stringify({
      generated: true,
      assets: ['/img/not-owned.svg'],
    }),
  });
  assert.equal(unsafePath.status, 1);
  assert.match(unsafePath.stderr, /owned asset must be under/);
});
