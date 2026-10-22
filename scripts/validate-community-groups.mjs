#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { checkDuplicateValue } from './lib/duplicate-check.mjs';
import {
  checkIsoTimestamp,
  checkNonEmptyArray,
  collectError,
  isSafeUrl,
  reportAndExit,
} from './lib/validate-utils.mjs';

const data = JSON.parse(
  readFileSync(new URL('../data/community-groups.json', import.meta.url)),
);
const errors = [];

// The repository value is the upstream link for an End User Group and is one
// component change away from an <a href>. A bare `new URL()` parse accepts
// "javascript:alert(1)", "data:text/html,...", cleartext http, and a
// userinfo-spoofed authority such as "https://github.com@evil.example/x",
// whose visible prefix and real host disagree. isSafeUrl() in
// ./lib/validate-utils.mjs is the shared gate; it also backs publishableUrl()
// in validate-case-studies.mjs and isCncfProjectHref() in
// lib/project-card-links.mjs. github.com is the only host
// check-community-group-links.mjs ever writes.
function publishableRepositoryUrl(value) {
  const url = isSafeUrl(value);
  return Boolean(url) && url.hostname.toLowerCase() === 'github.com';
}

checkIsoTimestamp(
  errors,
  'community-groups.json',
  'generatedAt',
  data.generatedAt,
  { futureToleranceMs: 60_000 },
);

checkNonEmptyArray(errors, 'community-groups.json', 'groups', data.groups);

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
    checkDuplicateValue(errors, label, group.slug, slugs, 'duplicate slug');
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

reportAndExit(errors, 'community groups');
console.log(`Validated ${data.groups.length} End User Group links`);
