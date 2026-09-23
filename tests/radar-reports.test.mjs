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
// so the test cannot inject a fixture through props. Importing the same JSON
// through importSource resolves to the same module URL the component's
// `@site/data/radar-reports.json` specifier resolves to, so this is the very
// object the component reads. The three branches the checked-in corpus never
// takes are reached by patching that object around a single render and
// restoring it in a `finally` — see `withCorpus` below.
//
// tests/helpers-component-data.mjs is deliberately not used here: it imports a
// rewritten *copy* of the source, so the copy's coverage is attributed to the
// temp file and these branches would stay red on the real one.
const { default: data } = await importSource('data/radar-reports.json');
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

/**
 * Renders with a temporarily patched corpus, then restores it.
 *
 * A key whose patch value is `undefined` is deleted for the duration, which is
 * how the missing-field fallbacks are reached; every key is put back exactly as
 * it was — present with its old value, or absent — so the order tests run in
 * cannot matter.
 *
 * @param {Record<string, unknown>} patch keys of data/radar-reports.json
 * @param {() => void} run assertions to make while the patch is applied
 */
function withCorpus(patch, run) {
  const saved = Object.entries(patch).map(([key]) => [
    key,
    Object.prototype.hasOwnProperty.call(data, key),
    data[key],
  ]);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete data[key];
    else data[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, present, value] of saved) {
      if (present) data[key] = value;
      else delete data[key];
    }
  }
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

// The three fallbacks below are unreachable from the checked-in corpus, which
// has `generatedAt` set, six reports and no report missing `publishedAt`. They
// are the arms that run when the upstream mirror is incomplete, which is
// exactly when /reports must still render rather than throw.

test('no provenance line is rendered when the mirror date is missing', () => {
  withCorpus({ generatedAt: undefined }, () => {
    assert.equal(
      renderSyncStatus(RadarReports()),
      null,
      'a corpus with no generatedAt must render no provenance line',
    );
  });
});

test('an empty page is rendered when the corpus holds no report list', () => {
  withCorpus({ radarReports: undefined }, () => {
    const tree = RadarReports();
    assert.equal(
      findAllByType(tree, 'li').length,
      0,
      'a corpus with no radarReports key must render no list items',
    );
    const list = findByType(tree, 'ul');
    assert.ok(list, 'the list element itself must still be rendered');
  });

  withCorpus({ radarReports: [] }, () => {
    assert.equal(findAllByType(RadarReports(), 'li').length, 0);
  });
});

test('a report with no publication date renders no date row', () => {
  const undated = {
    id: 'undated-report',
    title: 'Undated report',
    url: 'https://www.cncf.io/reports/undated/',
    summary: 'A mirrored report whose upstream page carries no date.',
  };
  withCorpus({ radarReports: [undated] }, () => {
    const items = findAllByType(RadarReports(), 'li');
    assert.equal(items.length, 1);
    const [item] = items;
    assert.equal(
      findByType(item, 'p')?.props.className,
      'summary',
      'the only paragraph in an undated item must be its summary',
    );
    const text = textOf(item);
    assert.ok(text.includes(undated.title));
    assert.ok(text.includes(undated.summary));
  });
});
