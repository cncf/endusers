#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { reportAndExit } from './lib/validate-utils.mjs';

// data/projects-born.json is hand-maintained, and src/components/ProjectsBorn
// renders every entry's `url` as an <a href>. That component is mounted in
// src/theme/Footer, so these links ship on every page of the site rather than
// on one section of the homepage.
//
// It was the only data file feeding an <a href> with no validator behind it,
// which left a maintainer skimming a JSON diff as the sole gate. A scheme
// prefix test would not be one either: /^https:\/\// accepts
// "https://www.cncf.io@evil.example/", whose visible prefix and real host
// disagree, and accepts unparseable values such as "https://". Parse the URL
// instead, the same standard checkHttpsUrl() in validate-awards.mjs and
// checkUrl() in validate-metrics.mjs already apply.
//
// No host allow-list: these are legitimately third-party project sites
// (envoyproxy.io, jaegertracing.io, backstage.io), unlike the cncf.io feeds
// guarded by validate-radar-reports.mjs and validate-case-studies.mjs.

const REQUIRED_TEXT_FIELDS = ['name', 'origin', 'description'];

function checkUrl(errors, path, value) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push({
      path,
      severity: 'error',
      message: 'url must be a non-empty string',
    });
    return;
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    errors.push({
      path,
      severity: 'error',
      message: `url must be an absolute https URL: ${JSON.stringify(value)}`,
    });
    return;
  }

  if (parsed.protocol !== 'https:') {
    errors.push({
      path,
      severity: 'error',
      message: `url must use https, got ${parsed.protocol}`,
    });
    return;
  }

  if (parsed.username || parsed.password) {
    errors.push({
      path,
      severity: 'error',
      message: `url must not carry a userinfo component, which only disguises the real host (${parsed.hostname})`,
    });
  }
}

const data = JSON.parse(
  readFileSync(new URL('../data/projects-born.json', import.meta.url)),
);
const errors = [];

if (!Array.isArray(data) || !data.length) {
  errors.push({
    path: 'projects-born.json',
    severity: 'error',
    message: 'projects-born.json must be a non-empty array',
  });
}

const names = new Set();
for (const entry of Array.isArray(data) ? data : []) {
  const path = typeof entry?.name === 'string' ? entry.name : 'unknown';

  for (const field of REQUIRED_TEXT_FIELDS) {
    const value = entry?.[field];
    if (typeof value !== 'string' || !value.trim()) {
      errors.push({
        path,
        severity: 'error',
        message: `${field} must be a non-empty string`,
      });
    }
  }

  if (typeof entry?.name === 'string' && names.has(entry.name)) {
    errors.push({
      path,
      severity: 'error',
      message: 'duplicate name',
    });
  }
  names.add(entry?.name);

  checkUrl(errors, path, entry?.url);
}

reportAndExit(errors, 'projects born');
console.log(`Validated ${data.length} born projects`);
