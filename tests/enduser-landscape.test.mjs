import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyLandscapeDocument,
  END_USER_SUPPORTER_SUBCATEGORY,
} from '../scripts/lib/enduser-landscape.mjs';

function landscapeDocument(subcategories) {
  return {
    landscape: [
      {
        name: 'CNCF Members',
        subcategories,
      },
    ],
  };
}

function subcategory(name, items) {
  return { name, items };
}

function item(name, overrides = {}) {
  return {
    name,
    homepage_url: 'https://example.test/',
    logo: 'example.svg',
    joined: '2026-01-01',
    ...overrides,
  };
}

test('classifies current members and contributors and audits supporters', () => {
  const result = classifyLandscapeDocument(
    landscapeDocument([
      subcategory('Gold', [
        item('Acme (member)', { enduser: true }),
        item('Vendor (member)'),
      ]),
      subcategory(END_USER_SUPPORTER_SUBCATEGORY, [
        item('Contributor Co (contributor)'),
        item('Legacy Co (supporter)'),
        item('Anomalous Co (supporter)', { enduser: true }),
      ]),
    ]),
  );

  assert.deepEqual(
    result.records.map((record) => ({
      sourceId: record.sourceId,
      sourceRole: record.sourceRole,
      included: record.included,
      classificationReason: record.classificationReason,
      displayName: record.displayName,
    })),
    [
      {
        sourceId: 'cncf/landscape#CNCF Members/Gold/Acme (member)',
        sourceRole: 'member',
        included: true,
        classificationReason: 'selected-member',
        displayName: 'Acme',
      },
      {
        sourceId:
          'cncf/landscape#CNCF Members/End User Supporter and Contributor/Contributor Co (contributor)',
        sourceRole: 'contributor',
        included: true,
        classificationReason: 'selected-contributor',
        displayName: 'Contributor Co',
      },
      {
        sourceId:
          'cncf/landscape#CNCF Members/End User Supporter and Contributor/Legacy Co (supporter)',
        sourceRole: 'supporter',
        included: false,
        classificationReason: 'legacy-supporter-audit-only',
        displayName: 'Legacy Co',
      },
      {
        sourceId:
          'cncf/landscape#CNCF Members/End User Supporter and Contributor/Anomalous Co (supporter)',
        sourceRole: 'supporter',
        included: false,
        classificationReason: 'legacy-supporter-audit-only',
        displayName: 'Anomalous Co',
      },
    ],
  );
});

test('requires the enduser flag for member records', () => {
  assert.deepEqual(
    classifyLandscapeDocument(
      landscapeDocument([
        subcategory('Gold', [item('Vendor (member)')]),
        subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
      ]),
    ).records,
    [],
  );
});

test('rejects an unrecognized role suffix in the contributor subcategory', () => {
  assert.throws(
    () =>
      classifyLandscapeDocument(
        landscapeDocument([
          subcategory('Gold', []),
          subcategory(END_USER_SUPPORTER_SUBCATEGORY, [
            item('Unclassified Organization'),
          ]),
        ]),
      ),
    /unrecognized End User Supporter and Contributor role suffix/,
  );
});

test('rejects a contributor record outside the authoritative subcategory', () => {
  assert.throws(
    () =>
      classifyLandscapeDocument(
        landscapeDocument([
          subcategory('Gold', [item('Contributor Co (contributor)')]),
          subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
        ]),
      ),
    /contributor record outside/,
  );
});

test('rejects duplicate source identities', () => {
  assert.throws(
    () =>
      classifyLandscapeDocument(
        landscapeDocument([
          subcategory('Gold', [
            item('Acme (member)', { enduser: true }),
            item('Acme (member)', { enduser: true }),
          ]),
          subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
        ]),
      ),
    /duplicate landscape sourceId/,
  );
});

test('rejects a missing landscape category or required subcategory', () => {
  assert.throws(
    () => classifyLandscapeDocument(undefined),
    /missing landscape category/,
  );
  assert.throws(
    () => classifyLandscapeDocument({ landscape: [] }),
    /missing landscape category/,
  );
  assert.throws(
    () =>
      classifyLandscapeDocument({
        landscape: [{ name: 'Other' }],
      }),
    /missing landscape category/,
  );
  assert.throws(
    () =>
      classifyLandscapeDocument(landscapeDocument([subcategory('Gold', [])])),
    /missing landscape subcategory/,
  );
  assert.throws(
    () =>
      classifyLandscapeDocument({
        landscape: [{ name: 'CNCF Members' }],
      }),
    /missing landscape subcategory/,
  );
});

test('rejects unnamed items and unsupported role suffixes', () => {
  assert.throws(
    () =>
      classifyLandscapeDocument(
        landscapeDocument([
          { items: [{ enduser: true }] },
          subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
        ]),
      ),
    /has no name/,
  );
  assert.throws(
    () =>
      classifyLandscapeDocument(
        landscapeDocument([
          subcategory('Gold', [item('')]),
          subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
        ]),
      ),
    /has no name/,
  );
  assert.throws(
    () =>
      classifyLandscapeDocument(
        landscapeDocument([
          subcategory('Gold', []),
          subcategory(END_USER_SUPPORTER_SUBCATEGORY, [
            item('Member Named Record (member)'),
          ]),
        ]),
      ),
    /unsupported End User Supporter and Contributor role/,
  );
});

