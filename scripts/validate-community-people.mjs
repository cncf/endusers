#!/usr/bin/env node
// Validates data/community-people.json — the generated file behind the TAB
// and CNCF staff lightboxes on the community page. See CONTRIBUTING.md:
// never edit this file by hand, refresh it with `npm run fetch:community-people`.
import { readFileSync } from 'node:fs';
import { collectError, reportAndExit } from './lib/validate-utils.mjs';

const data = JSON.parse(
  readFileSync(new URL('../data/community-people.json', import.meta.url)),
);
const roster = JSON.parse(
  readFileSync(new URL('../data/community-roster.json', import.meta.url)),
);
const errors = [];

// Strict ISO 8601 only: plain Date.parse also accepts loose strings like
// "March 1, 2026", which would silently defeat the staleness check below.
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
if (!ISO_8601.test(data.fetchedAt ?? '')) {
  collectError(
    errors,
    'community-people.json',
    'error',
    'fetchedAt must be strict ISO 8601',
  );
} else if (new Date(data.fetchedAt).getTime() > Date.now() + 60_000) {
  collectError(
    errors,
    'community-people.json',
    'error',
    'fetchedAt cannot be in the future',
  );
}

// Member-for-member against the roster, matched by GitHub handle (falling
// back to name for the one member without one), so a stale or
// partially-generated file with the right shape but a missing/extra person
// fails loudly instead of only checking that the arrays are non-empty.
for (const [section, rosterEntries] of Object.entries(roster.sections || {})) {
  const generated = data.people?.[section] || [];
  const key = (person) => person.github || person.name;
  const rosterKeys = new Set(rosterEntries.map(key));
  const generatedKeys = new Set(generated.map(key));
  for (const entry of rosterEntries) {
    if (!generatedKeys.has(key(entry))) {
      collectError(
        errors,
        `people.${section}`,
        'error',
        `missing roster member ${entry.name}`,
      );
    }
  }
  for (const person of generated) {
    if (!rosterKeys.has(key(person))) {
      collectError(
        errors,
        `people.${section}`,
        'error',
        `${person.name} is not on the roster`,
      );
    }
    if (!person.name)
      collectError(errors, `people.${section}`, 'error', 'person missing name');
    if (!person.image)
      collectError(
        errors,
        `people.${section}`,
        'error',
        `${person.name || 'person'} missing image`,
      );
    if (!person.github && !person.linkedin && !person.twitter && !person.blog) {
      collectError(
        errors,
        `people.${section}`,
        'error',
        `${person.name || 'person'} has no public profile link`,
      );
    }
  }
}

// Stale-refresh TODO(#122): refresh-community-people.yml cannot open its PR
// while GitHub Actions is blocked from creating PRs in this repo (#122), so
// fetchedAt is frozen and will only get staler until that repo-level setting
// is flipped by an admin. Warn (not error) until then so this gate does not
// turn every deploy red for a pipeline this repo cannot currently fix; flip
// STALENESS_SEVERITY back to 'error' once #122 is resolved.
const STALENESS_SEVERITY = 'warn';
const STALENESS_DAYS = 45;
const ageDays = (Date.now() - new Date(data.fetchedAt).getTime()) / 86_400_000;
if (Number.isFinite(ageDays) && ageDays > STALENESS_DAYS) {
  collectError(
    errors,
    'community-people.json',
    STALENESS_SEVERITY,
    `fetchedAt is ${Math.round(ageDays)} days old, exceeding the ${STALENESS_DAYS}-day staleness threshold`,
  );
}

reportAndExit(errors, 'community people');
console.log(
  `Validated ${Object.values(data.people || {}).flat().length} community profiles`,
);
