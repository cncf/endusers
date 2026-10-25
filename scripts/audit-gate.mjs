#!/usr/bin/env node
// Fails CI when `npm audit` or OSV reports a high or critical advisory that is
// not explicitly allowlisted.
//
// Two data sources, one gate. `npm audit` is authoritative for everything the
// npm registry's advisory endpoint serves, but it is not the whole of the
// advisory record: the endpoint silently omits advisories it has no record
// for, and an omitted package is absent from `report.vulnerabilities`
// entirely rather than scored below the threshold. No severity setting can
// reach a finding that was never reported, so a second source is the only
// thing that can. GHSA-g84c-rxfj-3j2c (webpack-dev-middleware <= 7.4.5, path
// traversal, CVSS 7.4) was live in this lockfile while `npm audit` reported
// zero high and zero critical findings; OSV had it. The OSV arm below closes
// that blind spot without a second allowlist or a second CI step.
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
// Usage: node scripts/audit-gate.mjs  (CI: `npm run check:audit`)

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

// --- OSV cross-check -------------------------------------------------------

// OSV's batched query endpoint. It answers with advisory ids only, so a
// second request per unresolved id fetches the record that carries severity,
// aliases and the withdrawn marker.
const OSV_QUERYBATCH_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns/';
// OSV documents no hard ceiling on a batch, but an unbounded body is a
// request nobody can retry cheaply. 500 keeps this lockfile to a couple of
// round trips while staying well inside the endpoint's comfort zone.
const OSV_BATCH_SIZE = 500;
// Mirrors AUDIT_ATTEMPTS/AUDIT_RETRY_DELAY_MS/AUDIT_FETCH_TIMEOUT_MS: the same
// reasoning applies to the same class of fault, and a gate whose two arms
// tolerate outages differently is a gate nobody can predict.
const OSV_ATTEMPTS = 3;
const OSV_RETRY_DELAY_MS = 2000;
const OSV_TIMEOUT_MS = 60000;

// Matches a GHSA id exactly (advisoryId() matches one *inside* an npm
// advisory URL). The npm report names advisories by GHSA id, so an OSV record
// can only be compared against it — or against the allowlist — through its
// GHSA id or GHSA alias.
const GHSA_ID = /^GHSA(?:-[0-9a-z]{4}){3}$/;

// OSV severities this gate fails on, in the `database_specific.severity`
// spelling GHSA records use, lowercased. `unknown` is deliberately included:
// a record that declares no severity is usually not a GHSA at all but a `MAL-`
// malicious-package report, and guessing "probably fine" about an advisory the
// npm registry never served is the exact failure this arm exists to prevent.
// It fails closed, the same way advisoryId() does for an advisory with no id.
const GATED_OSV_SEVERITIES = new Set([...GATED_SEVERITIES, 'unknown']);

const LOCKFILE_URL = new URL('../package-lock.json', import.meta.url);

/**
 * Reads and parses `package-lock.json`.
 *
 * @returns {{lockfile: object|null, failure: string|null}} `failure` carries
 *   the reason when the lockfile could not be read or parsed.
 */
function readLockfile() {
  try {
    return {
      lockfile: JSON.parse(readFileSync(LOCKFILE_URL, 'utf8')),
      failure: null,
    };
  } catch (error) {
    return { lockfile: null, failure: String(error) };
  }
}

