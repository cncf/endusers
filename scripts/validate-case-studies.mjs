#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { reportAndExit } from './lib/validate-utils.mjs';

const data = JSON.parse(
  readFileSync(new URL('../data/case-studies.json', import.meta.url)),
);
const errors = [];

if (Number.isNaN(Date.parse(data.generatedAt)))
  errors.push({
    path: 'case-studies.json',
    severity: 'error',
    message: 'generatedAt must be a parseable date',
  });
if (!data.sourceUrl || !/^https:\/\//.test(data.sourceUrl))
  errors.push({
    path: 'case-studies.json',
    severity: 'error',
    message: 'sourceUrl must be an https URL',
  });
if (!Array.isArray(data.caseStudies) || !data.caseStudies.length)
  errors.push({
    path: 'case-studies.json',
    severity: 'error',
    message: 'caseStudies must be a non-empty array',
  });

const ids = new Set();
const urls = new Set();
for (const entry of Array.isArray(data.caseStudies) ? data.caseStudies : []) {
  const id = entry.id ?? entry.slug ?? 'unknown';
  if (!entry.id || ids.has(entry.id))
    errors.push({
      path: String(id),
      severity: 'error',
      message: 'duplicate or missing id',
    });
  ids.add(entry.id);
  if (!entry.organization)
    errors.push({
      path: String(id),
      severity: 'error',
      message: 'missing organization',
    });
  if (!entry.url || !/^https:\/\//.test(entry.url) || urls.has(entry.url))
    errors.push({
      path: String(id),
      severity: 'error',
      message: 'missing or duplicate url',
    });
  urls.add(entry.url);
  if (!Array.isArray(entry.projects))
    errors.push({
      path: String(id),
      severity: 'error',
      message: 'projects must be an array',
    });
  if (!Array.isArray(entry.industries))
    errors.push({
      path: String(id),
      severity: 'error',
      message: 'industries must be an array',
    });
}

reportAndExit(errors, 'case studies');
console.log(`Validated ${data.caseStudies.length} case studies`);
