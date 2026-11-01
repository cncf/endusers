// The register binding: `ALLOWLISTED_ADVISORIES` in scripts/audit-gate.mjs
// and the "Known unpatched dependency advisories" table in SECURITY.md must
// describe the same set of suppressions, and the "Accepted moderate-risk
// advisories" table must name the vulnerable versions package-lock.json holds.
// These checks read authored documents and the lockfile and nothing else, so
// they are cheap enough to run on the document-only CI path
// (.github/workflows/ci.yml, "Check content contracts") -- SECURITY.md is an
// authored root document, so a pull request that edits only that file is
// classified document-only and skips both `npm run check:audit` and the
// audit-gate CLI suite. They live here rather than in tests/audit-gate.test.mjs
// because that file's CLI arms spend ~40s on retry and deadline timing.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ALLOWLISTED_ADVISORIES } from '../scripts/audit-gate.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('the allowlist matches the advisories SECURITY.md documents', () => {
  // The gate's exemptions and the human-readable security posture must not
  // drift apart: every allowlisted id has to be documented where a reader
  // will look for it.
  const securityMd = readFileSync(join(repoRoot, 'SECURITY.md'), 'utf8');
  for (const id of ALLOWLISTED_ADVISORIES) {
    assert.ok(
      securityMd.includes(id),
      `${id} is allowlisted in audit-gate.mjs but not documented in SECURITY.md`,
    );
  }
});