// Turns a lockfile into the deduplicated `name@version` pairs to ask OSV
// about.
//
// Keys in a v3 lockfile are install paths, so the package name is whatever
// follows the last `node_modules/` segment — except for an aliased install
// (`"foo": "npm:bar@1"`), where npm records the real registry name in `name`
// and that is the name OSV knows. Entries with no `node_modules/` segment are
// the project itself and its workspaces, and `link` entries are symlinks to
// those; neither comes from the registry, so neither has advisories to find.
//
// @returns {Array<{name: string, version: string}>} sorted, one per distinct
//   name@version however many times it is installed
export function lockfileQueries(lockfile) {
  const marker = 'node_modules/';
  const seen = new Map();
  for (const [path, entry] of Object.entries(lockfile?.packages ?? {})) {
    const at = path.lastIndexOf(marker);
    if (at === -1 || entry?.link) continue;
    const version = entry?.version;
    if (typeof version !== 'string' || version === '') continue;
    const name = entry?.name ?? path.slice(at + marker.length);
    seen.set(`${name}@${version}`, { name, version });
  }
  return [...seen.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

// Names an OSV record by the GHSA id npm would use, so one advisory reported
// by both sources is one advisory here too, and one allowlist entry covers it
// in both arms. OSV records reached through a CVE, GO- or MAL- id carry the
// GHSA as an alias; a record with no GHSA at all keeps its own id, which can
// never match an allowlist entry and therefore fails closed.
export function osvAdvisoryId(vuln) {
  const id = String(vuln?.id ?? 'advisory:unknown');
  if (GHSA_ID.test(id)) return id;
  return (vuln?.aliases ?? []).find((alias) => GHSA_ID.test(alias)) ?? id;
}

// Reads an OSV record's severity in the npm-audit vocabulary. GHSA records
// carry it verbatim in `database_specific.severity` (`HIGH`, `MODERATE`, ...);
// anything else is `unknown`, which GATED_OSV_SEVERITIES gates.
export function osvSeverity(vuln) {
  const declared = vuln?.database_specific?.severity;
  return typeof declared === 'string' ? declared.toLowerCase() : 'unknown';
}

// Narrows the ids OSV returned to the ones whose record actually has to be
// fetched.
//
// A GHSA id can be judged without its record: if the npm report already
// reaches it, the npm arm above owns it outright — it has already applied the
// allowlist, the stale-entry check and the fixable-entry check to it — and if
// the allowlist covers it there is nothing left to decide. Every other id
// (non-GHSA, or GHSA npm did not report) needs its record to resolve aliases,
// severity and `withdrawn`. On a lockfile whose advisories npm reports in full
// this leaves nothing to fetch, so the happy path costs one round trip.
export function osvIdsNeedingLookup(
  ids,
  report,
  allowlist = ALLOWLISTED_ADVISORIES,
) {
  const known = reportedAdvisoryIds(report);
  return [...ids]
    .filter((id) => !(GHSA_ID.test(id) && (known.has(id) || allowlist.has(id))))
    .sort();
}

// Decides which OSV findings block the gate.
//
// `hits` maps an OSV id to the `name@version` strings it was reported against;
// `details` holds the records osvIdsNeedingLookup() selected. An id with no
// record was resolved without one and is not a finding. A withdrawn record is
// not an advisory. Everything else is matched against the npm report and the
// allowlist by GHSA id, then gated on severity.
//
// @returns {Array<{id: string, package: string, severity: string}>}
export function classifyOsv(
  hits,
  details,
  report,
  allowlist = ALLOWLISTED_ADVISORIES,
) {
  const known = reportedAdvisoryIds(report);
  const blocked = [];
  for (const [rawId, packages] of hits) {
    const vuln = details.get(rawId);
    if (!vuln || vuln.withdrawn) continue;
    const id = osvAdvisoryId(vuln);
    if (known.has(id) || allowlist.has(id)) continue;
    const severity = osvSeverity(vuln);
    if (!GATED_OSV_SEVERITIES.has(severity)) continue;
    for (const name of packages) blocked.push({ id, package: name, severity });
  }
  return blocked.sort(
    (a, b) => a.id.localeCompare(b.id) || a.package.localeCompare(b.package),
  );
}

/**
 * Fetches JSON from OSV, bounded by OSV_TIMEOUT_MS.
 *
 * @param {string} url endpoint to call
 * @param {object} [body] POST payload; omitted, the request is a GET
 * @returns {Promise<object>} the decoded answer
 */
async function osvFetch(url, body) {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(OSV_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} answered HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Retries an OSV call that failed, then gives up.
 *
 * Only transport and shape failures reach here; a decoded answer is final
 * whatever it says, for the same reason a parsed npm report is.
 *
 * @param {string} label what is being retried, for the CI log
 * @param {() => Promise<object>} call the request to make
 * @returns {Promise<object>} the first successful answer
 */
async function osvRetry(label, call) {
  let last;
  for (let attempt = 1; attempt <= OSV_ATTEMPTS; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      last = error;
      if (attempt < OSV_ATTEMPTS) {
        console.error(
          `audit-gate: OSV ${label} failed (${error}); retrying ` +
            `(attempt ${attempt + 1} of ${OSV_ATTEMPTS})`,
        );
        sleepSync(OSV_RETRY_DELAY_MS);
      }
    }
  }
  throw new Error(`OSV ${label} failed in ${OSV_ATTEMPTS} attempts: ${last}`);
}

/**
 * Asks OSV which of the lockfile's packages have advisories.
 *
 * The answer's `results` array is positional, so a length that does not match
 * the batch makes every id ambiguous; that is a failed query, not an empty
 * one. (`next_page_token` is not handled: it appears only past 1000
 * advisories for a single package version, which no npm release approaches.)
 *
 * @param {Array<{name: string, version: string}>} queries
 * @returns {Promise<Map<string, string[]>>} OSV id -> sorted `name@version`
 */
async function osvQuery(queries) {
  const hits = new Map();
  for (let start = 0; start < queries.length; start += OSV_BATCH_SIZE) {
    const chunk = queries.slice(start, start + OSV_BATCH_SIZE);
    const answer = await osvRetry('querybatch', () =>
      osvFetch(OSV_QUERYBATCH_URL, {
        queries: chunk.map(({ name, version }) => ({
          package: { name, ecosystem: 'npm' },
          version,
        })),
      }),
    );
    const results = answer?.results;
    if (!Array.isArray(results) || results.length !== chunk.length) {
      throw new Error(
        `OSV querybatch answered ${
          Array.isArray(results) ? results.length : 'no'
        } result(s) for ${chunk.length} quer(ies)`,
      );
    }
    results.forEach((result, index) => {
      for (const vuln of result?.vulns ?? []) {
        const id = String(vuln?.id ?? '');
        if (id === '') continue;
        const packages = hits.get(id) ?? [];
        packages.push(`${chunk[index].name}@${chunk[index].version}`);
        hits.set(id, packages);
      }
    });
  }
  for (const [id, packages] of hits)
    hits.set(id, [...new Set(packages)].sort());
  return hits;
}

/**
 * Fetches the full OSV record for each id that still needs one.
 *
 * @param {string[]} ids
 * @returns {Promise<Map<string, object>>} id -> record
 */
async function osvLookup(ids) {
  const details = new Map();
  for (const id of ids) {
    details.set(
      id,
      await osvRetry(`lookup of ${id}`, () =>
        osvFetch(`${OSV_VULN_URL}${encodeURIComponent(id)}`),
      ),
    );
  }
  return details;
}

/**
 * Runs the OSV arm of the gate, exiting 1 on a finding or on a failed query.
 *
 * Fails closed on every fault, including a lockfile it cannot read: the whole
 * point of this arm is that `npm audit` reporting nothing is not evidence of
 * nothing, so silently skipping the cross-check would restore the blind spot
 * precisely when the gate is least able to notice.
 *
 * @param {object} report the npm audit report the first arm already accepted
 * @param {Set<string>} allowlist
 * @returns {Promise<number>} how many lockfile packages were cross-checked
 */
async function osvGate(report, allowlist) {
  const { lockfile, failure } = readLockfile();
  if (lockfile === null) {
    console.error(
      `audit-gate: could not read package-lock.json for the OSV ` +
        `cross-check: ${failure}`,
    );
    console.error(
      'npm audit alone cannot see an advisory the npm registry does not ' +
        'serve, so a skipped cross-check is not a clean one.',
    );
    process.exit(1);
  }
  const queries = lockfileQueries(lockfile);
  let hits;
  let details;
  try {
    hits = await osvQuery(queries);
    details = await osvLookup(
      osvIdsNeedingLookup([...hits.keys()], report, allowlist),
    );
  } catch (error) {
    console.error(`audit-gate: the OSV cross-check did not complete: ${error}`);
    console.error(
      'Refusing to report a clean audit on npm alone: the advisories only ' +
        'OSV carries are exactly the ones npm audit cannot report.',
    );
    process.exit(1);
  }
  const blocked = classifyOsv(hits, details, report, allowlist);
  if (blocked.length > 0) {
    console.error(
      'audit-gate: high/critical advisories reported by OSV and not by npm ' +
        'audit, outside the allowlist:',
    );
    for (const item of blocked) {
      console.error(`  ${item.package} (${item.severity}): ${item.id}`);
    }
    console.error(
      'npm audit does not report these, so raising its threshold cannot ' +
        'catch them. Fix the advisory (upgrade or add an override, see ' +
        'SECURITY.md), or — only for an advisory with no patched release — ' +
        'document it in SECURITY.md and allowlist it in ' +
        'scripts/audit-gate.mjs.',
    );
    process.exit(1);
  }
  return queries.length;
}

// The allowlist is a parameter so the unit tests can drive every arm of the
// gate whatever the shipped allowlist happens to contain; the CLI entry below
// always runs with ALLOWLISTED_ADVISORIES.
export async function main(allowlist = ALLOWLISTED_ADVISORIES) {
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
  // Runs before the two allowlist-hygiene checks below and after the npm
  // blocked check above: all three of these describe advisories that are live
  // in the lockfile right now, and a finding npm cannot see at all is the one
  // nothing else in CI would ever report.
  const crossChecked = await osvGate(report, allowlist);
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
  console.log(
    `audit-gate: ok — ${allowlisted.length} high/critical finding(s), all ` +
      'tracing to allowlisted advisories documented in SECURITY.md; OSV ' +
      `cross-check clean across ${crossChecked} lockfile package(s)`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
