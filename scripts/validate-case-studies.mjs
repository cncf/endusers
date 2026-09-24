#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { reportAndExit } from './lib/validate-utils.mjs';

// data/case-studies.json is regenerated from the cncf.io WordPress REST API by
// scripts/collect-case-studies.mjs, which copies each post's `link` through
// verbatim, and src/components/CaseStudies renders every one of them as an
// <a href> under a CNCF organization name. A scheme prefix test is not a gate:
// it accepts any host, and it accepts a userinfo component
// ("https://www.cncf.io@evil.example/") that resolves to a hostile host while
// reading as CNCF to a maintainer skimming a generated JSON diff. Parse the URL
// and hold the host to an allow-list, the same standard
// scripts/lib/profile-image.mjs already applies to profile images.
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
  readFileSync(new URL('../data/case-studies.json', import.meta.url)),
);
const errors = [];

if (Number.isNaN(Date.parse(data.generatedAt)))
  errors.push({
    path: 'case-studies.json',
    severity: 'error',
    message: 'generatedAt must be a parseable date',
  });
if (!data.sourceUrl || !publishableUrl(data.sourceUrl))
  errors.push({
    path: 'case-studies.json',
    severity: 'error',
    message: `sourceUrl must be an https URL, with no userinfo, on ${ALLOWED_HOST_SUFFIXES.join(' or ')}`,
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
  if (!entry.title)
    errors.push({
      path: String(id),
      severity: 'error',
      message: 'missing title',
    });
  if (!entry.url || urls.has(entry.url))
    errors.push({
      path: String(id),
      severity: 'error',
      message: 'missing or duplicate url',
    });
  else if (!publishableUrl(entry.url))
    errors.push({
      path: String(id),
      severity: 'error',
      message: `url must be an https URL, with no userinfo, on ${ALLOWED_HOST_SUFFIXES.join(' or ')}: ${JSON.stringify(entry.url)}`,
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
