#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { collectError, reportAndExit } from './lib/validate-utils.mjs';

const data = JSON.parse(
  readFileSync(new URL('../data/community-groups.json', import.meta.url)),
);
const errors = [];

// The repository value is the upstream link for an End User Group and is one
// component change away from an <a href>. A bare `new URL()` parse accepts
// "javascript:alert(1)", "data:text/html,...", cleartext http, and a
// userinfo-spoofed authority such as "https://github.com@evil.example/x",
// whose visible prefix and real host disagree. Mirrors publishableUrl() in
// validate-case-studies.mjs and isCncfProjectHref() in
// lib/project-card-links.mjs. github.com is the only host
// check-community-group-links.mjs ever writes.
function publishableRepositoryUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  return url.hostname.toLowerCase() === 'github.com';
}

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
for (const group of Array.isArray(data.groups) ? data.groups : []) {
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
  if (group.repository && !publishableRepositoryUrl(group.repository)) {
    collectError(
      errors,
      label,
      'error',
      `repository must be an https github.com URL, with no userinfo: ${JSON.stringify(group.repository)}`,
    );
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
