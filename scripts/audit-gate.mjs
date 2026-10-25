#!/usr/bin/env node
// Fails CI when `npm audit` reports a high or critical advisory that is not
// explicitly allowlisted.
//
// A plain `npm audit --audit-level=high` cannot be a gate here: whenever the
// lockfile carries an unfixable high advisory (see SECURITY.md, "Known
// unpatched dependency advisories"), the naive gate would be permanently red
// and train everyone to ignore it. This script instead allowlists exactly the
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
// Below that threshold the gate is narrower: a moderate or low advisory is
// tolerated while it is unfixable or needs a semver-major upgrade, but fails
// the gate as soon as npm can patch it in range, so `npm audit fix` (and the
// audit-fix workflow that runs it when this gate is red on main) is asked
// for rather than left until someone reads the report.
//
// Usage: node scripts/audit-gate.mjs  (CI: `npm run check:audit`)

import { spawnSync } from 'node:child_process';

// Advisories npm cannot fix because no patched release exists. Every entry
// must correspond to a row in SECURITY.md's "Known unpatched dependency
// advisories" table; remove the entry the moment upstream publishes a fix
// (check `npm view <package> versions` for a release outside the vulnerable
// range), so the gate starts enforcing it. unusedAllowlistEntries() below
// fails the gate once an entry stops matching anything in the lockfile, and
// fixableAllowlistedAdvisories() fails it once npm reports a fix while the
// advisory is still present, so that removal is prompted rather than left to
// be noticed.
//
// Empty as of 2026-10-23: the last entry, GHSA-vfj7-8cjw-p6xm against
// braces <= 3.0.3, was withdrawn upstream and npm audit stopped reporting it.
export const ALLOWLISTED_ADVISORIES = new Set([]);

// `npm audit --audit-level=high` semantics: moderate and low findings are
// reported but do not gate the merge on their own; see
// inRangeFixableAdvisories() for the one case where they do.
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

// Reports the below-threshold (moderate/low) advisories that npm can fix
// without a semver-major change.
//
// Gating only high and critical leaves a gap the overrides block has already
// fallen into once: an override floor such as `^7.0.3` keeps satisfying the
// lockfile after the advisory it was added for moves its patched release to
// 7.1.3, and a moderate or low advisory with a fix one `npm audit fix` away
// then sits under the threshold indefinitely, propagating through every
// package that depends on it. Nothing re-reads the report to notice.
//
// npm's `fixAvailable` already separates the two cases this gate should keep
// apart. `true`, or an object with `isSemVerMajor` false, means the fix is
// reachable within the ranges package.json (and its overrides) already
// declare, so `npm audit fix --package-lock-only` applies it and the
// audit-fix workflow does exactly that once this gate is red on main. `false`
// or a semver-major object means a human decision is needed, which the
// severity threshold deliberately defers; those are left alone here.
//
// Only the entry that carries the advisory object is reported, as in
// fixableAllowlistedAdvisories(): a package that merely inherits it through
// its `via` chain is fixed by the same lockfile move. Allowlisted advisories
// are excluded because fixableAllowlistedAdvisories() already reports them
// with the allowlist-specific instructions.
//
// @returns {Array<{name: string, severity: string, advisories: string[],
//   fixAvailable: unknown}>}
export function inRangeFixableAdvisories(
  report,
  allowlist = ALLOWLISTED_ADVISORIES,
) {
  const fixable = [];
  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    if (GATED_SEVERITIES.has(entry.severity)) continue;
    const fix = entry.fixAvailable;
    // `true.isSemVerMajor` is undefined, so a bare boolean fix passes too.
    if (!fix || fix.isSemVerMajor) continue;
    const advisories = (entry.via ?? [])
      .filter((via) => typeof via !== 'string')
      .map(advisoryId)
      .filter((id) => !allowlist.has(id))
      .sort();
    if (advisories.length === 0) continue;
    fixable.push({
      name,
      severity: entry.severity,
      advisories,
      fixAvailable: fix,
    });
  }
  return fixable.sort((a, b) => a.name.localeCompare(b.name));
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

// How many times an npm answer that carries no report is retried before the
// gate gives up. The registry is the one input to this check nobody here
// controls, and a single bad answer from it reds a required check on every
// open PR at once, so the gate asks again rather than reporting a repository
// problem that does not exist.
const AUDIT_ATTEMPTS = 3;
// Delay before each retry. Linear rather than exponential: npm-registry-fetch
// already backs off inside a single attempt, so this only has to outlast a
// momentary fault, not schedule around a long outage.
const AUDIT_RETRY_DELAY_MS = 2000;
// npm's request timeout does not bound its internal retries or fallback.
// Bound the subprocess too: three 60s attempts and two 2s sleeps budget
// approximately 184s, plus process launch and reporting overhead.
const AUDIT_FETCH_TIMEOUT_MS = 60000;

