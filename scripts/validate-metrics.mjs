#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { reportAndExit } from './lib/validate-utils.mjs';
const data = JSON.parse(readFileSync(new URL('../data/metrics.json', import.meta.url)));
const errors = [];

// Every URL in metrics.json is rendered straight into an <a href> by
// src/components/MetricsDashboard and src/components/ReferenceArchitectures,
// so an href-bearing scheme other than https reaching the published site is an
// active-content sink. Absent values are left to the existing presence checks.
function checkUrl(path, field, value) {
  if (value === undefined || value === null || value === '') return;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push({ path, severity: 'error', message: `${field} must be an absolute URL` });
    return;
  }
  if (parsed.protocol !== 'https:') errors.push({ path, severity: 'error', message: `${field} must use https, got ${parsed.protocol}` });
}

if (!data.generated) errors.push({ path: 'metrics.json', severity: 'error', message: 'generated must be true' });
if (Number.isNaN(Date.parse(data.generatedAt))) errors.push({ path: 'metrics.json', severity: 'error', message: 'generatedAt must be ISO 8601' });
if (!data.sources?.landscape?.revision || !data.sources?.architectures?.revision) errors.push({ path: 'metrics.json', severity: 'error', message: 'source revisions are required' });
for (const name of ['landscape', 'architectures']) {
  const source = data.sources?.[name];
  if (!source) continue;
  checkUrl(`sources.${name}`, 'repository', source.repository);
  checkUrl(`sources.${name}`, 'sourceUrl', source.sourceUrl);
}
checkUrl('referenceArchitectureLifecycle', 'sourceUrl', data.referenceArchitectureLifecycle?.sourceUrl);
const ids = new Set();
for (const metric of data.metrics || []) {
  if (!metric.id || ids.has(metric.id)) errors.push({ path: metric.id, severity: 'error', message: 'duplicate or missing metric id' });
  ids.add(metric.id);
  if (metric.value === undefined || metric.value === null || metric.value === '') errors.push({ path: metric.id, severity: 'error', message: 'missing value' });
  if (!metric.source || !metric.sourceUrl || !metric.collectedAt) errors.push({ path: metric.id, severity: 'error', message: 'missing provenance' });
  checkUrl(metric.id, 'sourceUrl', metric.sourceUrl);
}
for (const item of data.omitted || []) if (!item.id || !item.reason) errors.push({ path: 'metrics.json', severity: 'error', message: 'omitted metrics require id and reason' });
for (const card of data.referenceArchitectureLifecycle?.cards || []) if (!card.id || !card.label || !Number.isFinite(card.value)) errors.push({ path: 'metrics.json', severity: 'error', message: 'invalid lifecycle card' });
for (const item of data.referenceArchitectureLifecycle?.omitted || []) if (!item.id || !item.reason) errors.push({ path: 'metrics.json', severity: 'error', message: 'invalid lifecycle omission' });
for (const [id, series] of Object.entries(data.series || {})) {
  if (!series.label || !series.sourceUrl || !Array.isArray(series.values) || !series.values.length) errors.push({ path: 'metrics.json', severity: 'error', message: 'invalid time series' });
  checkUrl(`series.${id}`, 'sourceUrl', series.sourceUrl);
  for (const point of series.values || []) if (!point.date || !Number.isFinite(point.value)) errors.push({ path: 'metrics.json', severity: 'error', message: 'invalid time-series point' });
}
for (const [id, chart] of Object.entries(data.breakdowns || {})) {
  if (!chart.label || !chart.sourceUrl || !Array.isArray(chart.values)) errors.push({ path: 'metrics.json', severity: 'error', message: 'invalid breakdown' });
  checkUrl(`breakdowns.${id}`, 'sourceUrl', chart.sourceUrl);
  for (const item of chart.values || []) if (!item.name || !Number.isFinite(item.value)) errors.push({ path: 'metrics.json', severity: 'error', message: 'invalid breakdown value' });
}
reportAndExit(errors, 'metrics');
console.log(`Validated ${data.metrics.length} metrics`);
