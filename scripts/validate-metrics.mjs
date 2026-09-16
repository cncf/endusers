#!/usr bin/env node
import { readFileSync } from 'node:fs';
import { reportAndExit } from './lib/validate-utils.mjs';
const data = JSON.parse(readFileSync(new URL('../data/metrics.json', import.meta.url)));
const errors = [];
if (!data.generated) errors.push({ path: 'metrics.json', severity: 'error', message: 'generated must be true' });
if (Number.isNaN(Date.parse(data.generatedAt))) errors.push({ path: 'metrics.json', severity: 'error', message: 'generatedAt must be ISO 8601' });
if (!data.sources?.landscape?.revision || !data.sources?.architectures?.revision) errors.push({ path: 'metrics.json', severity: 'error', message: 'source revisions are required' });
const ids = new Set();
for (const metric of data.metrics || []) {
  if (!metric.id || ids.has(metric.id)) errors.push({ path: metric.id, severity: 'error', message: 'duplicate or missing metric id' });
  ids.add(metric.id);
  if (metric.value === undefined || metric.value === null || metric.value === '') errors.push({ path: metric.id, severity: 'error', message: 'missing value' });
  if (!metric.source || !metric.sourceUrl || !metric.collectedAt) errors.push({ path: metric.id, severity: 'error', message: 'missing provenance' });
}
for (const item of data.omitted || []) if (!item.id || !item.reason) errors.push({ path: 'metrics.json', severity: 'error', message: 'omitted metrics require id and reason' });
for (const card of data.referenceArchitectureLifecycle?.cards || []) if (!card.id || !card.label || !Number.isFinite(card.value)) errors.push({ path: 'metrics.json', severity: 'error', message: 'invalid lifecycle card' });
for (const item of data.referenceArchitectureLifecycle?.omitted || []) if (!item.id || !item.reason) errors.push({ path: 'metrics.json', severity: 'error', message: 'invalid lifecycle omission' });
for (const series of Object.values(data.series || {})) {
  if (!series.label || !series.sourceUrl || !Array.isArray(series.values) || !series.values.length) errors.push({ path: 'metrics.json', severity: 'error', message: 'invalid time series' });
  for (const point of series.values || []) if (!point.date || !Number.isFinite(point.value)) errors.push({ path: 'metrics.json', severity: 'error', message: 'invalid time-series point' });
}
for (const chart of Object.values(data.breakdowns || {})) {
  if (!chart.label || !chart.sourceUrl || !Array.isArray(chart.values)) errors.push({ path: 'metrics.json', severity: 'error', message: 'invalid breakdown' });
  for (const item of chart.values || []) if (!item.name || !Number.isFinite(item.value)) errors.push({ path: 'metrics.json', severity: 'error', message: 'invalid breakdown value' });
}
reportAndExit(errors, 'metrics');
console.log(`Validated ${data.metrics.length} metrics`);
