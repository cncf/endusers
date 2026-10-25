import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diffLandscapeSelection,
  formatDrift,
  hasDrift,
  RENDERED_FIELDS,
} from '../scripts/lib/landscape-drift.mjs';

// Records of the shape classifyLandscapeDocument produces, reduced to the
// fields the diff reads. `included` is the field the classifier uses to mark a
// record as one the member directory renders; an audit-only record carries the
// same shape with `included: false`.
function record(overrides = {}) {
  return {
    sourceId: 'cncf/landscape#CNCF Members/Platinum/Adyen (member)',
    sourceRole: 'member',
    included: true,
    displayName: 'Adyen',
    homepageUrl: 'https://www.adyen.com',
    ...overrides,
  };
}

function withSourceId(name, overrides = {}) {
  return record({
    sourceId: `cncf/landscape#CNCF Members/Platinum/${name} (member)`,
    displayName: name,
    ...overrides,
  });
}

test('reports no drift when both classifications select the same records', () => {
  const pinned = [withSourceId('Adyen'), withSourceId('Spotify')];
  const diff = diffLandscapeSelection(pinned, [
    withSourceId('Spotify'),
    withSourceId('Adyen'),
  ]);

  assert.deepEqual(diff, { added: [], removed: [], changed: [] });
  assert.equal(hasDrift(diff), false);
  assert.deepEqual(formatDrift(diff), []);
});

// The failure the check exists for: upstream selects an organisation the
// committed snapshot predates, so the directory renders one member short until
// someone refreshes it.
test('reports an organisation upstream selects that the snapshot omits', () => {
  const diff = diffLandscapeSelection(
    [withSourceId('Adyen')],
    [
      withSourceId('Adyen'),
      withSourceId('DIRECTV', { sourceRole: 'contributor' }),
    ],
  );

  assert.deepEqual(
    diff.added.map((entry) => entry.displayName),
    ['DIRECTV'],
  );
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.changed, []);
  assert.equal(hasDrift(diff), true);
  assert.deepEqual(formatDrift(diff), [
    'missing from the directory: DIRECTV (contributor) — ' +
      'cncf/landscape#CNCF Members/Platinum/DIRECTV (member)',
  ]);
});

test('reports an organisation the snapshot still shows that upstream dropped', () => {
  const diff = diffLandscapeSelection(
    [withSourceId('Adyen'), withSourceId('Formerly')],
    [withSourceId('Adyen')],
  );

  assert.deepEqual(diff.added, []);
  assert.deepEqual(
    diff.removed.map((entry) => entry.displayName),
    ['Formerly'],
  );
  assert.deepEqual(formatDrift(diff), [
    'no longer selected upstream: Formerly (member) — ' +
      'cncf/landscape#CNCF Members/Platinum/Formerly (member)',
  ]);
});

// A record that stays selected can still stop describing the organisation the
// directory renders: a rename, a moved homepage, or a role change that moves
// it between the member and contributor lists.
test('reports every rendered field that changed for a record that stayed', () => {
  const before = withSourceId('Adyen');
  const after = {
    ...before,
    displayName: 'Adyen N.V.',
    homepageUrl: 'https://www.adyen.com/en_GB/',
    sourceRole: 'contributor',
  };
  const diff = diffLandscapeSelection([before], [after]);

  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.equal(diff.changed.length, 1);
  assert.deepEqual(diff.changed[0].fields, RENDERED_FIELDS);
  assert.deepEqual(formatDrift(diff), [
    'changed upstream: Adyen N.V. — displayName: Adyen -> Adyen N.V., ' +
      'homepageUrl: https://www.adyen.com -> https://www.adyen.com/en_GB/, ' +
      'sourceRole: member -> contributor',
  ]);
});

test('reports only the rendered fields that differ', () => {
  const before = withSourceId('Adyen');
  const diff = diffLandscapeSelection(
    [before],
    [{ ...before, homepageUrl: 'https://adyen.com' }],
  );

  assert.deepEqual(diff.changed[0].fields, ['homepageUrl']);
});

// Fields outside RENDERED_FIELDS move for reasons a visitor never sees -- the
// upstream logo filename, the mirrored asset path, the joined date -- and a
// check that reported them would ask for a refresh on every upstream commit.
test('ignores a field change no page renders', () => {
  const before = withSourceId('Adyen');
  const diff = diffLandscapeSelection(
    [before],
    [{ ...before, logoFilename: 'adyen-2026.svg', joined: '2026-06-01' }],
  );

  assert.deepEqual(diff, { added: [], removed: [], changed: [] });
  assert.equal(hasDrift(diff), false);
});

// `included: false` records are the audit-only half of the snapshot: the
// classifier keeps them so the selection can be reviewed, and
// generate-members.mjs never renders them. Drift among them is not a stale
// directory.
test('ignores records neither classification includes', () => {
  const excluded = withSourceId('Adidas', {
    included: false,
    sourceRole: 'supporter',
  });
  const diff = diffLandscapeSelection(
    [withSourceId('Adyen'), excluded],
    [withSourceId('Adyen')],
  );

  assert.deepEqual(diff, { added: [], removed: [], changed: [] });
});

test('treats a record that became audit-only as removed from the directory', () => {
  const selected = withSourceId('Adidas');
  const diff = diffLandscapeSelection(
    [selected],
    [{ ...selected, included: false }],
  );

  assert.deepEqual(
    diff.removed.map((entry) => entry.displayName),
    ['Adidas'],
  );
});

