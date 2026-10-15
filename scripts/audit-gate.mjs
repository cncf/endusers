#!/usr/bin/env node
// Fails CI when `npm audit` reports a high or critical advisory that is not
// explicitly allowlisted.
//
// A plain `npm audit --audit-level=high` cannot be a gate here: the lockfile
// carries one unfixable high advisory (see SECURITY.md, "Known unpatched
// dependency advisories"), so the naive gate would be permanently red and
// train everyone to ignore it. This script instead allowlists exactly the
// advisories SECURITY.md documents as unpatched upstream, and exits 1 the
// moment any *other* high or critical advisory lands in the lockfile.
//
// npm's JSON report lists one entry per affected package. Each entry's `via`
// array mixes direct advisories (objects carrying the GHSA URL) with the
// names of other vulnerable packages the entry merely inherits from. An
// entry is acceptable only when every advisory reachable through its `via`
// chain is allowlisted; a single new advisory therefore blocks the whole
// chain it poisons, however deeply it bubbles.
//
// Usage: node scripts/audit-gate.mjs  (CI: `npm run check:audit`)

import { spawnSync } from 'node:child_process';

// Advisories npm cannot fix because no patched release exists. Every entry
// must correspond to a row in SECURITY.md's "Known unpatched dependency
// advisories" table; remove the entry the moment upstream publishes a fix
// (for braces: when `npm view braces versions` lists a release above 3.0.3),
// so the gate starts enforcing it. unusedAllowlistEntries() below fails the
// gate once an entry stops matching anything in the lockfile, and
// fixableAllowlistedAdvisories() fails it once npm reports a fix while the
// advisory is still present, so that removal is prompted rather than left to
// be noticed.
export const ALLOWLISTED_ADVISORIES = new Set([
  // braces <= 3.0.3 via micromatch in @docusaurus/utils globbing; build-time
  // only, never shipped to the published site.
  'GHSA-vfj7-8cjw-p6xm',
]);

// `npm audit --audit-level=high` semantics: moderate and low findings are
// reported but do not gate the merge.
const GATED_SEVERITIES = new Set(['high', 'critical']);

// Names a `via` advisory object by its GHSA id so it can be matched against
// the allowlist. The id lives in the advisory URL; when npm ever reports an
// advisory without one, the fallback label can never match the allowlist, so
// an unidentifiable advisory fails closed rather than slipping through.
export function advisoryId(via) {
  const match = /GHSA(?:-[0-9a-z]{4}){3}/.exec(String(via.url ?? ''));
  return match ? match[0] : `advisory:${via.source ?? 'unknown'}`;
}

// Partitions the gated (high/critical) entries of an npm audit report into
// `blocked` (reaches at least one non-allowlisted advisory) and
// `allowlisted` (every reachable advisory is allowlisted). Each blocked
// entry carries the offending advisory ids so the CI log names what to fix.
export function classifyAudit(report, allowlist = ALLOWLISTED_ADVISORIES) {
  const vulnerabilities = report.vulnerabilities ?? {};

  // Collects the non-allowlisted advisory ids reachable from a package's
  // `via` chain. `trail` breaks the cycles npm emits when two packages each
  // list the other as their vulnerability source. The walk is repeated from
  // scratch for every top-level package rather than memoized: a result
  // computed while a cycle is open is only valid for that walk (the cycle
  // member re-entered from outside can reach advisories the truncated inner
  // walk could not), and audit reports are small enough that the repeated
  // walk costs nothing.
  function blockingAdvisories(name, trail) {
    if (trail.has(name)) return new Set();
    const entry = vulnerabilities[name];
    if (!entry) return new Set();
    trail.add(name);
    const found = new Set();
    for (const via of entry.via ?? []) {
      if (typeof via === 'string') {
        for (const id of blockingAdvisories(via, trail)) found.add(id);
      } else {
        const id = advisoryId(via);
        if (!allowlist.has(id)) found.add(id);
      }
    }
    return found;
  }

  const blocked = [];
  const allowlisted = [];
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (!GATED_SEVERITIES.has(entry.severity)) continue;
    const advisories = blockingAdvisories(name, new Set());
    if (advisories.size > 0) {
      blocked.push({
        name,
        severity: entry.severity,
        advisories: [...advisories].sort(),
      });
    } else {
      allowlisted.push(name);
    }
  }
  return { blocked, allowlisted };
}

