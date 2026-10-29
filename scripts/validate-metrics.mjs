#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  checkDuplicateOrMissingId,
  checkIsoTimestamp,
  checkUrl as checkUrlImpl,
  reportAndExit,
  CNCF_HOST_SUFFIXES,
} from './lib/validate-utils.mjs';
const data = JSON.parse(
  readFileSync(new URL('../data/metrics.json', import.meta.url)),
);
const errors = [];

// Every URL in metrics.json is rendered straight into an <a href> by
// src/components/MetricsDashboard and src/components/ReferenceArchitectures,
// so an href-bearing scheme other than https reaching the published site is an
// active-content sink. Absent values are left to the existing presence checks.
//
// The protocol test alone is not enough: "https://www.cncf.io@evil.example/"
// parses with protocol "https:" while resolving to evil.example, so it reads
// as CNCF to a human reviewing a generated diff and resolves elsewhere in a
// browser. checkUrl() in ./lib/validate-utils.mjs is the shared gate for this
// check.
//
// The scheme and userinfo tests are still not a gate on their own: every one of
// these URLs is rendered under hard-coded anchor text ("cncf/architecture",
// "Source ↗"), so a plain https URL on a host that is not CNCF's publishes as a
// CNCF-labelled link to an unrelated origin. Hold the host to an allow-list,
// the same CNCF_HOST_SUFFIXES base scripts/validate-case-studies.mjs and
// scripts/validate-radar-reports.mjs import from scripts/lib/url-safety.mjs.
// github.com is allowed because sources.*.repository, sources.*.sourceUrl and
// several metric sourceUrl values legitimately point at github.com/cncf/...
const ALLOWED_HOST_SUFFIXES = [...CNCF_HOST_SUFFIXES, 'github.com'];

function checkUrl(path, field, value) {
  checkUrlImpl(errors, path, field, value, {
    allowEmpty: true,
    unparsedMessage: `${field} must be an absolute URL`,
    allowedHostSuffixes: ALLOWED_HOST_SUFFIXES,
  });
}

if (!data.generated)
  errors.push({
    path: 'metrics.json',
    severity: 'error',
    message: 'generated must be true',
  });
checkIsoTimestamp(errors, 'metrics.json', 'generatedAt', data.generatedAt);
if (
  !data.sources?.landscape?.revision ||
  !data.sources?.architectures?.revision
)
  errors.push({
    path: 'metrics.json',
    severity: 'error',
    message: 'source revisions are required',
  });
for (const name of ['landscape', 'architectures']) {
  const source = data.sources?.[name];
  if (!source) continue;
  checkUrl(`sources.${name}`, 'repository', source.repository);
  checkUrl(`sources.${name}`, 'sourceUrl', source.sourceUrl);
}
checkUrl(
  'referenceArchitectureLifecycle',
  'sourceUrl',
  data.referenceArchitectureLifecycle?.sourceUrl,
);
const ids = new Set();
for (const metric of data.metrics || []) {
  checkDuplicateOrMissingId(
    errors,
    metric.id,
    metric.id,
    ids,
    'duplicate or missing metric id',
  );
  if (
    metric.value === undefined ||
    metric.value === null ||
    metric.value === ''
  )
    errors.push({
      path: metric.id,
      severity: 'error',
      message: 'missing value',
    });
  if (!metric.source || !metric.sourceUrl || !metric.collectedAt)
    errors.push({
      path: metric.id,
      severity: 'error',
      message: 'missing provenance',
    });
  checkUrl(metric.id, 'sourceUrl', metric.sourceUrl);
}
for (const item of data.omitted || [])
  if (!item.id || !item.reason)
    errors.push({
      path: 'metrics.json',
      severity: 'error',
      message: 'omitted metrics require id and reason',
    });
for (const card of data.referenceArchitectureLifecycle?.cards || []) {
  if (!card.id || !card.label || !Number.isFinite(card.value))
    errors.push({
      path: 'metrics.json',
      severity: 'error',
      message: 'invalid lifecycle card',
    });
  // sampleSize is optional; the dashboard renders "No data yet" when it is 0.
  if (
    card.sampleSize !== undefined &&
    !(Number.isInteger(card.sampleSize) && card.sampleSize >= 0)
  )
    errors.push({
      path: 'metrics.json',
      severity: 'error',
      message: 'lifecycle card sampleSize must be a non-negative integer',
    });
}
for (const item of data.referenceArchitectureLifecycle?.omitted || [])
  if (!item.id || !item.reason)
    errors.push({
      path: 'metrics.json',
      severity: 'error',
      message: 'invalid lifecycle omission',
    });
for (const [id, series] of Object.entries(data.series || {})) {
  if (
    !series.label ||
    !series.sourceUrl ||
    !Array.isArray(series.values) ||
    !series.values.length
  )
    errors.push({
      path: 'metrics.json',
      severity: 'error',
      message: 'invalid time series',
    });
  checkUrl(`series.${id}`, 'sourceUrl', series.sourceUrl);
  for (const point of Array.isArray(series.values) ? series.values : [])
    if (!point.date || !Number.isFinite(point.value))
      errors.push({
        path: 'metrics.json',
        severity: 'error',
        message: 'invalid time-series point',
      });
}
for (const [id, chart] of Object.entries(data.breakdowns || {})) {
  if (!chart.label || !chart.sourceUrl || !Array.isArray(chart.values))
    errors.push({
      path: 'metrics.json',
      severity: 'error',
      message: 'invalid breakdown',
    });
  checkUrl(`breakdowns.${id}`, 'sourceUrl', chart.sourceUrl);
  for (const item of Array.isArray(chart.values) ? chart.values : [])
    if (!item.name || !Number.isFinite(item.value))
      errors.push({
        path: 'metrics.json',
        severity: 'error',
        message: 'invalid breakdown value',
      });
}
reportAndExit(errors, 'metrics');
console.log(`Validated ${data.metrics.length} metrics`);
