#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { reportAndExit } from './lib/validate-utils.mjs';

const data = JSON.parse(
  readFileSync(new URL('../data/radar-reports.json', import.meta.url)),
);
const errors = [];

if (Number.isNaN(Date.parse(data.generatedAt)))
  errors.push({
    path: 'radar-reports.json',
    severity: 'error',
    message: 'generatedAt must be a parseable date',
  });
if (!data.sourceUrl || !/^https:\/\//.test(data.sourceUrl))
  errors.push({
    path: 'radar-reports.json',
    severity: 'error',
    message: 'sourceUrl must be an https URL',
  });
if (!Array.isArray(data.radarReports) || !data.radarReports.length)
  errors.push({
    path: 'radar-reports.json',
    severity: 'error',
    message: 'radarReports must be a non-empty array',
  });

const ids = new Set();
for (const entry of Array.isArray(data.radarReports) ? data.radarReports : []) {
  const id = entry.id ?? entry.slug ?? 'unknown';
  if (!entry.id || ids.has(entry.id))
    errors.push({
      path: String(id),
      severity: 'error',
      message: 'duplicate or missing id',
    });
  ids.add(entry.id);
  if (!entry.title)
    errors.push({
      path: String(id),
      severity: 'error',
      message: 'missing title',
    });
  if (!entry.url || !/^https:\/\//.test(entry.url))
    errors.push({
      path: String(id),
      severity: 'error',
      message: 'missing url',
    });
  if (!entry.summary)
    errors.push({
      path: String(id),
      severity: 'error',
      message: 'missing summary',
    });
  if (entry.summary === 'Summary needed — see the report for details.')
    errors.push({
      path: String(id),
      severity: 'warn',
      message: 'summary is still the auto-generated placeholder',
    });
}

reportAndExit(errors, 'radar reports');
console.log(`Validated ${data.radarReports.length} radar reports`);
