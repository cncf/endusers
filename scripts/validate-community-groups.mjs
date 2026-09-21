#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { collectError, reportAndExit } from './lib/validate-utils.mjs';

const data = JSON.parse(
  readFileSync(new URL('../data/community-groups.json', import.meta.url)),
);
const errors = [];

if (Number.isNaN(Date.parse(data.checkedAt))) {
  collectError(
    errors,
    'community-groups.json',
    'error',
    'checkedAt must be ISO 8601',
  );
} else if (new Date(data.checkedAt).getTime() > Date.now() + 60_000) {
  collectError(
    errors,
    'community-groups.json',
    'error',
    'checkedAt cannot be in the future',
  );
}

if (!Array.isArray(data.groups) || data.groups.length === 0) {
  collectError(
    errors,
    'community-groups.json',
    'error',
    'groups must be a non-empty array',
  );
}

const slugs = new Set();
for (const group of data.groups || []) {
  const label = group.slug || group.name || 'unknown group';
  if (!group.slug || !group.name || !group.repository) {
    collectError(
      errors,
      label,
      'error',
      'group requires slug, name, and repository',
    );
  }
  if (group.slug) {
    if (slugs.has(group.slug))
      collectError(errors, label, 'error', 'duplicate slug');
    slugs.add(group.slug);
  }
  try {
    if (group.repository) new URL(group.repository);
  } catch {
    collectError(errors, label, 'error', 'repository must be an absolute URL');
  }
  // A group whose upstream repo is archived or unreachable still renders on
  // the docs page today; surface it loudly but do not fail the build over an
  // upstream-owned lifecycle decision this repo does not control.
  if (group.archived === true) {
    collectError(
      errors,
      label,
      'warn',
      'upstream repository is archived; verify the group is still active',
    );
  }
  if (group.reachable === false) {
    collectError(
      errors,
      label,
      'warn',
      'upstream repository could not be found (renamed or deleted?)',
    );
  }
}

// Stale-repo-status TODO(#122): refresh-community-people.yml is the only
// workflow that re-runs check-community-group-links.mjs, and it cannot open
// a PR while #122 (repo Action permissions) is unresolved, so checkedAt will
// keep aging until that is fixed. Warn rather than fail so this data source
// joining community-people.json's staleness class does not add a second
// permanently-red build gate.
const ageDays = (Date.now() - new Date(data.checkedAt).getTime()) / 86_400_000;
const STALENESS_WARN_DAYS = 60;
if (Number.isFinite(ageDays) && ageDays > STALENESS_WARN_DAYS) {
  collectError(
    errors,
    'community-groups.json',
    'warn',
    `checkedAt is ${Math.round(ageDays)} days old, exceeding the ${STALENESS_WARN_DAYS}-day check interval`,
  );
}

reportAndExit(errors, 'community groups');
console.log(`Validated ${data.groups.length} End User Group links`);
