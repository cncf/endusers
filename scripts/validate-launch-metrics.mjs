#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  checkDuplicateOrMissingId,
  checkIsoTimestamp,
  checkUrl as checkUrlImpl,
  reportAndExit,
} from './lib/validate-utils.mjs';
const data = JSON.parse(
  readFileSync(new URL('../data/launch-metrics.json', import.meta.url)),
);
const errors = [];

// Launch signal provenance URLs are rendered as <a href>, so they are resolved
// through the URL parser rather than a prefix test. The protocol check alone
// is not enough: "https://www.cncf.io@evil.example/" parses with protocol
// "https:" while resolving to evil.example. checkUrl() in
// ./lib/validate-utils.mjs is the shared gate for this check.
function checkUrl(path, field, value) {
  checkUrlImpl(errors, path, field, value, {
    allowEmpty: true,
    unparsedMessage: `${field} must be an absolute URL`,
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
checkIsoTimestamp(
  errors,
  'launch-metrics.json',
  'generatedAt',
  data.generatedAt,
);
checkIsoTimestamp(errors, 'launch-metrics.json', 'capturedAt', data.capturedAt);
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
  checkDuplicateOrMissingId(
    errors,
    path,
    signal.id,
    ids,
    'duplicate or missing signal id',
  );
  if (!signal.label)
    errors.push({ path, severity: 'error', message: 'missing label' });
  if (!signal.sourceUrl || !signal.collectedAt)
    errors.push({
      path,
      severity: 'error',
      message: 'missing provenance (sourceUrl/collectedAt)',
    });
  checkIsoTimestamp(errors, path, 'collectedAt', signal.collectedAt);
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