test('treats a record that became selected as added to the directory', () => {
  const excluded = withSourceId('Adidas', { included: false });
  const diff = diffLandscapeSelection(
    [excluded],
    [{ ...excluded, included: true }],
  );

  assert.deepEqual(
    diff.added.map((entry) => entry.displayName),
    ['Adidas'],
  );
});

// `included` is read as an identity, not for truthiness: a snapshot written
// before the field existed, or one carrying a stringified flag, is not a
// selection this check can speak for.
test('only an exact included flag marks a record as rendered', () => {
  for (const included of [undefined, null, 'true', 1]) {
    const diff = diffLandscapeSelection(
      [],
      [withSourceId('Adyen', { included })],
    );
    assert.deepEqual(diff.added, [], `included: ${String(included)}`);
  }
});

// Every list is sorted so two runs over the same drift print the same report,
// and so a reviewer comparing two runs sees only what changed.
test('sorts each list by source id', () => {
  const diff = diffLandscapeSelection(
    [withSourceId('Zebra'), withSourceId('Alpha'), withSourceId('Mid')],
    [withSourceId('Yak'), withSourceId('Beta'), withSourceId('Mid')],
  );

  assert.deepEqual(
    diff.added.map((entry) => entry.displayName),
    ['Beta', 'Yak'],
  );
  assert.deepEqual(
    diff.removed.map((entry) => entry.displayName),
    ['Alpha', 'Zebra'],
  );
});

test('sorts a list that upstream already returned in order', () => {
  // The comparator's other arm: when the records arrive sorted, every
  // comparison answers "after" rather than "before".
  const diff = diffLandscapeSelection(
    [],
    [withSourceId('Alpha'), withSourceId('Zebra')],
  );

  assert.deepEqual(
    diff.added.map((entry) => entry.displayName),
    ['Alpha', 'Zebra'],
  );
});

test('sorts changed records by source id', () => {
  const zebra = withSourceId('Zebra');
  const alpha = withSourceId('Alpha');
  const diff = diffLandscapeSelection(
    [zebra, alpha],
    [
      { ...zebra, homepageUrl: 'https://zebra.example' },
      { ...alpha, homepageUrl: 'https://alpha.example' },
    ],
  );

  assert.deepEqual(
    diff.changed.map((entry) => entry.record.displayName),
    ['Alpha', 'Zebra'],
  );
});

// A snapshot whose `records` key is missing or not an array reaches the diff
// the same way an empty one does; the caller's JSON.parse cannot tell them
// apart, and reporting every upstream record as "missing" would be a refresh
// instruction nobody can act on.
test('treats a classification with no records as selecting nothing', () => {
  for (const records of [undefined, null, []]) {
    const diff = diffLandscapeSelection(records, [withSourceId('Adyen')]);
    assert.deepEqual(
      diff.added.map((entry) => entry.displayName),
      ['Adyen'],
      `pinned records: ${String(records)}`,
    );
    const mirrored = diffLandscapeSelection([withSourceId('Adyen')], records);
    assert.deepEqual(
      mirrored.removed.map((entry) => entry.displayName),
      ['Adyen'],
      `fresh records: ${String(records)}`,
    );
  }
});

test('skips a nullish entry inside a record list', () => {
  const diff = diffLandscapeSelection(
    [null],
    [undefined, withSourceId('Adyen')],
  );

  assert.deepEqual(
    diff.added.map((entry) => entry.displayName),
    ['Adyen'],
  );
  assert.deepEqual(diff.removed, []);
});

// The last record wins when a list repeats a source id, which is what Map
// insertion does; the guard is that a duplicate never reports as both present
// and absent.
test('collapses a repeated source id to a single record', () => {
  const first = withSourceId('Adyen');
  const diff = diffLandscapeSelection(
    [first],
    [first, { ...first, homepageUrl: 'https://adyen.example' }],
  );

  assert.equal(diff.added.length, 0);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].record.homepageUrl, 'https://adyen.example');
});

test('hasDrift answers for each list independently', () => {
  const entry = withSourceId('Adyen');
  assert.equal(hasDrift({ added: [entry], removed: [], changed: [] }), true);
  assert.equal(hasDrift({ added: [], removed: [entry], changed: [] }), true);
  assert.equal(
    hasDrift({
      added: [],
      removed: [],
      changed: [
        {
          sourceId: entry.sourceId,
          record: entry,
          before: entry,
          fields: ['displayName'],
        },
      ],
    }),
    true,
  );
  assert.equal(hasDrift({ added: [], removed: [], changed: [] }), false);
});

// The report is ordered so the two lines that require a refresh come before
// the ones that only restate it.
test('formats additions before removals before changes', () => {
  const added = withSourceId('Added');
  const removed = withSourceId('Removed');
  const changed = withSourceId('Changed');
  const lines = formatDrift({
    added: [added],
    removed: [removed],
    changed: [
      {
        sourceId: changed.sourceId,
        record: { ...changed, displayName: 'Changed Ltd' },
        before: changed,
        fields: ['displayName'],
      },
    ],
  });

  assert.deepEqual(
    lines.map((line) => line.split(':')[0]),
    [
      'missing from the directory',
      'no longer selected upstream',
      'changed upstream',
    ],
  );
});

test('the rendered field list names the fields a visitor sees', () => {
  assert.deepEqual(RENDERED_FIELDS, [
    'displayName',
    'homepageUrl',
    'sourceRole',
  ]);
});
