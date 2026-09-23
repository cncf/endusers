// src/components/RadarReports/index.js renders the whole /reports page from
// the mirrored data/radar-reports.json corpus, and no test loaded it — it did
// not appear in the `node --test --experimental-test-coverage` report at all.
//
// scripts/validate-radar-reports.mjs guards the shape of the JSON, but nothing
// guarded the rendering: the provenance line, the one-<li>-per-report mapping,
// the optional publishedAt row and — most importantly — the
// `target="_blank"`/`rel="noreferrer"` pairing on every outbound cncf.io link
// could all regress silently. These assertions cover the rendered output.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { importSource } from './helpers-jsx.mjs';
import {
  findAllByType,
  findByType,
  textOf,
  walkElements,
} from './tools/react-element-tree.mjs';

const { default: RadarReports } = await importSource(
  'src/components/RadarReports/index.js',
);

// The component imports the corpus through the `@site` alias at module scope,
// so the test has to assert against the same checked-in file rather than an
// injected fixture.
const data = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../data/radar-reports.json', import.meta.url)),
    'utf8',
  ),
);
const reports = data.radarReports || [];

const LONG_DATE = { year: 'numeric', month: 'long', day: 'numeric' };

/**
 * `<SyncStatus />` is a nested component element, so the walker yields it
 * without descending into its output. Invoking it renders that subtree.
 */
function renderSyncStatus(tree) {
  const element = [...walkElements(tree)].find(
    (node) =>
      typeof node.type === 'function' && node.type.name === 'SyncStatus',
  );
  assert.ok(element, 'expected the component to render a <SyncStatus />');
  return element.type(element.props);
}

test('the report list is a labelled landmark region', () => {
  const tree = RadarReports();
  assert.equal(tree.type, 'section');
  assert.equal(tree.props['aria-label'], 'CNCF Technology Radar reports');
});

test('one list item is rendered per mirrored report', () => {
  const items = findAllByType(RadarReports(), 'li');
  assert.equal(items.length, reports.length);
  assert.ok(
    reports.length > 0,
    'expected the corpus to hold at least one report',
  );
});

test('every list item carries a unique React key', () => {
  const keys = findAllByType(RadarReports(), 'li').map((item) => item.key);
  assert.ok(
    keys.every((key) => key !== null && key !== undefined),
    'a keyless list item would make React re-mount rows on every re-render',
  );
  assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys}`);
});

test('each report title links to its own cncf.io page', () => {
  const items = findAllByType(RadarReports(), 'li');
  items.forEach((item, index) => {
    const report = reports[index];
    const heading = findByType(item, 'h3');
    assert.ok(heading, `report ${report.id} rendered no heading`);
    const anchor = findByType(heading, 'a');
    assert.ok(anchor, `report ${report.id} rendered no title link`);
    assert.equal(anchor.props.href, report.url);
    assert.equal(textOf(anchor), report.title);
  });
});

test('each report summary is rendered as text', () => {
  const items = findAllByType(RadarReports(), 'li');
  items.forEach((item, index) => {
    assert.ok(
      textOf(item).includes(reports[index].summary),
      `report ${reports[index].id} did not render its summary`,
    );
  });
});

test('a publication date is shown as a long en-US date', () => {
  const items = findAllByType(RadarReports(), 'li');
  const dated = reports.filter((report) => report.publishedAt);
  assert.ok(
    dated.length > 0,
    'expected at least one report with publishedAt to exercise the dated branch',
  );
  items.forEach((item, index) => {
    const report = reports[index];
    if (!report.publishedAt) return;
    const expected = new Date(report.publishedAt).toLocaleDateString(
      'en-US',
      LONG_DATE,
    );
    assert.ok(
      textOf(item).includes(expected),
      `report ${report.id} did not render "${expected}"`,
    );
  });
});

test('the provenance line credits the upstream source and mirror date', () => {
  const status = renderSyncStatus(RadarReports());
  assert.ok(status, 'expected a provenance line for a corpus with generatedAt');
  const anchor = findByType(status, 'a');
  assert.ok(anchor, 'expected the provenance line to link to the source');
  assert.equal(anchor.props.href, data.sourceUrl);
  const expectedDate = new Date(data.generatedAt).toLocaleDateString(
    'en-US',
    LONG_DATE,
  );
  const text = textOf(status);
  assert.match(text, /Mirrored from/);
  assert.ok(
    text.includes(expectedDate),
    `provenance line did not render "${expectedDate}": ${text}`,
  );
});

test('every outbound link opens in a new tab without leaking window.opener', () => {
  const tree = RadarReports();
  const anchors = [
    ...findAllByType(tree, 'a'),
    ...findAllByType(renderSyncStatus(tree), 'a'),
  ];
  assert.ok(
    anchors.length > reports.length,
    'expected the source link plus one link per report',
  );
  for (const anchor of anchors) {
    assert.equal(
      anchor.props.target,
      '_blank',
      `${anchor.props.href} is not _blank`,
    );
    assert.match(
      anchor.props.rel ?? '',
      /\bnoreferrer\b/,
      `${anchor.props.href} can reach back through window.opener`,
    );
  }
});
