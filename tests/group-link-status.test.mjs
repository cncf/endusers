// GroupLinkStatus renders the freshness + drift note above the End User Group
// cards on docs/community/index.md. Nothing imported the module before this
// file, so none of its branches had unit coverage: the checkedAt line, the
// drift warning that names archived or unreachable upstream repositories, and
// the singular/plural wording that warning switches on.
//
// The live data file currently reports every group as healthy, so the drift
// branch is unreachable from the real module; it is driven through a fixture
// copy instead. The live-data assertions are invariants that hold for any
// shape of data/community-groups.json rather than snapshots of today's groups.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importWithData } from './helpers-component-data.mjs';
import { importSource } from './helpers-jsx.mjs';
import { textOf } from './tools/react-element-tree.mjs';

const DATA_SPECIFIER = '@site/data/community-groups.json';

const { default: GroupLinkStatus } = await importSource(
  'src/components/GroupLinkStatus/index.js',
);
const { default: groupsData } = await importSource(
  'data/community-groups.json',
);

const group = (overrides = {}) => ({
  slug: 'research',
  name: 'Research User Group',
  repository: 'https://github.com/cncf/research-user-group',
  archived: false,
  reachable: true,
  ...overrides,
});

async function renderWith(data) {
  const module = await importWithData(
    'src/components/GroupLinkStatus/index.js',
    { [DATA_SPECIFIER]: data },
  );
  try {
    return module.default();
  } finally {
    module.cleanup();
  }
}

test('the live data file renders the checkedAt verification line', () => {
  const expected = new Date(groupsData.checkedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const text = textOf(GroupLinkStatus());
  assert.match(text, /Upstream group links last verified on/);
  assert.ok(
    text.includes(expected),
    `expected the rendered text to include ${expected}`,
  );
});

test('healthy live data raises no drift warning', () => {
  const drifted = groupsData.groups.filter(
    (entry) => entry.archived || entry.reachable === false,
  );
  const text = textOf(GroupLinkStatus());
  if (drifted.length === 0) {
    assert.doesNotMatch(text, /archived or unreachable/);
  } else {
    assert.match(text, /archived or unreachable/);
  }
});

test('an unparseable checkedAt drops the verification line rather than rendering "Invalid Date"', async () => {
  const text = textOf(
    await renderWith({ checkedAt: 'not a timestamp', groups: [group()] }),
  );
  assert.doesNotMatch(text, /last verified/);
  assert.doesNotMatch(text, /Invalid Date/);
});

test('missing groups data renders without throwing', async () => {
  const tree = await renderWith({ checkedAt: '2026-03-04T05:06:07.000Z' });
  assert.match(textOf(tree), /March 4, 2026/);
  assert.doesNotMatch(textOf(tree), /archived or unreachable/);
});

test('an archived upstream repository is named in the warning', async () => {
  const text = textOf(
    await renderWith({
      checkedAt: '2026-03-04T05:06:07.000Z',
      groups: [
        group(),
        group({ slug: 'telecom', name: 'Telecom User Group', archived: true }),
      ],
    }),
  );
  assert.match(text, /Telecom User Group has an archived or unreachable/);
  assert.doesNotMatch(text, /Research User Group/);
  assert.match(text, /upstream repository/);
});

test('an unreachable upstream repository is named in the warning', async () => {
  const text = textOf(
    await renderWith({
      checkedAt: '2026-03-04T05:06:07.000Z',
      groups: [group({ reachable: false })],
    }),
  );
  assert.match(text, /Research User Group has an archived or unreachable/);
});

test('two drifted groups are listed together with plural wording', async () => {
  const text = textOf(
    await renderWith({
      checkedAt: '2026-03-04T05:06:07.000Z',
      groups: [
        group({ archived: true }),
        group({
          slug: 'telecom',
          name: 'Telecom User Group',
          reachable: false,
        }),
      ],
    }),
  );
  assert.match(
    text,
    /Research User Group, Telecom User Group have archived or unreachable upstream repositories/,
  );
});
