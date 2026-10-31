// The register binding: `ALLOWLISTED_ADVISORIES` in scripts/audit-gate.mjs
// and the "Known unpatched dependency advisories" table in SECURITY.md must
// describe the same set of suppressions. These checks read two files and
// nothing else, so they are cheap enough to run on the document-only CI path
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
