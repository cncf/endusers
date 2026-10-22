#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { checkDuplicateValue } from './lib/duplicate-check.mjs';
import {
  checkNonEmptyArray,
  checkNonEmptyString,
  checkUrl as checkUrlImpl,
  reportAndExit,
} from './lib/validate-utils.mjs';

// data/projects-born.json is hand-maintained, and src/components/ProjectsBorn
// renders every entry's `url` as an <a href>. That component is mounted in
// src/theme/Footer, so these links ship on every page of the site rather than
// on one section of the homepage.
//
// It was the only data file feeding an <a href> with no validator behind it,
// which left a maintainer skimming a JSON diff as the sole gate. A scheme
// prefix test would not be one either: /^https:\/\// accepts
// "https://www.cncf.io@evil.example/", whose visible prefix and real host
// disagree, and accepts unparseable values such as "https://". checkUrl() in
// ./lib/validate-utils.mjs is the shared gate for this check.
//
// No host allow-list: these are legitimately third-party project sites
// (envoyproxy.io, jaegertracing.io, backstage.io), unlike the cncf.io feeds
// guarded by validate-radar-reports.mjs and validate-case-studies.mjs.
//
// Entries are kept in alphabetical order by name. The component renders the
// file in corpus order, so the order a reader sees is the order here; the
// check below turns an entry appended at the end into a failing validation
// rather than a list that is almost sorted.

const REQUIRED_TEXT_FIELDS = ['name', 'origin', 'description'];

function checkUrl(errors, path, value) {
  checkUrlImpl(errors, path, 'url', value, {
    requireNonEmptyString: true,
    unparsedMessage: `url must be an absolute https URL: ${JSON.stringify(value)}`,
  });
}

const data = JSON.parse(
  readFileSync(new URL('../data/projects-born.json', import.meta.url)),
);
const errors = [];

checkNonEmptyArray(errors, 'projects-born.json', 'projects-born.json', data);

const names = new Set();
let previousName;
for (const entry of Array.isArray(data) ? data : []) {
  const path = typeof entry?.name === 'string' ? entry.name : 'unknown';

  for (const field of REQUIRED_TEXT_FIELDS) {
    checkNonEmptyString(errors, path, field, entry?.[field]);
  }

  if (typeof entry?.name === 'string') {
    checkDuplicateValue(errors, path, entry.name, names, 'duplicate name');
  } else {
    names.add(entry?.name);
  }

  if (
    typeof entry?.name === 'string' &&
    typeof previousName === 'string' &&
    entry.name.localeCompare(previousName, 'en', { sensitivity: 'base' }) < 0
  ) {
    errors.push({
      path,
      severity: 'error',
      message: `out of alphabetical order: "${entry.name}" must come before "${previousName}"`,
    });
  }
  if (typeof entry?.name === 'string') previousName = entry.name;

  checkUrl(errors, path, entry?.url);
}

reportAndExit(errors, 'projects born');
console.log(`Validated ${data.length} born projects`);