// Collects every advisory id the report mentions, at any severity and at any
// depth of the `via` chains. Severity is deliberately not filtered: an
// advisory that is rescored from high to moderate is still present in the
// lockfile, and an allowlist entry covering it is still doing work.
function reportedAdvisoryIds(report) {
  const ids = new Set();
  for (const entry of Object.values(report.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== 'string') ids.add(advisoryId(via));
    }
  }
  return ids;
}

// Reports allowlist entries that no advisory in the report reaches.
//
// Every entry here suppresses a high/critical finding on the stated premise
// that no patched release exists. Nothing re-tests that premise: once the
// advisory leaves the lockfile -- because upstream published a fix, or the
// dependency was dropped -- the entry becomes a standing suppression for a
// problem that is now fixable, and the gate goes on accepting the advisory if
// a later dependency change reintroduces it. Since nothing but this check
// would ever notice, an unused entry fails the gate the same way an
// unidentifiable advisory does, so removing it (and its SECURITY.md row) is
// forced at the moment the reason for it expires rather than whenever someone
// next happens to re-read the allowlist.
export function unusedAllowlistEntries(
  report,
  allowlist = ALLOWLISTED_ADVISORIES,
) {
  const reported = reportedAdvisoryIds(report);
  return [...allowlist].filter((id) => !reported.has(id)).sort();
}

// Reports allowlist entries whose advisory is still in the lockfile but which
// npm now says it can fix.
//
// Every entry in ALLOWLISTED_ADVISORIES rests on one premise: no patched
// release exists, so the gate would be permanently red without the
// suppression. unusedAllowlistEntries() above only notices when the advisory
// *leaves* the lockfile. The far more likely expiry is the other one --
// upstream publishes a fix and the project has not upgraded yet. The advisory
// stays in the report, the entry stays "used", and the suppression silently
// outlives its reason: a high/critical finding this project could fix today
// goes on passing the gate, and nothing but someone re-reading the comment and
// running `npm view <pkg> versions` by hand would ever catch it.
//
// npm already answers the question. Each report entry carries `fixAvailable`:
// `false` when no reachable upgrade resolves it, and otherwise `true` or an
// object naming the release to move to (which may be a semver-major bump, so
// the fix can need a human decision -- hence a gate failure that asks for one,
// not an automatic upgrade). Only the entry that carries the advisory object
// directly is consulted; a package that merely inherits the advisory through
// its `via` chain reports the fix for its own dependency tree, not for the
// advisory itself.
//
// @returns {Array<{id: string, package: string, fixAvailable: unknown}>}
export function fixableAllowlistedAdvisories(
  report,
  allowlist = ALLOWLISTED_ADVISORIES,
) {
  const fixable = [];
  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    if (!entry.fixAvailable) continue;
    for (const via of entry.via ?? []) {
      if (typeof via === 'string') continue;
      const id = advisoryId(via);
      if (allowlist.has(id)) {
        fixable.push({ id, package: name, fixAvailable: entry.fixAvailable });
      }
    }
  }
  return fixable.sort(
    (a, b) => a.id.localeCompare(b.id) || a.package.localeCompare(b.package),
  );
}

// Renders npm's `fixAvailable` value as a short phrase for the CI log.
// Exported for the unit tests; main() is its only production caller.
export function describeFix(fixAvailable) {
  if (fixAvailable && typeof fixAvailable === 'object') {
    const target = [fixAvailable.name, fixAvailable.version]
      .filter(Boolean)
      .join('@');
    const major = fixAvailable.isSemVerMajor ? ', semver-major' : '';
    return target ? `upgrade to ${target}${major}` : `a fix is available`;
  }
  return 'a fix is available';
}