/**
 * Blocks the calling thread for `ms` milliseconds.
 *
 * The gate is a synchronous script whose only job is to pick an exit code, so
 * there is nothing to yield to; Atomics.wait sleeps without the CPU a spin
 * loop would burn.
 *
 * @param {number} ms how long to sleep
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs `npm audit` once.
 *
 * --package-lock-only audits the lockfile without needing node_modules, which
 * is also what keeps the result identical between a fresh CI checkout and a
 * developer tree. npm exits non-zero whenever any vulnerability exists
 * (including the allowlisted ones), so a non-zero exit on its own cannot mean
 * failure; the report's shape is what separates a completed audit from one
 * that never ran.
 *
 * A successful `npm audit --json` always carries a `vulnerabilities` object
 * (empty on a clean tree). When the audit cannot run — registry outage, proxy
 * error, rate limit — npm still prints parseable JSON, but an error document
 * with no such key. Judging that as "no vulnerabilities" would turn every
 * audit outage into a silent pass, so anything that is not a report is
 * reported here as an absent one and the caller fails the gate.
 *
 * @returns {{report: object|null, failure: string|null, output: string,
 *   status: number|null}} `failure` names the arm that produced no report, so
 *   the caller can keep the three causes apart in its diagnostic.
 */
function runAudit() {
  const result = spawnSync(
    'npm',
    [
      'audit',
      '--package-lock-only',
      '--json',
      `--fetch-timeout=${AUDIT_FETCH_TIMEOUT_MS}`,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: AUDIT_FETCH_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    },
  );
  if (result.error) {
    return {
      report: null,
      failure: 'spawn',
      output:
        result.error.code === 'ETIMEDOUT'
          ? `npm audit exceeded its ${AUDIT_FETCH_TIMEOUT_MS}ms subprocess deadline: ${result.error}`
          : String(result.error),
      status: result.status,
    };
  }
  const output = result.stderr || result.stdout;
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    return {
      report: null,
      failure: 'unparseable',
      output,
      status: result.status,
    };
  }
  if (
    !report ||
    typeof report.vulnerabilities !== 'object' ||
    report.vulnerabilities === null
  ) {
    return {
      report: null,
      failure: 'no-report',
      output,
      status: result.status,
    };
  }
  return { report, failure: null, output, status: result.status };
}

// The allowlist is a parameter so the unit tests can drive every arm of the
// gate whatever the shipped allowlist happens to contain; the CLI entry below
// always runs with ALLOWLISTED_ADVISORIES.
export function main(allowlist = ALLOWLISTED_ADVISORIES) {
  // Retries only the answers that carry no report. A parsed report is final
  // whatever it says: a genuinely new advisory must never be retried away.
  let last = runAudit();
  for (
    let attempt = 2;
    last.failure !== null && attempt <= AUDIT_ATTEMPTS;
    attempt += 1
  ) {
    console.error(
      `audit-gate: npm audit produced no report (${last.failure}); retrying ` +
        `(attempt ${attempt} of ${AUDIT_ATTEMPTS})`,
    );
    sleepSync(AUDIT_RETRY_DELAY_MS);
    last = runAudit();
  }
  if (last.failure === 'spawn') {
    console.error(`audit-gate: failed to run npm audit: ${last.output}`);
    process.exit(1);
  }
  if (last.failure === 'unparseable') {
    console.error('audit-gate: npm audit did not produce parseable JSON:');
    console.error(last.output);
    process.exit(1);
  }
  if (last.failure === 'no-report') {
    console.error(
      'audit-gate: npm audit did not return a report (exit code ' +
        `${last.status}) in ${AUDIT_ATTEMPTS} attempts; refusing to treat ` +
        'that as a clean audit:',
    );
    console.error(last.output);
    process.exit(1);
  }
  const report = last.report;

  const { blocked, allowlisted } = classifyAudit(report, allowlist);
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
  const unused = unusedAllowlistEntries(report, allowlist);
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
  const fixable = fixableAllowlistedAdvisories(report, allowlist);
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
  // Reported last of all: nothing above is letting an unknown advisory
  // through; this one names below-threshold findings whose fix is already
  // published and in range, so the remedy is mechanical.
  const inRange = inRangeFixableAdvisories(report, allowlist);
  if (inRange.length > 0) {
    console.error(
      'audit-gate: moderate/low advisories npm can fix within the declared ranges:',
    );
    for (const item of inRange) {
      console.error(
        `  ${item.name} (${item.severity}): ${item.advisories.join(', ')} — ` +
          describeFix(item.fixAvailable),
      );
    }
    console.error(
      'These sit below the high/critical threshold but have a patched ' +
        'release reachable without a semver-major change. Run ' +
        '`npm audit fix --package-lock-only` (raise the matching override ' +
        'floor in package.json if one pins the package) and commit the ' +
        'lockfile; on main the "Dependency audit fix" workflow opens that ' +
        'PR automatically.',
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