test('rejects an enduser flag without a member suffix outside the target subcategory', () => {
  assert.throws(
    () =>
      classifyLandscapeDocument(
        landscapeDocument([
          subcategory('Gold', [item('Unlabeled End User', { enduser: true })]),
          subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
        ]),
      ),
    /enduser record without a member role suffix/,
  );
});

test('handles sparse items and empty subcategory collections', () => {
  const result = classifyLandscapeDocument({
    landscape: [
      {
        name: 'CNCF Members',
        subcategories: [
          { name: 'Academic' },
          {
            name: 'Gold',
            items: [{ name: 'Sparse (member)', enduser: true }],
          },
          { name: END_USER_SUPPORTER_SUBCATEGORY },
        ],
      },
    ],
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].homepageUrl, null);
  assert.equal(result.records[0].logoFilename, null);
  assert.equal(result.records[0].joined, null);
});

// ROLE_SUFFIX is anchored to the end of the name on purpose: the landscape
// carries the role as a trailing parenthetical, and an organization whose
// legal name happens to contain "(member)" mid-string is not a member record.
// Without the anchor the suffix is stripped from the middle and the record is
// classified off a substring match.
test('only a trailing role parenthetical is treated as the role suffix', () => {
  assert.throws(
    () =>
      classifyLandscapeDocument(
        landscapeDocument([
          subcategory('Gold', [
            item('Acme (member) Holdings', { enduser: true }),
          ]),
          subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
        ]),
      ),
    /enduser record without a member role suffix/,
  );

  const result = classifyLandscapeDocument(
    landscapeDocument([
      subcategory('Gold', [
        item('Acme (member) Holdings (member)', { enduser: true }),
      ]),
      subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
    ]),
  );
  assert.equal(result.records[0].displayName, 'Acme (member) Holdings');
});

// The unnamed-item error names the subcategory it came from so a landscape
// maintainer can find the entry. A subcategory with no name of its own falls
// back to '<unknown>' rather than interpolating `undefined`.
test('the unnamed-item error names the subcategory, or <unknown>', () => {
  assert.throws(
    () =>
      classifyLandscapeDocument(
        landscapeDocument([
          subcategory('Gold', [{ enduser: true }]),
          subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
        ]),
      ),
    /landscape item in CNCF Members\/Gold has no name/,
  );
  assert.throws(
    () =>
      classifyLandscapeDocument(
        landscapeDocument([
          { items: [{ enduser: true }] },
          subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
        ]),
      ),
    /landscape item in CNCF Members\/<unknown> has no name/,
  );
});

// A name of nothing but whitespace is the shape a hand-edited YAML entry
// carries, and it is as unusable as an absent name: it would produce a blank
// directory card and a sourceId no one can match back to the landscape.
test('rejects a whitespace-only item name', () => {
  assert.throws(
    () =>
      classifyLandscapeDocument(
        landscapeDocument([
          subcategory('Gold', [item('   ')]),
          subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
        ]),
      ),
    /has no name/,
  );
});

// landscape.yml is community-edited YAML, so a stray list entry parses as
// null. Each level is read through optional chaining so a null is skipped (or
// reported as a data error) instead of crashing the collector with a
// TypeError that names no entry.
test('skips null landscape categories, subcategories and reports null items', () => {
  const result = classifyLandscapeDocument({
    landscape: [
      null,
      {
        name: 'CNCF Members',
        subcategories: [
          null,
          subcategory('Gold', [item('Acme (member)', { enduser: true })]),
          subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
        ],
      },
    ],
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].displayName, 'Acme');

  assert.throws(
    () =>
      classifyLandscapeDocument(
        landscapeDocument([
          subcategory('Gold', [null]),
          subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
        ]),
      ),
    /has no name/,
  );
});

// The supporter role is audited only where it is authoritative. A '(supporter)'
// suffix in an ordinary membership tier is not an End User Supporter record,
// so it is neither included nor carried through as an audit-only row.
test('ignores a supporter suffix outside the authoritative subcategory', () => {
  const result = classifyLandscapeDocument(
    landscapeDocument([
      subcategory('Gold', [item('Legacy Co (supporter)')]),
      subcategory(END_USER_SUPPORTER_SUBCATEGORY, []),
    ]),
  );
  assert.deepEqual(result.records, []);
});

// `enduser` is mirrored onto every emitted record, and it is the landscape's
// own flag rather than a restatement of `included`: a contributor record is
// included without the flag, so the two must be asserted apart.
test('mirrors the landscape enduser flag onto each record', () => {
  const result = classifyLandscapeDocument(
    landscapeDocument([
      subcategory('Gold', [item('Acme (member)', { enduser: true })]),
      subcategory(END_USER_SUPPORTER_SUBCATEGORY, [
        item('Contributor Co (contributor)'),
      ]),
    ]),
  );
  assert.deepEqual(
    result.records.map((record) => [record.displayName, record.enduser]),
    [
      ['Acme', true],
      ['Contributor Co', false],
    ],
  );
});
