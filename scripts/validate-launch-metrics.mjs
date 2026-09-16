#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { reportAndExit } from './lib/validate-utils.mjs';
import {
  buildTable,
  normalizeTable,
  START,
  END,
} from './lib/launch-metrics-table.mjs';

const data = JSON.parse(
  readFileSync(new URL('../data/launch-metrics.json', import.meta.url)),
);
const errors = [];

if (Number.isNaN(Date.parse(data.preLaunchCheckpointAt))) {
  errors.push({
    path: 'launch-metrics.json',
    severity: 'error',
    message: 'preLaunchCheckpointAt must be a valid date',
  });
}
if (!data.inboundLinkMeasurementProcedure) {
  errors.push({
    path: 'launch-metrics.json',
    severity: 'error',
    message:
      'inboundLinkMeasurementProcedure must describe a single, reproducible ' +
      'procedure for measuring inbound links, so the 90-day re-measurement ' +
      'uses the same method as the baseline',
  });
}
if (
  !Array.isArray(data.signals) ||
  data.signals.length < 3 ||
  data.signals.length > 5
) {
  errors.push({
    path: 'launch-metrics.json',
    severity: 'error',
    message: 'signals must contain between 3 and 5 entries',
  });
}

function isFiniteNonNegativeInt(value) {
  return Number.isInteger(value) && Number.isFinite(value) && value >= 0;
}

const ids = new Set();
for (const signal of data.signals || []) {
  if (!signal.id || ids.has(signal.id)) {
    errors.push({
      path: signal.id || '(missing id)',
      severity: 'error',
      message: 'duplicate or missing signal id',
    });
  }
  ids.add(signal.id);
  if (!signal.label)
    errors.push({
      path: signal.id,
      severity: 'error',
      message: 'missing label',
    });
  if (!signal.source)
    errors.push({
      path: signal.id,
      severity: 'error',
      message: 'missing source',
    });
  if (
    /castrojo\/endusers/.test(signal.source) ||
    /castrojo\/endusers/.test(signal.label)
  ) {
    errors.push({
      path: signal.id,
      severity: 'error',
      message:
        'source must use the canonical cncf/endusers URL, not the pre-transfer ' +
        'castrojo/endusers fork (put historical evidence in historicalSource instead)',
    });
  }
  if (!isFiniteNonNegativeInt(signal.baseline)) {
    errors.push({
      path: signal.id,
      severity: 'error',
      message: 'baseline must be a finite, non-negative integer',
    });
  }
  if (!isFiniteNonNegativeInt(signal.target90Day)) {
    errors.push({
      path: signal.id,
      severity: 'error',
      message: 'target90Day must be a finite, non-negative integer',
    });
  }
  if (
    isFiniteNonNegativeInt(signal.baseline) &&
    isFiniteNonNegativeInt(signal.target90Day) &&
    signal.target90Day < signal.baseline
  ) {
    errors.push({
      path: signal.id,
      severity: 'warn',
      message: 'target90Day is lower than baseline',
    });
  }
}

// The ROADMAP.md table must be generated from this JSON (see
// scripts/sync-launch-metrics-table.mjs), not hand-edited — otherwise the
// two silently drift apart. Recompute what the table SHOULD be and diff it
// against what's actually committed between the markers.
try {
  const roadmap = readFileSync(
    new URL('../ROADMAP.md', import.meta.url),
    'utf8',
  );
  const startIdx = roadmap.indexOf(START);
  const endIdx = roadmap.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    errors.push({
      path: 'ROADMAP.md',
      severity: 'error',
      message: `missing ${START} / ${END} markers around the launch-metrics table`,
    });
  } else {
    const actual = roadmap.slice(startIdx + START.length, endIdx).trim();
    const expected = buildTable(data).trim();
    if (normalizeTable(actual) !== normalizeTable(expected)) {
      errors.push({
        path: 'ROADMAP.md',
        severity: 'error',
        message:
          'launch-metrics table is out of sync with data/launch-metrics.json — ' +
          'run `npm run sync:launch-metrics-table` and commit the result',
      });
    }
  }
} catch (error) {
  errors.push({
    path: 'ROADMAP.md',
    severity: 'error',
    message: `could not read ROADMAP.md to verify table sync: ${error.message}`,
  });
}

reportAndExit(errors, 'launch metrics');
console.log(`Validated ${data.signals.length} launch success signals`);
