// MetricsDashboard renders the whole /metrics page: the headline metric cards,
// the reference-architecture lifecycle panel, the time-series line charts and
// the breakdown bar charts. All of it is hand-rolled SVG whose coordinates come
// from three unexported helpers (pointX, pointY, linePoints) plus an inline
// Sparkline, and none of it had any unit coverage, so an off-by-one in the axis
// mapping, a division by an empty series, a lost `rel="noreferrer"` on an
// outbound source link or a dropped aria-label would all ship unnoticed.
//
// The component reads data/metrics.json at module scope, so the assertions
// below are written as invariants that hold for any shape of that file rather
// than as snapshots of today's numbers.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importSource } from './helpers-jsx.mjs';
import {
  findAllByType,
  findByType,
  textOf,
  walkElements,
} from './tools/react-element-tree.mjs';

const { default: MetricsDashboard } = await importSource(
  'src/components/MetricsDashboard/index.js',
);
const { default: metricsData } = await importSource('data/metrics.json');

const dashboard = MetricsDashboard();

/** @returns {any[]} every element in the tree, in document order */
function elements(tree) {
  return [...walkElements(tree)];
}

/**
 * Locates a nested component by function name and renders it.
 *
 * The inner components are not exported, so the only handle a test has on them
 * is the element the dashboard returns; calling `element.type` with its props
 * renders one level deeper without pulling in a real renderer.
 */
function renderNested(tree, name, propsOverride) {
  const element = elements(tree).find(
    (candidate) =>
      typeof candidate.type === 'function' && candidate.type.name === name,
  );
  assert.ok(element, `expected a <${name}> element in the tree`);
  return element.type(propsOverride ?? element.props);
}

function componentNamed(tree, name) {
  const element = elements(tree).find(
    (candidate) =>
      typeof candidate.type === 'function' && candidate.type.name === name,
  );
  assert.ok(element, `expected a <${name}> element in the tree`);
  return element.type;
}

function parsePoints(value) {
  assert.equal(typeof value, 'string', 'expected a points attribute string');
  if (value === '') return [];
  return value.split(' ').map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    assert.ok(
      Number.isFinite(x) && Number.isFinite(y),
      `expected finite coordinates, got "${pair}"`,
    );
    return { x, y };
  });
}

const lifecycle = renderNested(dashboard, 'LifecycleSection');
const Sparkline = componentNamed(lifecycle, 'Sparkline');

test('the freshness line states when the data was collected, in UTC', () => {
  const meta = elements(dashboard).find((element) =>
    textOf(element).startsWith('Last updated'),
  );
  assert.ok(meta, 'expected a "Last updated" meta line');

  const expected = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(metricsData.generatedAt));
  assert.match(textOf(meta), new RegExp(`Last updated ${expected} UTC`));
  assert.match(
    textOf(meta),
    /UTC/,
    'the timestamp is formatted in UTC, so it must say so',
  );
});

test('every headline metric becomes one outbound card', () => {
  const grid = elements(dashboard).find(
    (element) => element.props?.className === 'grid',
  );
  assert.ok(grid, 'expected the metric card grid');
  const cards = findAllByType(grid, 'a');
  assert.equal(cards.length, metricsData.metrics.length);

  cards.forEach((card, index) => {
    const metric = metricsData.metrics[index];
    assert.equal(card.props.href, metric.sourceUrl);
    assert.match(textOf(card), new RegExp(metric.label));
    assert.match(textOf(card), new RegExp(`Source: ${metric.source}`));
  });
});

test('metric values are rendered with thousands separators', () => {
  const grid = elements(dashboard).find(
    (element) => element.props?.className === 'grid',
  );
  for (const [index, card] of findAllByType(grid, 'a').entries()) {
    const { value } = metricsData.metrics[index];
    assert.match(textOf(card), new RegExp(value.toLocaleString()));
  }
});