// Reads the GHSA ids that have a row in SECURITY.md's "Known unpatched
// dependency advisories" table.
//
// The table is the documented register of suppressions; the prose around it
// also names advisories, but for the opposite reason -- the paragraph on
// GHSA-ch52-4w7c-c8xp is there to record that the entry was *removed* once
// upstream shipped a fix. A substring search over the whole file cannot tell
// those two kinds of mention apart, so the parity checks below read rows.
function documentedAdvisoryIds(securityMd) {
  const heading = '## Known unpatched dependency advisories';
  const start = securityMd.indexOf(heading);
  assert.notEqual(
    start,
    -1,
    `SECURITY.md no longer has a "${heading}" section; audit-gate.mjs tells ` +
      'contributors to document allowlist entries there',
  );
  // The section runs to the next top-level heading; the appended sentinel
  // makes "ends at EOF" the same case rather than a branch that only the end
  // of the file could ever take.
  const rest = `${securityMd.slice(start + heading.length)}\n## `;
  const section = rest.slice(0, rest.search(/^## /m));
  return new Set(
    [...section.matchAll(/^\|\s*\[?(GHSA(?:-[0-9a-z]{4}){3})\)?\]?/gm)].map(
      (match) => match[1],
    ),
  );
}

test('every allowlisted advisory has a row in the SECURITY.md table', () => {
  // Stronger than the substring check above, which a retired advisory can
  // satisfy from the paragraph that says it is gone: re-adding
  // GHSA-ch52-4w7c-c8xp to ALLOWLISTED_ADVISORIES would pass `includes()`
  // while leaving the table -- the part a reader audits -- silent about it.
  const securityMd = readFileSync(join(repoRoot, 'SECURITY.md'), 'utf8');
  const documented = documentedAdvisoryIds(securityMd);
  for (const id of ALLOWLISTED_ADVISORIES) {
    assert.ok(
      documented.has(id),
      `${id} is allowlisted in audit-gate.mjs but has no row in SECURITY.md's ` +
        '"Known unpatched dependency advisories" table (a mention elsewhere ' +
        'in the file is not the register the gate points readers at)',
    );
  }
});

test('every advisory in the SECURITY.md table is still allowlisted', () => {
  // The other direction. A row here asserts that the gate is suppressing the
  // advisory because nothing upstream fixes it. Once the allowlist entry goes
  // away -- the fix lands, or the dependency is dropped -- an orphaned row
  // documents a suppression that no longer exists, and the next reader
  // auditing the posture is told the gate accepts an advisory it would in
  // fact block. unusedAllowlistEntries() forces the allowlist side of that
  // removal; nothing forced the table side.
  const securityMd = readFileSync(join(repoRoot, 'SECURITY.md'), 'utf8');
  for (const id of documentedAdvisoryIds(securityMd)) {
    assert.ok(
      ALLOWLISTED_ADVISORIES.has(id),
      `${id} has a row in SECURITY.md's "Known unpatched dependency ` +
        'advisories" table but is not in ALLOWLISTED_ADVISORIES in ' +
        'scripts/audit-gate.mjs; drop the row, or restore the entry',
    );
  }
});

// Reads accepted moderate-risk rows as {advisory, package, installed} records.
function acceptedModerateRows(securityMd) {
  const heading = '## Accepted moderate-risk advisories';
  const start = securityMd.indexOf(heading);
  assert.notEqual(
    start,
    -1,
    `SECURITY.md no longer has a "${heading}" section; the moderate ` +
      'acceptances it records are what the check below binds to the lockfile',
  );
  const rest = `${securityMd.slice(start + heading.length)}\n## `;
  const section = rest.slice(0, rest.search(/^## /m));
  const rows = [];
  for (const line of section.split('\n')) {
    const match = line.match(
      /^\|\s*\[(GHSA(?:-[0-9a-z]{4}){3})\]\([^)]*\)\s*\|\s*`([^`]+)`\s*\|([^|]*)\|/,
    );
    if (!match) continue;
    rows.push({
      advisory: match[1],
      package: match[2],
      installed: new Set(match[3].split(',').map((version) => version.trim())),
    });
  }
  return rows;
}

// GitHub Advisory Database lists GHSA-g3hv-75wg-m249 as vulnerable below 11.0.1.
const MODERATE_ADVISORY_RULES = new Map([
  ['GHSA-g3hv-75wg-m249', { package: 'minimatch', patchedVersion: '11.0.1' }],
]);

function compareVersions(left, right) {
  const parse = (version) => {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
    assert.ok(
      match,
      `Expected a three-part numeric package version, got ${version}`,
    );
    return match.slice(1).map(Number);
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function lockfileVersions(lockfile, name) {
  const versions = new Set();
  for (const [path, meta] of Object.entries(lockfile.packages ?? {})) {
    if (path.split('node_modules/').pop() !== name) continue;
    versions.add(meta.version);
  }
  return versions;
}

function assertModerateRegisterMatchesLockfile(rows, lockfile) {
  for (const row of rows) {
    const rule = MODERATE_ADVISORY_RULES.get(row.advisory);
    assert.ok(
      rule,
      `${row.advisory} has no vulnerable-version rule in ` +
        'MODERATE_ADVISORY_RULES; add the advisory range before accepting it',
    );
    assert.equal(
      row.package,
      rule.package,
      `${row.advisory} is registered for ${row.package}, not ${rule.package}`,
    );
    const actual = lockfileVersions(lockfile, row.package);
    assert.ok(
      row.installed.size > 0,
      `the "${row.package}" row in SECURITY.md's "Accepted moderate-risk ` +
        'advisories" table states no installed version; list versions ' +
        'without copy counts, comma-separated',
    );
    for (const version of row.installed) {
      assert.ok(
        actual.has(version),
        `SECURITY.md names ${row.package}@${version} for ${row.advisory}, ` +
          'but that version is no longer installed; review or remove the row',
      );
      assert.ok(
        compareVersions(version, rule.patchedVersion) < 0,
        `SECURITY.md names ${row.package}@${version} for ${row.advisory}, ` +
          `but the advisory is patched in ${rule.patchedVersion}; review or ` +
          'remove the row',
      );
    }
    const unlistedVulnerable = [...actual].filter(
      (version) =>
        compareVersions(version, rule.patchedVersion) < 0 &&
        !row.installed.has(version),
    );
    assert.deepEqual(
      unlistedVulnerable,
      [],
      `SECURITY.md does not list vulnerable ${row.package} version(s) ` +
        `${unlistedVulnerable.join(', ')} for ${row.advisory}`,
    );
  }
  for (const [advisory, rule] of MODERATE_ADVISORY_RULES) {
    const vulnerableVersions = [
      ...lockfileVersions(lockfile, rule.package),
    ].filter((version) => compareVersions(version, rule.patchedVersion) < 0);
    if (vulnerableVersions.length === 0) continue;
    assert.ok(
      rows.some((row) => row.advisory === advisory),
      `SECURITY.md does not document ${advisory} for vulnerable ` +
        `${rule.package} version(s) ${vulnerableVersions.join(', ')}`,
    );
  }
}

