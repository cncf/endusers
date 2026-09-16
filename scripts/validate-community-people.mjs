#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { reportAndExit } from './lib/validate-utils.mjs';

// Weekly refresh (refresh-community-people.yml runs every Monday). Allow a
// few missed cycles before failing the build loudly, but do not let stale
// TAB/staff data sit unnoticed indefinitely.
const MAX_AGE_DAYS = 45;

// TEMPORARY (see #122): refresh-community-people.yml cannot currently
// succeed at all — every scheduled run fails at the create-pull-request
// step because the repo-level "Allow GitHub Actions to create and approve
// pull requests" setting is disabled, which only a repo admin can flip.
// Since data is guaranteed to exceed MAX_AGE_DAYS through no fault of any
// individual PR/commit, hard-failing every deploy on staleness alone would
// just make the site un-deployable until an admin acts. Warn instead of
// erroring on staleness until #122 is closed, then flip this back to
// 'error' (or remove it, restoring the `else` branch's inherited severity).
const STALENESS_SEVERITY = 'warn'; // TODO(#122): change to 'error' once the refresh pipeline is green again

// Strict ISO 8601 (the subset actually emitted by Date#toISOString()):
// YYYY-MM-DDTHH:mm:ss.sssZ. Date.parse() alone is too permissive — it also
// accepts non-ISO formats like "March 1, 2026" — so validate the syntax
// explicitly before trusting the value.
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const data = JSON.parse(
  readFileSync(new URL('../data/community-people.json', import.meta.url)),
);
const roster = JSON.parse(
  readFileSync(new URL('../data/community-roster.json', import.meta.url)),
);
const errors = [];

if (!ISO_8601_UTC.test(data.fetchedAt ?? '')) {
  errors.push({
    path: 'community-people.json',
    severity: 'error',
    message: 'fetchedAt must be ISO 8601',
  });
} else if (Date.parse(data.fetchedAt) > Date.now()) {
  errors.push({
    path: 'community-people.json',
    severity: 'error',
    message: `fetchedAt (${data.fetchedAt}) is in the future`,
  });
} else {
  const ageMs = Date.now() - Date.parse(data.fetchedAt);
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays > MAX_AGE_DAYS) {
    errors.push({
      path: 'community-people.json',
      severity: STALENESS_SEVERITY,
      message: `fetchedAt is ${Math.floor(ageDays)} days old, exceeding the ${MAX_AGE_DAYS}-day staleness threshold. Run 'npm run fetch:community-people' or check refresh-community-people.yml (see #122 if it keeps failing).`,
    });
  }
}

const sections = ['tab', 'staff'];
for (const section of sections) {
  const entries = data.people?.[section];
  if (!Array.isArray(entries) || !entries.length) {
    errors.push({
      path: `people.${section}`,
      severity: 'error',
      message: `${section} must be a non-empty array`,
    });
    continue;
  }
  entries.forEach((person, index) => {
    const id = `people.${section}[${index}]`;
    if (!person.name)
      errors.push({ path: id, severity: 'error', message: 'missing name' });
    if (!person.image)
      errors.push({ path: id, severity: 'error', message: 'missing image' });
    if (!person.github && !person.linkedin && !person.twitter && !person.blog) {
      errors.push({
        path: id,
        severity: 'error',
        message: 'person needs at least one public profile link',
      });
    }
  });

  // Membership must match the authoritative roster member-for-member,
  // not merely be a non-empty array — otherwise a stale or
  // partially-generated file with the right shape but wrong/missing
  // people would still pass. Match by github handle (the stable identity
  // key); fall back to name only for the rare entry with no github.
  const rosterMembers = roster.sections?.[section] || [];
  const dataKeys = new Set(entries.map((p) => p.github || p.name));
  for (const { name, github } of rosterMembers) {
    const key = github || name;
    if (!dataKeys.has(key)) {
      errors.push({
        path: `people.${section}`,
        severity: 'error',
        message: `${name} is in the authoritative roster (data/community-roster.json) but missing from community-people.json`,
      });
    }
  }
  if (entries.length !== rosterMembers.length) {
    errors.push({
      path: `people.${section}`,
      severity: 'error',
      message: `community-people.json has ${entries.length} ${section} entries but the authoritative roster has ${rosterMembers.length}`,
    });
  }
}

reportAndExit(errors, 'community people');
console.log(
  `Validated ${(data.people?.tab?.length || 0) + (data.people?.staff?.length || 0)} community profiles`,
);
