#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { reportAndExit } from './lib/validate-utils.mjs';

// data/radar-reports.json is regenerated from the cncf.io WordPress REST API by
// scripts/collect-radar-reports.mjs, which copies each post's `link` through
// verbatim, and src/components/RadarReports renders every one of them as an
// <a href> — the sourceUrl link under the hard-coded anchor text
// "cncf.io/reports", so its real destination is never visible. A scheme prefix
// test is not a gate: it accepts any host, and it accepts a userinfo component
// ("https://www.cncf.io@evil.example/") that resolves to a hostile host while
// reading as CNCF to a maintainer skimming a generated JSON diff. Parse the URL
// and hold the host to an allow-list, the same standard
// scripts/validate-case-studies.mjs already applies to the sibling feed.
const ALLOWED_HOST_SUFFIXES = ['cncf.io'];

function publishableUrl(value) {
  if (typeof value !== 'string') return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const allowed = ALLOWED_HOST_SUFFIXES.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  return allowed ? url : null;
}

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
if (!data.sourceUrl || !publishableUrl(data.sourceUrl))
  errors.push({
    path: 'radar-reports.json',
    severity: 'error',
    message: `sourceUrl must be an https URL, with no userinfo, on ${ALLOWED_HOST_SUFFIXES.join(' or ')}`,
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
  if (!entry.url || !publishableUrl(entry.url))
    errors.push({
      path: String(id),
      severity: 'error',
      message: `url must be an https URL, with no userinfo, on ${ALLOWED_HOST_SUFFIXES.join(' or ')}: ${JSON.stringify(entry.url)}`,
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
