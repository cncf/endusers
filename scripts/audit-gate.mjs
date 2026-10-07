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
// so the gate starts enforcing it.
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

function main() {
  // --package-lock-only audits the lockfile without needing node_modules,
  // which is also what keeps the result identical between a fresh CI
  // checkout and a developer tree. npm exits non-zero whenever any
  // vulnerability exists (including the allowlisted ones), so the exit code
  // is ignored and only the JSON report is judged.
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
  console.log(
    `audit-gate: ok — ${allowlisted.length} high/critical finding(s), all ` +
      'tracing to allowlisted advisories documented in SECURITY.md',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
