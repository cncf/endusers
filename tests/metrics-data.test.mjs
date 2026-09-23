import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('..', import.meta.url);

const metrics = JSON.parse(
  readFileSync(new URL('data/metrics.json', repoRoot), 'utf8'),
);

// These assertions cover the render contract that
// src/components/MetricsDashboard/index.js depends on but
// scripts/validate-metrics.mjs does not enforce. The validator is tolerant
// where the component is not: it reads `data.omitted || []` and only checks
// `Array.isArray(chart.values)`, while the component dereferences
// `metricsData.omitted.map(...)` and `chart.values[0].value` without a guard.
// A metrics.json that passes `npm run validate:metrics` can still crash
// `npm run build`, so these invariants are asserted against the real file.

test('omitted is present and an array', () => {
  // MetricsDashboard calls metricsData.omitted.map(...) with no `|| []`
  // fallback, so an absent key is a TypeError during the site build even
  // though validate-metrics.mjs accepts it.
  assert.ok(
    Array.isArray(metrics.omitted),
    'omitted must be an array; the dashboard maps over it unguarded',
  );
});

test('every omitted entry carries the id and reason the dashboard renders', () => {
  for (const item of metrics.omitted) {
    assert.equal(typeof item.id, 'string');
    assert.ok(item.id.length > 0);
    assert.equal(typeof item.reason, 'string');
    assert.ok(item.reason.length > 0);
  }
});

test('metrics is a non-empty array of finite numeric values', () => {
  assert.ok(Array.isArray(metrics.metrics), 'metrics must be an array');
  assert.ok(metrics.metrics.length > 0, 'metrics must not be empty');
  for (const metric of metrics.metrics) {
    // The dashboard renders metric.value.toLocaleString() as a number, and
    // validate-metrics.mjs only rejects undefined/null/empty-string, so a
    // string value passes validation and renders unformatted.
    assert.ok(
      Number.isFinite(metric.value),
      `${metric.id} must have a finite numeric value for toLocaleString()`,
    );
  }
});

test('generatedAt parses as a date the dashboard can format', () => {
  assert.ok(
    !Number.isNaN(Date.parse(metrics.generatedAt)),
    'generatedAt must be parseable by new Date() for Intl.DateTimeFormat',
  );
});

test('every breakdown has a non-empty values array', () => {
  const breakdowns = Object.entries(metrics.breakdowns ?? {});
  assert.ok(breakdowns.length > 0, 'expected at least one breakdown');
  for (const [id, chart] of breakdowns) {
    // validate-metrics.mjs accepts `values: []`, but the dashboard reads
    // chart.values[0].value as the bar-width divisor, which throws on empty.
    assert.ok(Array.isArray(chart.values), `${id} values must be an array`);
    assert.ok(
      chart.values.length > 0,
      `${id} values must not be empty; the dashboard reads values[0].value`,
    );
  }
});

test('every breakdown uses a positive first value as its bar-width divisor', () => {
  for (const [id, chart] of Object.entries(metrics.breakdowns ?? {})) {
    // A zero divisor is finite, so the validator accepts it, but it makes
    // every bar width NaN.
    assert.ok(
      Number.isFinite(chart.values[0].value) && chart.values[0].value > 0,
      `${id} values[0].value must be > 0 to divide bar widths by`,
    );
  }
});

test('breakdown values are sorted newest-largest first', () => {
  for (const [id, chart] of Object.entries(metrics.breakdowns ?? {})) {
    // Bar width is item.value / values[0].value * 100, so anything larger
    // than values[0] overflows its track.
    for (const [index, item] of chart.values.entries()) {
      if (index === 0) continue;
      assert.ok(
        chart.values[index - 1].value >= item.value,
        `${id} values must be sorted descending so no bar exceeds 100% width`,
      );
    }
  }
});

test('every breakdown entry has the name the dashboard keys rows by', () => {
  for (const [id, chart] of Object.entries(metrics.breakdowns ?? {})) {
    const names = chart.values.map((item) => item.name);
    for (const name of names) {
      assert.equal(
        typeof name,
        'string',
        `${id} breakdown name must be a string`,
      );
      assert.ok(name.length > 0, `${id} breakdown name must not be empty`);
    }
    assert.equal(
      new Set(names).size,
      names.length,
      `${id} breakdown names must be unique; they are used as React keys`,
    );
  }
});

test('lifecycle trends expose the shape Sparkline consumes', () => {
  // validate-metrics.mjs validates referenceArchitectureLifecycle.cards and
  // .omitted but never inspects .trends, so nothing else checks this shape.
  const trends = metrics.referenceArchitectureLifecycle?.trends ?? {};
  assert.ok(
    Object.keys(trends).length > 0,
    'expected at least one lifecycle trend',
  );
  for (const [id, trend] of Object.entries(trends)) {
    assert.equal(typeof trend.label, 'string', `${id} trend needs a label`);
    assert.ok(trend.label.length > 0, `${id} trend label must not be empty`);
    assert.ok(
      Array.isArray(trend.values),
      `${id} trend values must be an array; Sparkline maps over it`,
    );
    for (const point of trend.values) {
      // Sparkline renders values[0].date and values.at(-1).date into its
      // aria-label and divides by the max value.
      assert.ok(
        point.date,
        `${id} trend point needs a date for the aria-label`,
      );
      assert.ok(
        Number.isFinite(point.value),
        `${id} trend point value must be a finite number`,
      );
    }
  }
});

test('lifecycle cards expose the value the dashboard formats', () => {
  const cards = metrics.referenceArchitectureLifecycle?.cards ?? [];
  assert.ok(cards.length > 0, 'expected at least one lifecycle card');
  for (const card of cards) {
    assert.ok(card.id, 'lifecycle card needs an id for its React key');
    assert.ok(card.label, `${card.id} needs a label`);
    assert.ok(
      Number.isFinite(card.value),
      `${card.id} value must be finite for toLocaleString()`,
    );
  }
});

test('every series has ordered points the line chart can plot', () => {
  const series = Object.entries(metrics.series ?? {});
  assert.ok(series.length > 0, 'expected at least one series');
  for (const [id, entry] of series) {
    assert.ok(entry.label, `${id} series needs a label`);
    assert.ok(entry.sourceUrl, `${id} series needs a sourceUrl`);
    assert.ok(
      Array.isArray(entry.values) && entry.values.length > 0,
      `${id} series must have at least one point`,
    );
    // pointY divides by the max value, and the chart range renders
    // values[0].date alongside values.at(-1).date, so points must run
    // oldest-first for that range to read correctly.
    for (const [index, point] of entry.values.entries()) {
      assert.ok(
        !Number.isNaN(Date.parse(point.date)),
        `${id} series point ${index} needs a parseable date`,
      );
      assert.ok(
        Number.isFinite(point.value),
        `${id} series point ${index} needs a finite value`,
      );
      if (index === 0) continue;
      assert.ok(
        Date.parse(entry.values[index - 1].date) <= Date.parse(point.date),
        `${id} series points must run oldest first`,
      );
    }
  }
});
