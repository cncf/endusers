// Fallback-branch coverage for src/components/RadarReports/index.js (#506).
//
// The component reads @site/data/radar-reports.json at module scope, and the
// live corpus always has generatedAt, a populated radarReports array, and a
// publishedAt on every report — so the missing-or-empty-corpus arms are
// unreachable from tests/radar-reports.test.mjs, which asserts against the
// checked-in file. These tests inject fixture corpora through
// tests/helpers-component-data.mjs instead; the live-corpus assertions stay
// where they are.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importWithData } from './helpers-component-data.mjs';
import {
  findAllByType,
  findByType,
  textOf,
  walkElements,
} from './tools/react-element-tree.mjs';

const SOURCE = 'src/components/RadarReports/index.js';
const DATA_SPECIFIER = '@site/data/radar-reports.json';

const REPORT = {
  id: 'radar-2024-01',
  title: 'Technology Radar: Example',
  url: 'https://www.cncf.io/reports/example/',
  summary: 'An example report.',
  publishedAt: '2024-01-15T00:00:00.000Z',
};

/** Renders the nested <SyncStatus /> element, or null when it returns null. */
function renderSyncStatus(tree) {
  const element = [...walkElements(tree)].find(
    (node) =>
      typeof node.type === 'function' && node.type.name === 'SyncStatus',
  );
  assert.ok(element, 'expected the component to render a <SyncStatus />');
  return element.type(element.props);
}

test('no generatedAt renders no provenance line while the list still renders', async () => {
  const { default: RadarReports, cleanup } = await importWithData(SOURCE, {
    [DATA_SPECIFIER]: {
      sourceUrl: 'https://www.cncf.io/reports/',
      radarReports: [REPORT],
    },
  });
  try {
    const tree = RadarReports();
    assert.equal(renderSyncStatus(tree), null);
    assert.ok(!textOf(tree).includes('Mirrored from'));
    assert.ok(!textOf(tree).includes('Invalid Date'));
    assert.equal(findAllByType(tree, 'li').length, 1);
  } finally {
    cleanup();
  }
});

test('a corpus with no radarReports key renders an empty labelled list without throwing', async () => {
  const { default: RadarReports, cleanup } = await importWithData(SOURCE, {
    [DATA_SPECIFIER]: {},
  });
  try {
    const tree = RadarReports();
    assert.equal(tree.type, 'section');
    assert.equal(tree.props['aria-label'], 'CNCF Technology Radar reports');
    assert.ok(findByType(tree, 'ul'), 'expected the empty list to render');
    assert.equal(findAllByType(tree, 'li').length, 0);
  } finally {
    cleanup();
  }
});

test('a report without publishedAt renders no date row while a dated sibling keeps its date', async () => {
  const undated = { ...REPORT, id: 'radar-undated', publishedAt: undefined };
  const { default: RadarReports, cleanup } = await importWithData(SOURCE, {
    [DATA_SPECIFIER]: {
      generatedAt: '2024-02-01T00:00:00.000Z',
      sourceUrl: 'https://www.cncf.io/reports/',
      radarReports: [undated, REPORT],
    },
  });
  try {
    const [first, second] = findAllByType(RadarReports(), 'li');
    const expected = new Date(REPORT.publishedAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    assert.ok(!textOf(first).includes(expected));
    assert.ok(!textOf(first).includes('Invalid Date'));
    assert.ok(textOf(second).includes(expected));
  } finally {
    cleanup();
  }
});

test('the fixture path renders the same provenance contract as the live corpus', async () => {
  const generatedAt = '2024-02-01T00:00:00.000Z';
  const sourceUrl = 'https://www.cncf.io/reports/';
  const { default: RadarReports, cleanup } = await importWithData(SOURCE, {
    [DATA_SPECIFIER]: { generatedAt, sourceUrl, radarReports: [REPORT] },
  });
  try {
    const status = renderSyncStatus(RadarReports());
    assert.ok(status, 'expected a provenance line');
    const anchor = findByType(status, 'a');
    assert.equal(anchor.props.href, sourceUrl);
    assert.equal(anchor.props.target, '_blank');
    assert.match(anchor.props.rel, /noreferrer/);
    const expected = new Date(generatedAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    assert.ok(textOf(status).includes(expected));
  } finally {
    cleanup();
  }
});