test('no outbound source link can reach back through window.opener', () => {
  const external = elements(dashboard)
    .concat(elements(lifecycle))
    .filter(
      (element) => element.type === 'a' && element.props?.target === '_blank',
    );
  assert.ok(external.length > 0, 'expected outbound source links');
  for (const link of external) {
    assert.match(
      link.props.rel ?? '',
      /\bnoreferrer\b/,
      `${link.props.href} opens in a new tab without rel="noreferrer"`,
    );
  }
});

test('each line chart is labelled by its own heading', () => {
  const sections = elements(dashboard).filter(
    (element) => element.props?.className === 'lineChart',
  );
  assert.equal(sections.length, Object.keys(metricsData.series ?? {}).length);

  for (const [index, id] of Object.keys(metricsData.series ?? {}).entries()) {
    const section = sections[index];
    assert.equal(section.props['aria-labelledby'], `${id}-title`);
    const heading = findByType(section, 'h2');
    assert.ok(heading, 'expected an <h2> inside the chart');
    assert.equal(
      heading.props.id,
      `${id}-title`,
      'the aria-labelledby target must exist in the same section',
    );
    assert.equal(textOf(heading), metricsData.series[id].label);
  }
});

test('line chart geometry stays inside the declared viewBox', () => {
  const sections = elements(dashboard).filter(
    (element) => element.props?.className === 'lineChart',
  );
  for (const [index, id] of Object.keys(metricsData.series ?? {}).entries()) {
    const { values } = metricsData.series[id];
    const svg = findByType(sections[index], 'svg');
    assert.equal(svg.props.viewBox, '0 0 520 220');

    const points = parsePoints(findByType(svg, 'polyline').props.points);
    assert.equal(points.length, values.length);
    for (const { x, y } of points) {
      assert.ok(x >= 20 && x <= 500, `x ${x} escaped the 20..500 plot area`);
      assert.ok(y >= 30 && y <= 190, `y ${y} escaped the 30..190 plot area`);
    }
    for (let i = 1; i < points.length; i += 1) {
      assert.ok(
        points[i].x > points[i - 1].x,
        'points must advance left to right',
      );
    }
  }
});

test('the largest value in a series sits at the top of the plot area', () => {
  const sections = elements(dashboard).filter(
    (element) => element.props?.className === 'lineChart',
  );
  for (const [index, id] of Object.keys(metricsData.series ?? {}).entries()) {
    const { values } = metricsData.series[id];
    const max = Math.max(...values.map((point) => point.value), 1);
    if (max !== Math.max(...values.map((point) => point.value))) continue;

    const points = parsePoints(
      findByType(findByType(sections[index], 'svg'), 'polyline').props.points,
    );
    const top = Math.min(...points.map((point) => point.y));
    assert.equal(top, 30, `the peak of ${id} must map to y=30`);
  }
});

test('a single-point series is centred rather than divided by zero', () => {
  const single = Object.entries(metricsData.series ?? {}).find(
    ([, series]) => series.values.length === 1,
  );
  if (!single) {
    // The fixture no longer exercises the length<=1 guard; the invariant check
    // above still covers every multi-point series.
    return;
  }
  const [id] = single;
  const section = elements(dashboard).find(
    (element) => element.props?.['aria-labelledby'] === `${id}-title`,
  );
  const points = parsePoints(
    findByType(findByType(section, 'svg'), 'polyline').props.points,
  );
  assert.deepEqual(points, [{ x: 20, y: 30 }]);
});

test('every line chart point carries a hoverable date/value title', () => {
  const sections = elements(dashboard).filter(
    (element) => element.props?.className === 'lineChart',
  );
  for (const [index, id] of Object.keys(metricsData.series ?? {}).entries()) {
    const { values } = metricsData.series[id];
    const circles = findAllByType(sections[index], 'circle');
    assert.equal(circles.length, values.length);

    const points = parsePoints(
      findByType(findByType(sections[index], 'svg'), 'polyline').props.points,
    );
    circles.forEach((circle, pointIndex) => {
      assert.equal(circle.props.cx, points[pointIndex].x);
      assert.equal(circle.props.cy, points[pointIndex].y);
      const title = findByType(circle, 'title');
      assert.ok(title, 'expected a <title> for the marker tooltip');
      assert.equal(
        textOf(title),
        `${values[pointIndex].date}: ${values[pointIndex].value}`,
      );
    });
  }
});