function main() {
  // --package-lock-only audits the lockfile without needing node_modules,
  // which is also what keeps the result identical between a fresh CI
  // checkout and a developer tree. npm exits non-zero whenever any
  // vulnerability exists (including the allowlisted ones), so a non-zero
  // exit on its own cannot mean failure; the report's shape is what
  // separates a completed audit from one that never ran.
  const result = spawnSync('npm', ['audit', '--package-lock-only', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    console.error(`audit-gate: failed to run npm audit: ${result.error}`);
    process.exit(1);
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error('audit-gate: npm audit did not produce parseable JSON:');
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }

  // A successful `npm audit --json` always carries a `vulnerabilities` object
  // (empty on a clean tree). When the audit cannot run — registry outage,
  // proxy error, rate limit — npm still prints parseable JSON, but an error
  // document with no such key. Judging that as "no vulnerabilities" would turn
  // every audit outage into a silent pass, so anything that is not a report
  // fails the gate instead.
  if (
    !report ||
    typeof report.vulnerabilities !== 'object' ||
    report.vulnerabilities === null
  ) {
    console.error(
      'audit-gate: npm audit did not return a report (exit code ' +
        `${result.status}); refusing to treat that as a clean audit:`,
    );
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }

  const { blocked, allowlisted } = classifyAudit(report);
  if (blocked.length > 0) {
    console.error(
      'audit-gate: high/critical advisories outside the allowlist:',
    );
    for (const entry of blocked) {
      console.error(
        `  ${entry.name} (${entry.severity}): ${entry.advisories.join(', ')}`,
      );
    }
    console.error(
      'Fix the advisory (upgrade or add an override, see SECURITY.md), or — ' +
        'only for an advisory with no patched release — document it in ' +
        'SECURITY.md and allowlist it in scripts/audit-gate.mjs.',
    );
    process.exit(1);
  }
  // Reported after the blocked check: a live advisory outside the allowlist is
  // the more urgent signal, and naming a dead exemption first would bury it.
  const unused = unusedAllowlistEntries(report);
  if (unused.length > 0) {
    console.error(
      'audit-gate: allowlisted advisories no longer present in the lockfile:',
    );
    for (const id of unused) console.error(`  ${id}`);
    console.error(
      'The advisory is fixed or the dependency is gone, so the allowlist ' +
        'entry now suppresses nothing and would silently accept the advisory ' +
        'if it came back. Remove it from ALLOWLISTED_ADVISORIES in ' +
        "scripts/audit-gate.mjs and drop its row from SECURITY.md's " +
        '"Known unpatched dependency advisories" table.',
    );
    process.exit(1);
  }
  // Reported last: the two checks above describe advisories the gate is
  // currently letting through, while this one describes a suppression whose
  // stated reason ("no patched release exists") npm now contradicts.
  const fixable = fixableAllowlistedAdvisories(report);
  if (fixable.length > 0) {
    console.error(
      'audit-gate: allowlisted advisories npm now reports as fixable:',
    );
    for (const item of fixable) {
      console.error(
        `  ${item.id} via ${item.package}: ${describeFix(item.fixAvailable)}`,
      );
    }
    console.error(
      'Each allowlist entry exists only because no patched release existed. ' +
        'npm now says one does, so the entry is suppressing a finding this ' +
        'project can fix. Take the upgrade (it may be semver-major and need ' +
        'a deliberate decision), then remove the advisory from ' +
        'ALLOWLISTED_ADVISORIES in scripts/audit-gate.mjs and drop its row ' +
        'from SECURITY.md\'s "Known unpatched dependency advisories" table.',
    );
    process.exit(1);
  }
  console.log(
    `audit-gate: ok — ${allowlisted.length} high/critical finding(s), all ` +
      'tracing to allowlisted advisories documented in SECURITY.md',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
