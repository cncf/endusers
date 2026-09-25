// Render contract for the SyncStatus banner of src/components/CaseStudies/index.js.
//
// SyncStatus is the line that tells a visitor when data/case-studies.json was
// last mirrored from cncf.io and links back to the upstream index. It is a
// module-private component rendered as `<SyncStatus />`, so nothing calls it
// unless a test walks the element tree CaseStudies returns and invokes the
// element's own type — which is why tests/case-studies.test.mjs, which asserts
// on the rendered table, leaves it entirely unexecuted.
//
// Both of its arms matter and neither had coverage: a broken attribution link
// or an "Invalid Date" would ship silently, and the `generatedAt`-absent arm is
// unreachable from the checked-in file, which always carries a timestamp. That
// arm is driven through a fixture copy of the module.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importWithData } from './helpers-component-data.mjs';
import { importSource } from './helpers-jsx.mjs';
import { renderHook } from './tools/react-hook-driver.mjs';
import { textOf, walkElements } from './tools/react-element-tree.mjs';

const DATA_SPECIFIER = '@site/data/case-studies.json';

const { default: CaseStudies } = await importSource(
  'src/components/CaseStudies/index.js',
);
const { default: caseStudyData } = await importSource('data/case-studies.json');

/**
 * Renders CaseStudies and returns what its private SyncStatus child renders.
 *
 * @param {Function} Component the CaseStudies component to render
 * @returns {any} the SyncStatus element tree, or null when it renders nothing
 */
function renderSyncStatus(Component) {
  const { result } = renderHook(() => Component());
  const element = [...walkElements(result)].find(
    (candidate) => candidate.type?.name === 'SyncStatus',
  );
  assert.ok(element, 'CaseStudies no longer renders a SyncStatus child');
  return element.type();
}

async function renderWith(data) {
  const module = await importWithData('src/components/CaseStudies/index.js', {
    [DATA_SPECIFIER]: data,
  });
  try {
    return renderSyncStatus(module.default);
  } finally {
    module.cleanup();
  }
}

test('the live data file renders a single sync-status paragraph', () => {
  const tree = renderSyncStatus(CaseStudies);
  assert.notEqual(
    tree,
    null,
    'data/case-studies.json has no generatedAt timestamp',
  );
  assert.equal(tree.type, 'p');
});

test('the banner attributes the mirror to the live sourceUrl', () => {
  const link = [...walkElements(renderSyncStatus(CaseStudies))].find(
    (element) => element.type === 'a',
  );
  assert.ok(link, 'the sync-status banner renders no attribution link');
  assert.equal(link.props.href, caseStudyData.sourceUrl);
  assert.equal(link.props.target, '_blank');
  assert.equal(
    link.props.rel,
    'noreferrer',
    'a target=_blank link must not leak the referrer',
  );
});

test('the rendered date is the generatedAt of the live data file', () => {
  const expected = new Date(caseStudyData.generatedAt).toLocaleDateString(
    'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );
  const text = textOf(renderSyncStatus(CaseStudies));
  assert.match(text, /^Mirrored from /);
  assert.ok(
    text.includes(expected),
    `expected the rendered text to include ${expected}`,
  );
});

test('a known generatedAt is rendered as a long-form US date', async () => {
  const tree = await renderWith({
    caseStudies: [],
    sourceUrl: 'https://example.test/case-studies/',
    generatedAt: '2026-03-04T05:06:07.000Z',
  });
  assert.match(textOf(tree), /March 4, 2026/);
});

test('a missing generatedAt renders no banner rather than "Invalid Date"', async () => {
  assert.equal(await renderWith({ caseStudies: [] }), null);
});
