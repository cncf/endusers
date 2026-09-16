#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reportAndExit } from './lib/validate-utils.mjs';
const data = JSON.parse(
  readFileSync(new URL('../data/awards.json', import.meta.url)),
);
const errors = [];
if (Number.isNaN(Date.parse(data.verifiedAt)))
  errors.push({
    path: 'awards.json',
    severity: 'error',
    message:
      'verifiedAt must be a parseable date recording the last completeness audit against verifiedAgainst',
  });
if (!data.verifiedAgainst || !/^https:\/\//.test(data.verifiedAgainst))
  errors.push({
    path: 'awards.json',
    severity: 'error',
    message:
      'verifiedAgainst must be an https URL to the canonical award history source',
  });
if (!Array.isArray(data.awards) || !data.awards.length)
  errors.push({
    path: 'awards.json',
    severity: 'error',
    message: 'awards must be a non-empty array',
  });
let lastYear = Infinity;
for (const entry of data.awards || []) {
  const id = `${entry.year}/${entry.slug}`;
  if (!Number.isInteger(entry.year) || entry.year < 2015)
    errors.push({ path: id, severity: 'error', message: 'invalid year' });
  if (entry.year > lastYear)
    errors.push({
      path: id,
      severity: 'error',
      message: 'awards must be sorted newest first',
    });
  lastYear = Math.max(entry.year, 2015);
  for (const field of [
    'award',
    'awardLabel',
    'organization',
    'slug',
    'citation',
    'event',
  ]) {
    if (!entry[field])
      errors.push({ path: id, severity: 'error', message: `missing ${field}` });
  }
  if (!entry.announcementUrl && !entry.talkUrl)
    errors.push({
      path: id,
      severity: 'error',
      message: 'entry needs an announcementUrl or talkUrl',
    });
  for (const field of ['announcementUrl', 'caseStudyUrl', 'talkUrl']) {
    if (entry[field] && !/^https:\/\//.test(entry[field]))
      errors.push({
        path: id,
        severity: 'error',
        message: `${field} must be https`,
      });
  }
  if (entry.logo) {
    if (!entry.logo.startsWith('/img/awards/'))
      errors.push({
        path: id,
        severity: 'error',
        message: 'logo must live under /img/awards/',
      });
    const file = fileURLToPath(
      new URL(`../static${entry.logo}`, import.meta.url),
    );
    if (!existsSync(file))
      errors.push({
        path: id,
        severity: 'error',
        message: `logo file missing: ${entry.logo}`,
      });
  }
}
reportAndExit(errors, 'awards');
console.log(`Validated ${data.awards.length} award entries`);