test('the chart range row reports the first and last observation', () => {
  const sections = elements(dashboard).filter(
    (element) => element.props?.className === 'lineChart',
  );
  for (const [index, id] of Object.keys(metricsData.series ?? {}).entries()) {
    const { values, source } = metricsData.series[id];
    const range = elements(sections[index]).find(
      (element) => element.props?.className === 'chartRange',
    );
    assert.ok(range, 'expected a chart range row');
    const text = textOf(range);
    assert.match(text, new RegExp(values[0].date));
    assert.match(text, new RegExp(values.at(-1).date));
    assert.match(text, new RegExp(values.at(-1).value.toLocaleString()));
    assert.match(
      textOf(sections[index]),
      new RegExp(`Collected from ${source}`),
    );
  }
});

test('breakdown bars are sized relative to the leading value', () => {
  const charts = elements(dashboard).filter(
    (element) => element.props?.className === 'chart',
  );
  assert.equal(charts.length, Object.keys(metricsData.breakdowns ?? {}).length);

  for (const [index, id] of Object.keys(
    metricsData.breakdowns ?? {},
  ).entries()) {
    const chart = metricsData.breakdowns[id];
    const rows = elements(charts[index]).filter(
      (element) => element.props?.role === 'listitem',
    );
    assert.equal(rows.length, chart.values.length);

    rows.forEach((row, rowIndex) => {
      const item = chart.values[rowIndex];
      assert.match(textOf(row), new RegExp(item.name));
      const bar = elements(row).find(
        (element) => element.props?.className === 'bar',
      );
      assert.ok(bar, 'expected a bar fill element');
      const expected = `${(item.value / chart.values[0].value) * 100}%`;
      assert.equal(bar.props.style['--bar-width'], expected);
    });

    const leading = elements(charts[index]).find(
      (element) => element.props?.role === 'listitem',
    );
    const leadingBar = elements(leading).find(
      (element) => element.props?.className === 'bar',
    );
    assert.equal(leadingBar.props.style['--bar-width'], '100%');
  }
});

test('the breakdown bars are exposed as a list to assistive technology', () => {
  const charts = elements(dashboard).filter(
    (element) => element.props?.className === 'chart',
  );
  for (const chart of charts) {
    const list = elements(chart).find(
      (element) => element.props?.role === 'list',
    );
    assert.ok(list, 'expected role="list" on the bar container');
    assert.equal(list.props.className, 'bars');
  }
});

test('omitted metrics are disclosed rather than silently dropped', () => {
  const transparency = elements(dashboard).find(
    (element) => element.props?.className === 'transparency',
  );
  assert.ok(transparency, 'expected the data-coverage disclosure block');
  const text = textOf(transparency);
  for (const item of metricsData.omitted) {
    assert.match(text, new RegExp(`${item.id}: `));
    assert.match(
      text,
      new RegExp(
        item.reason.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      ),
    );
  }
});

test('the lifecycle panel renders one card per leading indicator', () => {
  const source = metricsData.referenceArchitectureLifecycle;
  const cards = elements(lifecycle).filter(
    (element) => element.props?.className === 'lifecycleCard',
  );
  assert.equal(cards.length, (source?.cards ?? []).length);

  cards.forEach((card, index) => {
    const expected = source.cards[index];
    const text = textOf(card);
    assert.match(text, new RegExp(expected.label));
    assert.match(text, new RegExp(expected.value.toLocaleString()));
    assert.match(
      text,
      new RegExp(
        expected.note.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      ),
    );
  });
});

