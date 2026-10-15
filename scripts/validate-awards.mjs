#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CNCF_HOST_SUFFIXES,
  checkNonEmptyArray,
  checkParseableDate,
  checkUrl,
  reportAndExit,
} from './lib/validate-utils.mjs';

const staticRoot = fileURLToPath(new URL('../static/', import.meta.url));
const awardsLogoRoot = join(staticRoot, 'img', 'awards') + sep;
const data = JSON.parse(
  readFileSync(new URL('../data/awards.json', import.meta.url)),
);
const errors = [];

// The award link fields are rendered as <a href> on /awards and in the member
// directory, so they are resolved through the URL parser rather than a string
// prefix test: `/^https:\/\//` accepts "https://cncf.io@evil.example", whose
// visible prefix and real host disagree, and accepts unparseable values such
// as "https://". checkUrl() in ./lib/validate-utils.mjs is the shared gate;
// isHttpsUrl() in validate-architectures.mjs and websiteUrl() in
// src/lib/profile-links.mjs serve different callers (a boolean predicate and
// a runtime client-side normalizer) and are not folded in here.
//
// Beyond parsing, every rendered link is held to a host allow-list, the same
// standard scripts/validate-case-studies.mjs and validate-radar-reports.mjs
// apply to the cncf.io feeds they mirror. Winners are verified against their
// cncf.io announcement (AGENTS.md), so announcementUrl and caseStudyUrl must
// resolve on a CNCF host; talkUrl may also point at the recording's YouTube
// host. verifiedAgainst names the award history source, a CNCF property.
const LINK_HOST_SUFFIXES = {
  announcementUrl: CNCF_HOST_SUFFIXES,
  caseStudyUrl: CNCF_HOST_SUFFIXES,
  talkUrl: [...CNCF_HOST_SUFFIXES, 'youtube.com', 'youtu.be'],
};

checkParseableDate(
  errors,
  'awards.json',
  'verifiedAt',
  data.verifiedAt,
  'recording the last completeness audit against verifiedAgainst',
);
if (!data.verifiedAgainst)
  errors.push({
    path: 'awards.json',
    severity: 'error',
    message:
      'verifiedAgainst must be an https URL to the canonical award history source',
  });
else
  checkUrl(errors, 'awards.json', 'verifiedAgainst', data.verifiedAgainst, {
    allowedHostSuffixes: CNCF_HOST_SUFFIXES,
  });
checkNonEmptyArray(errors, 'awards.json', 'awards', data.awards);
let lastYear = Infinity;
for (const entry of Array.isArray(data.awards) ? data.awards : []) {
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
  for (const [field, allowedHostSuffixes] of Object.entries(
    LINK_HOST_SUFFIXES,
  )) {
    if (entry[field])
      checkUrl(errors, id, field, entry[field], { allowedHostSuffixes });
  }
  if (entry.logo) {
    if (typeof entry.logo !== 'string') {
      errors.push({
        path: id,
        severity: 'error',
        message: 'logo must be a string path under /img/awards/',
      });
    } else {
      // Resolve before checking containment: a raw prefix test alone is
      // defeated by '..' segments, which path resolution normalises away.
      const file = resolve(staticRoot, `.${entry.logo}`);
      if (
        !entry.logo.startsWith('/img/awards/') ||
        !file.startsWith(awardsLogoRoot)
      )
        errors.push({
          path: id,
          severity: 'error',
          message: 'logo must live under /img/awards/',
        });
      else if (!existsSync(file))
        errors.push({
          path: id,
          severity: 'error',
          message: `logo file missing: ${entry.logo}`,
        });
    }
  }
}
reportAndExit(errors, 'awards');
console.log(`Validated ${data.awards.length} award entries`);