test('accepted moderate advisories name installed vulnerable versions, not copy counts', () => {
  const securityMd = readFileSync(join(repoRoot, 'SECURITY.md'), 'utf8');
  const lockfile = JSON.parse(
    readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'),
  );
  assertModerateRegisterMatchesLockfile(
    acceptedModerateRows(securityMd),
    lockfile,
  );
});

test('moderate register ignores copy-count changes and patched versions', () => {
  const rows = [
    {
      advisory: 'GHSA-g3hv-75wg-m249',
      package: 'minimatch',
      installed: new Set(['3.1.5', '10.2.6']),
    },
  ];
  const lockfile = {
    packages: {
      'node_modules/minimatch': { version: '10.2.6' },
      'node_modules/a/node_modules/minimatch': { version: '3.1.5' },
      'node_modules/b/node_modules/minimatch': { version: '3.1.5' },
      'node_modules/glob/node_modules/minimatch': { version: '11.0.3' },
    },
  };
  assert.doesNotThrow(() =>
    assertModerateRegisterMatchesLockfile(rows, lockfile),
  );
});

test('moderate register rejects a named version no longer in the lockfile', () => {
  const rows = [
    {
      advisory: 'GHSA-g3hv-75wg-m249',
      package: 'minimatch',
      installed: new Set(['3.1.5', '10.2.6']),
    },
  ];
  const lockfile = {
    packages: {
      'node_modules/minimatch': { version: '10.2.6' },
    },
  };
  assert.throws(
    () => assertModerateRegisterMatchesLockfile(rows, lockfile),
    /names minimatch@3\.1\.5.*no longer installed/,
  );
});

test('moderate register rejects an unlisted vulnerable version', () => {
  const rows = [
    {
      advisory: 'GHSA-g3hv-75wg-m249',
      package: 'minimatch',
      installed: new Set(['3.1.5', '10.2.6']),
    },
  ];
  const lockfile = {
    packages: {
      'node_modules/old-consumer/node_modules/minimatch': { version: '3.1.5' },
      'node_modules/minimatch': { version: '10.2.6' },
      'node_modules/new-consumer/node_modules/minimatch': { version: '10.2.7' },
    },
  };
  assert.throws(
    () => assertModerateRegisterMatchesLockfile(rows, lockfile),
    /does not list vulnerable minimatch version\(s\) 10\.2\.7/,
  );
});

test('moderate register rejects a missing row for an installed vulnerability', () => {
  const lockfile = {
    packages: {
      'node_modules/minimatch': { version: '10.2.6' },
    },
  };
  assert.throws(
    () => assertModerateRegisterMatchesLockfile([], lockfile),
    /does not document GHSA-g3hv-75wg-m249.*10\.2\.6/,
  );
});

test('the SECURITY.md table is not empty while the allowlist has entries', () => {
  // Guards the parser itself. If the table were reformatted into a shape the
  // row regex no longer matches, both parity checks above would iterate over
  // nothing and pass vacuously, which is exactly the silent-pass failure mode
  // audit-gate.mjs refuses for an unreadable npm audit report.
  const securityMd = readFileSync(join(repoRoot, 'SECURITY.md'), 'utf8');
  const documented = documentedAdvisoryIds(securityMd);
  assert.equal(
    documented.size > 0,
    ALLOWLISTED_ADVISORIES.size > 0,
    'SECURITY.md\'s "Known unpatched dependency advisories" table parsed to ' +
      `${documented.size} advisory row(s) while audit-gate.mjs allowlists ` +
      `${ALLOWLISTED_ADVISORIES.size}; if the table was reformatted, update ` +
      'documentedAdvisoryIds() so the parity checks keep reading real rows',
  );
});