test('a lifecycle card without a suffix renders no stray unit', () => {
  const source = metricsData.referenceArchitectureLifecycle;
  const cards = elements(lifecycle).filter(
    (element) => element.props?.className === 'lifecycleCard',
  );
  cards.forEach((card, index) => {
    const { value, suffix } = source.cards[index];
    const strong = findByType(card, 'strong');
    assert.equal(
      textOf(strong).trim(),
      `${value.toLocaleString()} ${suffix ?? ''}`.trim(),
    );
  });
});

test('the lifecycle section is labelled and cites its own source', () => {
  const source = metricsData.referenceArchitectureLifecycle;
  assert.equal(lifecycle.props['aria-labelledby'], 'lifecycle-title');
  assert.equal(findByType(lifecycle, 'h2').props.id, 'lifecycle-title');
  assert.equal(findByType(lifecycle, 'a').props.href, source?.sourceUrl);
});

test('what is not yet measurable stays behind a disclosure', () => {
  const source = metricsData.referenceArchitectureLifecycle;
  const details = findByType(lifecycle, 'details');
  assert.ok(details, 'expected a <details> disclosure');
  assert.equal(
    textOf(findByType(details, 'summary')),
    'What is not yet measurable',
  );
  for (const item of source?.omitted ?? []) {
    assert.match(textOf(details), new RegExp(`${item.id}:`));
  }
});

test('each lifecycle trend gets a labelled sparkline', () => {
  const source = metricsData.referenceArchitectureLifecycle;
  const trends = elements(lifecycle).filter(
    (element) => element.props?.className === 'trend',
  );
  assert.equal(trends.length, Object.keys(source?.trends ?? {}).length);

  for (const [index, id] of Object.keys(source?.trends ?? {}).entries()) {
    const trend = source.trends[id];
    assert.match(textOf(trends[index]), new RegExp(trend.label));
    const spark = findByType(trends[index], Sparkline);
    assert.ok(spark, 'expected a Sparkline for the trend');
    assert.deepEqual(spark.props.values, trend.values);
  }
});

test('a sparkline maps its extremes onto the full 0..100 width', () => {
  const tree = Sparkline({
    values: [
      { date: '2024-01', value: 0 },
      { date: '2024-02', value: 5 },
    ],
  });
  assert.equal(tree.type, 'svg');
  assert.equal(tree.props.viewBox, '0 0 100 24');
  assert.deepEqual(parsePoints(findByType(tree, 'polyline').props.points), [
    { x: 0, y: 24 },
    { x: 100, y: 4 },
  ]);
});

test('a single-sample sparkline is centred instead of dividing by zero', () => {
  const tree = Sparkline({ values: [{ date: '2025-01', value: 3 }] });
  assert.deepEqual(parsePoints(findByType(tree, 'polyline').props.points), [
    { x: 50, y: 4 },
  ]);
});

test('an all-zero sparkline falls back to a denominator of one', () => {
  const tree = Sparkline({
    values: [
      { date: '2025-01', value: 0 },
      { date: '2025-02', value: 0 },
    ],
  });
  assert.deepEqual(parsePoints(findByType(tree, 'polyline').props.points), [
    { x: 0, y: 24 },
    { x: 100, y: 24 },
  ]);
});

test('a sparkline announces the period it covers', () => {
  const tree = Sparkline({
    values: [
      { date: '2024-09', value: 5 },
      { date: '2026-06', value: 27 },
    ],
  });
  assert.equal(tree.props.role, 'img');
  assert.equal(tree.props['aria-label'], 'Trend from 2024-09 to 2026-06');
});

test('an empty sparkline says so instead of rendering an empty chart', () => {
  const tree = Sparkline({ values: [] });
  assert.equal(tree.type, 'span');
  assert.equal(textOf(tree), 'No trend data yet');
});

test('a sparkline called without values does not throw', () => {
  assert.equal(textOf(Sparkline({})), 'No trend data yet');
});
