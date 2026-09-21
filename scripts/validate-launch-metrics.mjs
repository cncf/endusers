#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { reportAndExit } from './lib/validate-utils.mjs';
const data = JSON.parse(
  readFileSync(new URL('../data/launch-metrics.json', import.meta.url)),
);
const errors = [];

function checkUrl(path, field, value) {
  if (value === undefined || value === null || value === '') return;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push({
      path,
      severity: 'error',
      message: `${field} must be an absolute URL`,
    });
    return;
  }
  if (parsed.protocol !== 'https:')
    errors.push({
      path,
      severity: 'error',
      message: `${field} must use https, got ${parsed.protocol}`,
    });
}

function checkNonNegativeInteger(path, field, value) {
  if (!Number.isInteger(value) || value < 0)
    errors.push({
      path,
      severity: 'error',
      message: `${field} must be a finite, non-negative integer`,
    });
}

if (!data.generated)
  errors.push({
    path: 'launch-metrics.json',
    severity: 'error',
    message: 'generated must be true',
  });
if (Number.isNaN(Date.parse(data.generatedAt)))
  errors.push({
    path: 'launch-metrics.json',
    severity: 'error',
    message: 'generatedAt must be ISO 8601',
  });
if (Number.isNaN(Date.parse(data.capturedAt)))
  errors.push({
    path: 'launch-metrics.json',
    severity: 'error',
    message: 'capturedAt must be ISO 8601',
  });
checkUrl('launch-metrics.json', 'source', data.source);
if (!data.checkpoint?.label || !data.checkpoint?.targetDate)
  errors.push({
    path: 'checkpoint',
    severity: 'error',
    message: 'checkpoint requires a label and a targetDate',
  });
if (
  data.checkpoint?.targetDate &&
  Number.isNaN(Date.parse(data.checkpoint.targetDate))
)
  errors.push({
    path: 'checkpoint',
    severity: 'error',
    message: 'checkpoint.targetDate must be a valid date',
  });

const signals = data.signals || [];
if (signals.length < 3 || signals.length > 5)
  errors.push({
    path: 'launch-metrics.json',
    severity: 'error',
    message: `signals must define 3-5 signals, got ${signals.length}`,
  });

const ids = new Set();
for (const signal of signals) {
  const path = signal.id || '(missing id)';
  if (!signal.id || ids.has(signal.id))
    errors.push({
      path,
      severity: 'error',
      message: 'duplicate or missing signal id',
    });
  ids.add(signal.id);
  if (!signal.label)
    errors.push({ path, severity: 'error', message: 'missing label' });
  if (!signal.sourceUrl || !signal.collectedAt)
    errors.push({
      path,
      severity: 'error',
      message: 'missing provenance (sourceUrl/collectedAt)',
    });
  if (Number.isNaN(Date.parse(signal.collectedAt)))
    errors.push({
      path,
      severity: 'error',
      message: 'collectedAt must be ISO 8601',
    });
  checkUrl(path, 'sourceUrl', signal.sourceUrl);
  checkNonNegativeInteger(path, 'baseline', signal.baseline);
  checkNonNegativeInteger(path, 'target90Day', signal.target90Day);
  if (
    Number.isInteger(signal.baseline) &&
    Number.isInteger(signal.target90Day) &&
    signal.baseline > signal.target90Day
  ) {
    errors.push({
      path,
      severity: 'error',
      message: `target90Day (${signal.target90Day}) must be >= baseline (${signal.baseline})`,
    });
  }
}

reportAndExit(errors, 'launch metrics');
console.log(`Validated ${signals.length} launch metrics`);
