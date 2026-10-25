// scripts/audit-gate.mjs is the CI gate that fails the build when `npm
// audit` reports a high or critical advisory outside the documented
// allowlist. The pure classification is tested directly; the CLI entry is
// exercised in a subprocess with `npm` replaced by a stub first on PATH, so
// no test run depends on the real lockfile's audit state or on the network.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ALLOWLISTED_ADVISORIES,
  advisoryId,
  classifyAudit,
  classifyOsv,
  lockfileQueries,
  osvAdvisoryId,
  osvIdsNeedingLookup,
  osvSeverity,
  unusedAllowlistEntries,
  fixableAllowlistedAdvisories,
  describeFix,
} from '../scripts/audit-gate.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// A retired advisory (withdrawn upstream on 2026-10-23) reused as a fixture
// id. The shipped allowlist is empty, so every case that needs an allowlisted
// advisory passes its own Set rather than leaning on the default.
const BRACES = 'GHSA-vfj7-8cjw-p6xm';
const NEW_BAD = 'GHSA-aaaa-bbbb-cccc';
const ALLOWLIST = new Set([BRACES]);

/** @returns {object} a minimal advisory `via` object for the given GHSA id */
function advisory(id, severity = 'high') {
  return {
    source: 1097040,
    name: 'some-package',
    severity,
    url: `https://github.com/advisories/${id}`,
  };
}

/** @returns {object} an npm-audit-shaped vulnerability entry */
function entry(severity, via) {
  return { severity, via, range: '*', nodes: [], fixAvailable: false };
}

// --- advisoryId ---

test('advisoryId extracts the GHSA id from the advisory URL', () => {
  assert.equal(advisoryId(advisory(BRACES)), BRACES);
});

test('advisoryId fails closed when the URL carries no GHSA id', () => {
  // The fallback label starts with "advisory:" which can never equal a
  // "GHSA-..." allowlist entry, so an unidentifiable advisory always blocks.
  assert.equal(
    advisoryId({ source: 12345, url: 'https://example.com/no-id' }),
    'advisory:12345',
  );
  assert.equal(advisoryId({}), 'advisory:unknown');
});

// --- classifyAudit ---

test('an entry whose only advisory is allowlisted is not blocked', () => {
  const report = {
    vulnerabilities: { braces: entry('high', [advisory(BRACES)]) },
  };
  const { blocked, allowlisted } = classifyAudit(report, ALLOWLIST);
  assert.deepEqual(blocked, []);
  assert.deepEqual(allowlisted, ['braces']);
});

test('a non-allowlisted high advisory blocks and is named', () => {
  const report = {
    vulnerabilities: { newdep: entry('critical', [advisory(NEW_BAD)]) },
  };
  const { blocked } = classifyAudit(report);
  assert.deepEqual(blocked, [
    { name: 'newdep', severity: 'critical', advisories: [NEW_BAD] },
  ]);
});

test('a blocking advisory propagates through a string via chain', () => {
  // micromatch does not carry an advisory itself; it is vulnerable only
  // because it depends on the package that does. The block must bubble.
  const report = {
    vulnerabilities: {
      newdep: entry('high', [advisory(NEW_BAD)]),
      micromatch: entry('high', ['newdep']),
    },
  };
  const { blocked } = classifyAudit(report);
  assert.deepEqual(blocked.map((b) => b.name).sort(), ['micromatch', 'newdep']);
  for (const b of blocked) assert.deepEqual(b.advisories, [NEW_BAD]);
});

test('an allowlisted advisory clears its whole bubbled chain', () => {
  const report = {
    vulnerabilities: {
      braces: entry('high', [advisory(BRACES)]),
      micromatch: entry('high', ['braces']),
      '@docusaurus/utils': entry('high', ['micromatch']),
    },
  };
  const { blocked, allowlisted } = classifyAudit(report, ALLOWLIST);
  assert.deepEqual(blocked, []);
  assert.deepEqual(allowlisted.sort(), [
    '@docusaurus/utils',
    'braces',
    'micromatch',
  ]);
});

test('moderate and low findings never block, even unallowlisted', () => {
  const report = {
    vulnerabilities: {
      meh: entry('moderate', [advisory(NEW_BAD, 'moderate')]),
      shrug: entry('low', [advisory(NEW_BAD, 'low')]),
    },
  };
  const { blocked, allowlisted } = classifyAudit(report);
  assert.deepEqual(blocked, []);
  assert.deepEqual(allowlisted, []);
});

test('a via cycle terminates and is judged by its advisories', () => {
  // npm emits mutual references when two packages each bubble the other.
  // With only an allowlisted advisory in the cycle, both clear...
  const clean = classifyAudit(
    {
      vulnerabilities: {
        a: entry('high', [advisory(BRACES), 'b']),
        b: entry('high', ['a']),
      },
    },
    ALLOWLIST,
  );
  assert.deepEqual(clean.blocked, []);
  // ...and with a non-allowlisted one, both block.
  const dirty = classifyAudit({
    vulnerabilities: {
      a: entry('high', [advisory(NEW_BAD), 'b']),
      b: entry('high', ['a']),
    },
  });
  assert.deepEqual(dirty.blocked.map((b) => b.name).sort(), ['a', 'b']);
});

test('a string via naming an unlisted package contributes nothing', () => {
  // npm should never emit this, but a dangling reference must not throw and
  // must not invent a block.
  const report = {
    vulnerabilities: { odd: entry('high', ['not-in-report']) },
  };
  const { blocked, allowlisted } = classifyAudit(report);
  assert.deepEqual(blocked, []);
  assert.deepEqual(allowlisted, ['odd']);
});

test('an entry without a via array is not blocked', () => {
  const report = { vulnerabilities: { bare: { severity: 'high' } } };
  const { blocked, allowlisted } = classifyAudit(report);
  assert.deepEqual(blocked, []);
  assert.deepEqual(allowlisted, ['bare']);
});

test('a report with no vulnerabilities key yields empty partitions', () => {
  const { blocked, allowlisted } = classifyAudit({});
  assert.deepEqual(blocked, []);
  assert.deepEqual(allowlisted, []);
});

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

// --- unusedAllowlistEntries ---

test('unusedAllowlistEntries reports nothing while the advisory is present', () => {
  const report = {
    vulnerabilities: {
      braces: entry('high', [advisory(BRACES)]),
      micromatch: entry('high', ['braces']),
    },
  };
  assert.deepEqual(unusedAllowlistEntries(report, new Set([BRACES])), []);
});

test('unusedAllowlistEntries names an entry the report no longer reaches', () => {
  const report = {
    vulnerabilities: { newdep: entry('high', [advisory(NEW_BAD)]) },
  };
  assert.deepEqual(unusedAllowlistEntries(report, new Set([BRACES])), [BRACES]);
});

test('unusedAllowlistEntries names every entry on a report with no findings', () => {
  assert.deepEqual(
    unusedAllowlistEntries({ vulnerabilities: {} }, new Set([BRACES, NEW_BAD])),
    [NEW_BAD, BRACES].sort(),
  );
});

test('unusedAllowlistEntries counts an advisory at any severity as present', () => {
  // An advisory rescored below high is still in the lockfile, so the entry
  // covering it is still doing work and must not be called stale.
  const report = {
    vulnerabilities: {
      braces: entry('moderate', [advisory(BRACES, 'moderate')]),
    },
  };
  assert.deepEqual(unusedAllowlistEntries(report, new Set([BRACES])), []);
});

test('unusedAllowlistEntries finds an advisory nested behind a string via', () => {
  // The advisory object can sit on a package the top-level entry only names
  // by string; the scan must reach it rather than call the entry stale.
  const report = {
    vulnerabilities: {
      micromatch: entry('high', ['braces']),
      braces: entry('high', [advisory(BRACES)]),
    },
  };
  assert.deepEqual(unusedAllowlistEntries(report, new Set([BRACES])), []);
});

test('unusedAllowlistEntries tolerates a report with no vulnerabilities key', () => {
  assert.deepEqual(unusedAllowlistEntries({}, new Set([BRACES])), [BRACES]);
});

test('unusedAllowlistEntries tolerates an entry without a via array', () => {
  // Mirrors the classifyAudit case above: an entry with no `via` reaches no
  // advisory, so it neither crashes the scan nor keeps an entry alive.
  const report = {
    vulnerabilities: {
      bare: { severity: 'high' },
      braces: entry('high', [advisory(BRACES)]),
    },
  };
  assert.deepEqual(unusedAllowlistEntries(report, new Set([BRACES, NEW_BAD])), [
    NEW_BAD,
  ]);
});

test('unusedAllowlistEntries defaults to the shipped allowlist', () => {
  const report = {
    vulnerabilities: Object.fromEntries(
      [...ALLOWLISTED_ADVISORIES].map((id, index) => [
        `pkg-${index}`,
        entry('high', [advisory(id)]),
      ]),
    ),
  };
  assert.deepEqual(unusedAllowlistEntries(report), []);
});

// --- fixableAllowlistedAdvisories ---

test('fixableAllowlistedAdvisories reports nothing while no fix exists', () => {
  // The shipped state: braces is in the lockfile, npm reports fixAvailable
  // false, and the entry is doing exactly the work it was added for.
  const report = {
    vulnerabilities: {
      braces: entry('high', [advisory(BRACES)]),
      micromatch: entry('high', ['braces']),
    },
  };
  assert.deepEqual(fixableAllowlistedAdvisories(report, new Set([BRACES])), []);
});

test('fixableAllowlistedAdvisories names an entry npm can now fix', () => {
  // The expiry unusedAllowlistEntries() cannot see: upstream published a fix,
  // so the advisory is still in the report (the entry still looks "used")
  // while its stated reason -- no patched release exists -- is now false.
  const fix = { name: 'braces', version: '3.0.4', isSemVerMajor: false };
  const report = {
    vulnerabilities: {
      braces: { ...entry('high', [advisory(BRACES)]), fixAvailable: fix },
    },
  };
  assert.deepEqual(fixableAllowlistedAdvisories(report, new Set([BRACES])), [
    { id: BRACES, package: 'braces', fixAvailable: fix },
  ]);
});

test('fixableAllowlistedAdvisories accepts a bare true fixAvailable', () => {
  const report = {
    vulnerabilities: {
      braces: { ...entry('high', [advisory(BRACES)]), fixAvailable: true },
    },
  };
  assert.deepEqual(
    fixableAllowlistedAdvisories(report, new Set([BRACES])).map((f) => f.id),
    [BRACES],
  );
});

test('fixableAllowlistedAdvisories ignores a package that only inherits the advisory', () => {
  // micromatch's fixAvailable describes its own tree, not whether the braces
  // advisory itself has a patched release; reporting it would blame the
  // allowlist entry for an unrelated upgrade path.
  const report = {
    vulnerabilities: {
      braces: entry('high', [advisory(BRACES)]),
      micromatch: { ...entry('high', ['braces']), fixAvailable: true },
    },
  };
  assert.deepEqual(fixableAllowlistedAdvisories(report, new Set([BRACES])), []);
});

test('fixableAllowlistedAdvisories ignores a fixable advisory outside the allowlist', () => {
  // A non-allowlisted advisory is already classifyAudit()'s business; naming
  // it here too would report the same finding twice.
  const report = {
    vulnerabilities: {
      newdep: { ...entry('high', [advisory(NEW_BAD)]), fixAvailable: true },
    },
  };
  assert.deepEqual(fixableAllowlistedAdvisories(report, new Set([BRACES])), []);
});

test('fixableAllowlistedAdvisories tolerates a missing vulnerabilities key and bare entries', () => {
  assert.deepEqual(fixableAllowlistedAdvisories({}, new Set([BRACES])), []);
  const report = {
    vulnerabilities: { bare: { severity: 'high', fixAvailable: true } },
  };
  assert.deepEqual(fixableAllowlistedAdvisories(report, new Set([BRACES])), []);
});

test('fixableAllowlistedAdvisories orders a shared advisory by package name', () => {
  // The same advisory can sit directly on more than one package (a pinned
  // copy and a nested one); the CI log lists them in a stable order.
  const report = {
    vulnerabilities: {
      zeta: { ...entry('high', [advisory(BRACES)]), fixAvailable: true },
      alpha: { ...entry('high', [advisory(BRACES)]), fixAvailable: true },
    },
  };
  assert.deepEqual(
    fixableAllowlistedAdvisories(report, new Set([BRACES])).map(
      (f) => f.package,
    ),
    ['alpha', 'zeta'],
  );
});

test('fixableAllowlistedAdvisories defaults to the shipped allowlist', () => {
  const report = {
    vulnerabilities: Object.fromEntries(
      [...ALLOWLISTED_ADVISORIES].map((id, index) => [
        `pkg-${index}`,
        { ...entry('high', [advisory(id)]), fixAvailable: true },
      ]),
    ),
  };
  assert.deepEqual(
    fixableAllowlistedAdvisories(report).map((f) => f.id),
    [...ALLOWLISTED_ADVISORIES].sort(),
  );
});

// --- describeFix ---

test('describeFix names the release npm points at, flagging a semver-major bump', () => {
  assert.equal(
    describeFix({ name: 'braces', version: '3.0.4', isSemVerMajor: true }),
    'upgrade to braces@3.0.4, semver-major',
  );
  assert.equal(
    describeFix({ name: 'braces', version: '3.0.4', isSemVerMajor: false }),
    'upgrade to braces@3.0.4',
  );
  assert.equal(describeFix({ version: '3.0.4' }), 'upgrade to 3.0.4');
});

test('describeFix falls back to a generic phrase when npm names no release', () => {
  // npm emits a bare `true` when the fix is a plain `npm audit fix`, and an
  // object can in principle arrive without name/version; neither should
  // produce "upgrade to " with nothing after it.
  assert.equal(describeFix(true), 'a fix is available');
  assert.equal(describeFix({}), 'a fix is available');
  assert.equal(describeFix({ isSemVerMajor: true }), 'a fix is available');
});

// --- CLI entry, with npm stubbed ---

// Stub placed first on PATH so the script under test never reaches the real
// npm or the network. It prints a canned report and exits with a canned
// status, mirroring tests/helpers-gh-sandbox.mjs.
//
// The gate retries an npm answer that carries no report, so the stub answers
// from a list rather than a single canned value. It appends its own argv to a
// log file per invocation; the line count is both the attempt counter and the
// index into the list, and the log is what lets a test assert which flags the
// gate passed. The last entry repeats once the list runs out, which is what
// makes a single-entry list behave exactly like the fixed stub it replaces.
const NPM_STUB = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const log = process.env.AUDIT_STUB_ARGV;
const responses = JSON.parse(process.env.AUDIT_STUB_RESPONSES);
let seen = 0;
try {
  seen = readFileSync(log, 'utf8').split('\\n').filter(Boolean).length;
} catch {}
appendFileSync(log, process.argv.slice(2).join(' ') + '\\n');
const step = responses[Math.min(seen, responses.length - 1)];
process.stdout.write(step.stdout);
process.exit(step.status);
`;

// Capture the actual CLI's subprocess options and synthesize deadline errors
// without making the suite wait a minute for each timed-out attempt.
const SPAWN_PRELOAD = `import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const spawn = childProcess.spawnSync;
let timeouts = Number(process.env.AUDIT_STUB_TIMEOUTS);
childProcess.spawnSync = (command, args, options) => {
  appendFileSync(process.env.AUDIT_STUB_SPAWNS, JSON.stringify({
    timeout: options.timeout,
    killSignal: options.killSignal,
  }) + '\\n');
  if (timeouts > 0) {
    timeouts -= 1;
    return {
      error: Object.assign(new Error('spawnSync npm ETIMEDOUT'), {
        code: 'ETIMEDOUT',
      }),
      status: null,
      stdout: '{"vulnerabilities":{}}',
      stderr: '',
    };
  }
  return spawn(command, args, options);
};
syncBuiltinESMExports();

// The OSV arm talks to api.osv.dev over global fetch. Answers are consumed in
// order, one per request, with the last entry repeating, so a case can script
// a failure followed by a success without matching on URLs; every request is
// logged so the batching and the endpoints can be asserted directly.
const answers = JSON.parse(process.env.AUDIT_STUB_OSV);
let served = 0;
globalThis.fetch = async (url, init) => {
  const step = answers[Math.min(served, answers.length - 1)] ?? {};
  served += 1;
  appendFileSync(process.env.AUDIT_STUB_OSV_LOG, JSON.stringify({
    url: String(url),
    method: init.method,
    body: init.body ?? null,
  }) + '\\n');
  if (step.networkError) throw new Error(step.networkError);
  const status = step.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => step.body ?? {},
  };
};
`;

/**
 * Runs scripts/audit-gate.mjs in a sandbox that mirrors the repo layout
 * (so coverage maps back to the real source) with `npm` stubbed.
 *
 * @param {object} options
 * @param {string} [options.stdout] what the npm stub prints
 * @param {string} [options.status] the npm stub's exit code
 * @param {Array<{stdout: string, status: number}>} [options.responses] one
 *   entry per npm invocation, for the retry arms; the last entry repeats.
 *   Overrides `stdout`/`status` when given.
 * @param {boolean} [options.withNpm] install the stub at all; false makes
 *   spawnSync fail with ENOENT to exercise the spawn-error arm
 * @param {number} [options.timeouts] deadline errors before npm can run
 * @param {object|null} [options.lockfile] package-lock.json to place beside
 *   the script; null writes none, exercising the unreadable-lockfile arm.
 *   The default has no packages, so the OSV arm makes no request at all.
 * @param {Array<{status?: number, body?: unknown, networkError?: string}>}
 *   [options.osv] answers for the OSV requests, in order; the last repeats
 * @param {Iterable<string>} [options.allowlist] GHSA ids to run the gate
 *   with, through a wrapper entry that calls main(); omitted, the script runs
 *   as the CLI does with its shipped allowlist
 * @returns {{status: number, stdout: string, stderr: string,
 *   attempts: number, argv: string[], spawns: object[], osv: object[]}}
 *   `argv` holds the invocations that reached npm; `spawns` includes
 *   timed-out attempts; `osv` holds every OSV request the gate made.
 */
function runGate({
  stdout = '',
  status = '0',
  responses,
  withNpm = true,
  timeouts = 0,
  lockfile = { packages: {} },
  osv = [],
  allowlist,
} = {}) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-audit-'));
  try {
    const script = join(work, 'scripts', 'audit-gate.mjs');
    mkdirSync(dirname(script), { recursive: true });
    cpSync(join(repoRoot, 'scripts', 'audit-gate.mjs'), script);
    if (lockfile !== null) {
      writeFileSync(join(work, 'package-lock.json'), JSON.stringify(lockfile));
    }

    let entrypoint = script;
    if (allowlist) {
      entrypoint = join(work, 'run-gate.mjs');
      writeFileSync(
        entrypoint,
        `import { main } from './scripts/audit-gate.mjs';\n` +
          `await main(new Set(${JSON.stringify([...allowlist])}));\n`,
      );
    }

    const binDir = join(work, '.bin');
    mkdirSync(binDir, { recursive: true });
    // The stub's shebang (and nothing else on the stripped PATH) needs node.
    symlinkSync(process.execPath, join(binDir, 'node'));
    if (withNpm) {
      const stub = join(binDir, 'npm');
      writeFileSync(stub, NPM_STUB);
      chmodSync(stub, 0o755);
    }

    const argvLog = join(work, 'npm-argv');
    const spawnLog = join(work, 'npm-spawns');
    const osvLog = join(work, 'osv-requests');
    const preload = join(work, 'spawn-preload.mjs');
    writeFileSync(preload, SPAWN_PRELOAD);
    const result = spawnSync(
      process.execPath,
      ['--import', preload, entrypoint],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: binDir,
          AUDIT_STUB_ARGV: argvLog,
          AUDIT_STUB_SPAWNS: spawnLog,
          AUDIT_STUB_TIMEOUTS: String(timeouts),
          AUDIT_STUB_OSV: JSON.stringify(osv),
          AUDIT_STUB_OSV_LOG: osvLog,
          AUDIT_STUB_RESPONSES: JSON.stringify(
            responses ?? [{ stdout, status: Number(status) }],
          ),
        },
      },
    );
    // The stub never runs when it was not installed, so an absent log is a
    // legitimate record of zero invocations rather than an error to swallow.
    const argv = existsSync(argvLog)
      ? readFileSync(argvLog, 'utf8').split('\n').filter(Boolean)
      : [];
    const spawns = existsSync(spawnLog)
      ? readFileSync(spawnLog, 'utf8').trim().split('\n').map(JSON.parse)
      : [];
    const osvRequests = existsSync(osvLog)
      ? readFileSync(osvLog, 'utf8').trim().split('\n').map(JSON.parse)
      : [];
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      attempts: spawns.length,
      argv,
      spawns,
      osv: osvRequests,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test('cli: exits 1 on a clean report when the allowlist still has entries', () => {
  // A report with no vulnerabilities at all means every allowlisted advisory
  // has left the lockfile. The suppression is then pointless and, worse,
  // still live for a future reintroduction, so the gate asks for it to be
  // removed rather than reporting a green audit over a dead exemption.
  const result = runGate({
    stdout: JSON.stringify({ vulnerabilities: {} }),
    allowlist: ALLOWLIST,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no longer present in the lockfile/);
  assert.match(result.stderr, new RegExp(BRACES));
  assert.doesNotMatch(result.stdout, /audit-gate: ok/);
});

test('cli: exits 0 on a clean report with the shipped allowlist', () => {
  // The repository's current state: nothing to suppress and nothing
  // suppressed. Runs the script directly, so this is the CLI entry and the
  // default allowlist that CI exercises, not the wrapper the other cases use.
  const result = runGate({
    stdout: JSON.stringify({ vulnerabilities: {} }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /audit-gate: ok — 0 high\/critical finding/);
});

test('cli: exits 0 when every finding is allowlisted, despite npm exiting 1', () => {
  const report = {
    vulnerabilities: {
      braces: entry('high', [advisory(BRACES)]),
      micromatch: entry('high', ['braces']),
    },
  };
  const result = runGate({
    stdout: JSON.stringify(report),
    status: '1',
    allowlist: ALLOWLIST,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 high\/critical finding/);
});

test('cli: exits 1 when npm reports a fix for an allowlisted advisory', () => {
  // The suppression's premise has expired: the advisory is still present, so
  // the stale-entry check stays quiet, but npm says it is fixable now.
  const report = {
    vulnerabilities: {
      braces: {
        severity: 'high',
        via: [advisory(BRACES)],
        range: '*',
        nodes: [],
        fixAvailable: { name: 'braces', version: '3.0.4', isSemVerMajor: true },
      },
    },
  };
  const result = runGate({
    stdout: JSON.stringify(report),
    status: '1',
    allowlist: ALLOWLIST,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /now reports as fixable/);
  assert.match(result.stderr, new RegExp(`${BRACES} via braces`));
  assert.match(result.stderr, /upgrade to braces@3\.0\.4, semver-major/);
  assert.doesNotMatch(result.stdout, /audit-gate: ok/);
});

test('cli: exits 1 naming a new advisory outside the allowlist', () => {
  const report = {
    vulnerabilities: { newdep: entry('critical', [advisory(NEW_BAD)]) },
  };
  const result = runGate({ stdout: JSON.stringify(report), status: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`newdep \\(critical\\): ${NEW_BAD}`));
  assert.match(result.stderr, /SECURITY\.md/);
});

test('cli: exits 1 when npm emits unparseable output', () => {
  const result = runGate({ stdout: 'npm ERR! something broke' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not produce parseable JSON/);
  assert.match(result.stderr, /something broke/);
});

test('cli: exits 1 when npm cannot be spawned at all', () => {
  const result = runGate({ withNpm: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed to run npm audit/);
});

test('cli: exits 1 when npm audit fails with an error document', () => {
  // A failed audit (registry outage, proxy error, rate limit) still prints
  // parseable JSON, but an error document carrying no `vulnerabilities` key.
  // Reading that as "no vulnerabilities" would fail the gate open and report
  // a green audit that never ran.
  const result = runGate({
    stdout: JSON.stringify({
      message: '502 Bad Gateway - POST /-/npm/v1/security/advisories/bulk',
      statusCode: 502,
      error: { summary: '', detail: '' },
    }),
    status: '1',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not return a report/);
  assert.doesNotMatch(result.stdout, /audit-gate: ok/);
});

test('cli: exits 1 when the report carries a non-object vulnerabilities key', () => {
  const result = runGate({
    stdout: JSON.stringify({ vulnerabilities: null }),
    status: '1',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not return a report/);
});

// --- retrying an npm answer that carries no report ---

// npm bundled with Node 22 asks the bulk advisory endpoint first and, on any
// failure, falls back to `/-/npm/v1/security/audits/quick`. That endpoint is
// retired and answers 400, so a momentary fault on the bulk endpoint surfaces
// as this error document. It is the exact payload that reddened `Validate
// repository` on every open PR at once, and nothing about it says the
// lockfile changed, so the gate must ask again before blaming the repository.
const QUICK_ENDPOINT_FAILURE = JSON.stringify({
  message:
    '400 Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick',
  statusCode: 400,
  error: { summary: 'audit endpoint returned an error', detail: '' },
});

const ALLOWLISTED_REPORT = JSON.stringify({
  vulnerabilities: {
    braces: entry('high', [advisory(BRACES)]),
    micromatch: entry('high', ['braces']),
  },
});

test('cli: a transient no-report answer is retried and the next report decides', () => {
  // The first answer carries no report and the second is the ordinary
  // allowlisted-findings report. Without the retry this exits 1 and reports a
  // repository problem that does not exist.
  const result = runGate({
    responses: [
      { stdout: QUICK_ENDPOINT_FAILURE, status: 1 },
      { stdout: ALLOWLISTED_REPORT, status: 1 },
    ],
    allowlist: ALLOWLIST,
  });
  assert.equal(result.status, 0);
  assert.equal(result.attempts, 2);
  assert.match(result.stderr, /retrying \(attempt 2 of 3\)/);
  assert.match(result.stdout, /audit-gate: ok/);
});

test('cli: retrying stops at the attempt limit and still fails closed', () => {
  // Every attempt fails, so the gate must exit 1 rather than retry forever or
  // let a never-run audit pass. The attempt count is asserted because an
  // unbounded loop would otherwise look identical from the exit code alone.
  const result = runGate({
    responses: [{ stdout: QUICK_ENDPOINT_FAILURE, status: 1 }],
  });
  assert.equal(result.status, 1);
  assert.equal(result.attempts, 3);
  assert.match(result.stderr, /did not return a report/);
  assert.match(result.stderr, /in 3 attempts/);
  assert.doesNotMatch(result.stdout, /audit-gate: ok/);
});

test('cli: a report naming a new advisory is never retried away', () => {
  // The dangerous failure mode of a retry is treating a real finding as a
  // blip. A parsed report is final whatever it says, so npm must be asked
  // exactly once here even though the gate goes red.
  const report = {
    vulnerabilities: {
      newdep: entry('critical', [advisory(NEW_BAD)]),
    },
  };
  const result = runGate({
    responses: [
      { stdout: JSON.stringify(report), status: 1 },
      { stdout: ALLOWLISTED_REPORT, status: 1 },
    ],
  });
  assert.equal(result.status, 1);
  assert.equal(result.attempts, 1);
  assert.match(result.stderr, new RegExp(`newdep \\(critical\\): ${NEW_BAD}`));
});

test('cli: a clean run asks npm exactly once', () => {
  // The retry must not cost a second registry round trip on the happy path.
  const result = runGate({
    responses: [{ stdout: ALLOWLISTED_REPORT, status: 1 }],
    allowlist: ALLOWLIST,
  });
  assert.equal(result.status, 0);
  assert.equal(result.attempts, 1);
  assert.doesNotMatch(result.stderr, /retrying/);
});

test('cli: every attempt bounds the subprocess as well as each request', () => {
  const result = runGate({
    responses: [{ stdout: QUICK_ENDPOINT_FAILURE, status: 1 }],
  });
  assert.equal(result.attempts, 3);
  for (const argv of result.argv) {
    assert.match(argv, /--fetch-timeout=60000/);
    assert.match(argv, /^audit --package-lock-only --json\b/);
  }
  for (const options of result.spawns) {
    assert.equal(options.timeout, 60000);
    assert.equal(options.killSignal, 'SIGKILL');
  }
});

test('cli: a timed-out partial report is retried before accepting a report', () => {
  const result = runGate({
    timeouts: 1,
    stdout: ALLOWLISTED_REPORT,
    allowlist: ALLOWLIST,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.attempts, 2);
  assert.equal(result.argv.length, 1);
  assert.match(result.stderr, /retrying \(attempt 2 of 3\)/);
  assert.match(result.stdout, /audit-gate: ok/);
});

test('cli: exhausted deadlines fail closed with an explicit timeout', () => {
  const result = runGate({ timeouts: 3 });
  assert.equal(result.status, 1);
  assert.equal(result.attempts, 3);
  assert.equal(result.argv.length, 0);
  assert.match(result.stderr, /60000ms subprocess deadline/);
  assert.match(result.stderr, /ETIMEDOUT/);
  assert.doesNotMatch(result.stdout, /audit-gate: ok/);
});

test('cli: a missing npm is retried too, then reported as a spawn failure', () => {
  // ENOENT here is a stripped PATH, but the same arm catches a runner that
  // momentarily cannot fork. The spawn diagnostic must survive the retry
  // loop rather than collapsing into the generic no-report message.
  const result = runGate({ withNpm: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed to run npm audit/);
  assert.doesNotMatch(result.stderr, /did not return a report/);
});

// --- the OSV cross-check ---
//
// `npm audit` reports only what the npm registry's advisory endpoint serves,
// and an advisory it has no record for is absent from the report entirely
// rather than scored below the gate's threshold. The cases below drive the
// second data source that closes that gap. GHSA-g84c-rxfj-3j2c against
// webpack-dev-middleware 7.4.5 is the real instance it was built for: live in
// this lockfile while `npm audit` reported 0 high and 0 critical.

const WDM = 'GHSA-g84c-rxfj-3j2c';

/** @returns {object} an OSV record shaped like the GHSA records OSV serves */
function osvRecord(id, severity = 'HIGH', extra = {}) {
  return {
    id,
    aliases: [],
    database_specific: { severity },
    ...extra,
  };
}

/** @returns {object} a lockfile carrying one registry package */
function lockfileWith(name, version) {
  return {
    packages: { '': { name: 'site' }, [`node_modules/${name}`]: { version } },
  };
}

/** @returns {object} an OSV querybatch answer naming `ids` for one query */
function batchAnswer(...ids) {
  return { results: [{ vulns: ids.map((id) => ({ id })) }] };
}

// --- lockfileQueries ---

test('lockfileQueries names each installed registry package once', () => {
  const queries = lockfileQueries({
    packages: {
      'node_modules/b': { version: '2.0.0' },
      'node_modules/a': { version: '1.0.0' },
      'node_modules/b/node_modules/a': { version: '1.0.0' },
      'node_modules/c/node_modules/a': { version: '1.5.0' },
    },
  });
  assert.deepEqual(queries, [
    { name: 'a', version: '1.0.0' },
    { name: 'a', version: '1.5.0' },
    { name: 'b', version: '2.0.0' },
  ]);
});

test('lockfileQueries skips the project, its workspaces and link entries', () => {
  // None of these come from the registry, so OSV has nothing to say about
  // them and asking would only widen the batch.
  assert.deepEqual(
    lockfileQueries({
      packages: {
        '': { name: 'site', version: '0.0.0' },
        docs: { version: '1.0.0' },
        'node_modules/docs': { resolved: 'docs', link: true },
        'node_modules/unresolved': {},
        'node_modules/blank': { version: '' },
      },
    }),
    [],
  );
});

test('lockfileQueries uses the registry name of an aliased install', () => {
  // `"left-pad": "npm:pad-left@2"` installs at node_modules/left-pad, but the
  // advisories are filed against pad-left, which is what npm records in
  // `name` and the only name OSV would match.
  assert.deepEqual(
    lockfileQueries({
      packages: {
        'node_modules/left-pad': { name: 'pad-left', version: '2.1.0' },
      },
    }),
    [{ name: 'pad-left', version: '2.1.0' }],
  );
});

test('lockfileQueries treats a lockfile with no packages key as empty', () => {
  assert.deepEqual(lockfileQueries({}), []);
});

// --- osvAdvisoryId ---

test('osvAdvisoryId keeps a GHSA id as it stands', () => {
  assert.equal(osvAdvisoryId(osvRecord(WDM)), WDM);
});

test('osvAdvisoryId prefers the GHSA alias of a non-GHSA record', () => {
  // OSV serves the same advisory under CVE and GHSA ids. npm names it by
  // GHSA, and so does the allowlist, so only the alias can match either.
  const record = osvRecord('CVE-2026-12345');
  record.aliases = ['CVE-2026-12345', WDM];
  assert.equal(osvAdvisoryId(record), WDM);
});

test('osvAdvisoryId falls back to an id that can never be allowlisted', () => {
  // A malicious-package report has no GHSA at all. Keeping its own id means
  // the allowlist cannot silently cover it, so it fails closed.
  assert.equal(osvAdvisoryId({ id: 'MAL-2026-1' }), 'MAL-2026-1');
  assert.equal(osvAdvisoryId({}), 'advisory:unknown');
});

// --- osvSeverity ---

test('osvSeverity reads a GHSA severity in the npm vocabulary', () => {
  assert.equal(osvSeverity(osvRecord(WDM, 'HIGH')), 'high');
  assert.equal(osvSeverity(osvRecord(WDM, 'MODERATE')), 'moderate');
});

test('osvSeverity reports a record that declares none as unknown', () => {
  assert.equal(osvSeverity({ id: 'MAL-2026-1' }), 'unknown');
  assert.equal(osvSeverity({ id: 'x', database_specific: {} }), 'unknown');
});

// --- osvIdsNeedingLookup ---

test('osvIdsNeedingLookup skips GHSA ids the npm report already reaches', () => {
  // The npm arm owns those outright: it has already applied the allowlist and
  // both hygiene checks to them, so re-deciding them here could only disagree.
  const report = {
    vulnerabilities: { braces: entry('high', [advisory(BRACES)]) },
  };
  assert.deepEqual(osvIdsNeedingLookup([BRACES, WDM], report), [WDM]);
});

test('osvIdsNeedingLookup skips an allowlisted GHSA id', () => {
  assert.deepEqual(
    osvIdsNeedingLookup([BRACES, WDM], { vulnerabilities: {} }, ALLOWLIST),
    [WDM],
  );
});

test('osvIdsNeedingLookup always fetches a non-GHSA id', () => {
  // Its GHSA alias lives in the record, so nothing can be decided without it
  // — an allowlisted advisory reached through its CVE id would otherwise look
  // like a new finding.
  assert.deepEqual(
    osvIdsNeedingLookup(['CVE-2026-1', 'MAL-2026-1'], { vulnerabilities: {} }),
    ['CVE-2026-1', 'MAL-2026-1'],
  );
});

// --- classifyOsv ---

const CLEAN_REPORT = { vulnerabilities: {} };

test('classifyOsv blocks a high advisory npm never reported', () => {
  assert.deepEqual(
    classifyOsv(
      new Map([[WDM, ['webpack-dev-middleware@7.4.5']]]),
      new Map([[WDM, osvRecord(WDM)]]),
      CLEAN_REPORT,
    ),
    [{ id: WDM, package: 'webpack-dev-middleware@7.4.5', severity: 'high' }],
  );
});

test('classifyOsv names every package version an advisory was reported against', () => {
  assert.deepEqual(
    classifyOsv(
      new Map([[WDM, ['wdm@7.4.4', 'wdm@7.4.5']]]),
      new Map([[WDM, osvRecord(WDM, 'CRITICAL')]]),
      CLEAN_REPORT,
    ).map((item) => item.package),
    ['wdm@7.4.4', 'wdm@7.4.5'],
  );
});

test('classifyOsv ignores an id whose record was never fetched', () => {
  // osvIdsNeedingLookup() already resolved it against the npm report or the
  // allowlist; an absent record is that decision, not a missing one.
  assert.deepEqual(
    classifyOsv(new Map([[BRACES, ['braces@3.0.3']]]), new Map(), CLEAN_REPORT),
    [],
  );
});

test('classifyOsv ignores a withdrawn record', () => {
  // OSV keeps withdrawn advisories addressable. Gating on one would red the
  // build over a finding its own database has retracted.
  assert.deepEqual(
    classifyOsv(
      new Map([[WDM, ['wdm@7.4.5']]]),
      new Map([
        [WDM, osvRecord(WDM, 'HIGH', { withdrawn: '2026-10-01T00:00:00Z' })],
      ]),
      CLEAN_REPORT,
    ),
    [],
  );
});

test('classifyOsv ignores a moderate or low advisory', () => {
  // The arm mirrors `npm audit --audit-level=high`; a second data source must
  // not quietly become a stricter gate.
  assert.deepEqual(
    classifyOsv(
      new Map([[WDM, ['wdm@7.4.5']]]),
      new Map([[WDM, osvRecord(WDM, 'MODERATE')]]),
      CLEAN_REPORT,
    ),
    [],
  );
});

test('classifyOsv blocks a record that declares no severity', () => {
  // A `MAL-` malicious-package report carries no severity. Reading that as
  // "below the threshold" is the failure this whole arm exists to prevent.
  assert.deepEqual(
    classifyOsv(
      new Map([['MAL-2026-1', ['evil@1.0.0']]]),
      new Map([['MAL-2026-1', { id: 'MAL-2026-1' }]]),
      CLEAN_REPORT,
    ),
    [{ id: 'MAL-2026-1', package: 'evil@1.0.0', severity: 'unknown' }],
  );
});

test('classifyOsv resolves a CVE-keyed record to its GHSA before deciding', () => {
  // Reached through the CVE id, so the record had to be fetched; the npm
  // report names the same advisory by GHSA, and the two must not double-report.
  const record = osvRecord('CVE-2026-12345');
  record.aliases = [BRACES];
  const report = {
    vulnerabilities: { braces: entry('high', [advisory(BRACES)]) },
  };
  assert.deepEqual(
    classifyOsv(
      new Map([['CVE-2026-12345', ['braces@3.0.3']]]),
      new Map([['CVE-2026-12345', record]]),
      report,
    ),
    [],
  );
});

test('classifyOsv honours the allowlist through a GHSA alias', () => {
  const record = osvRecord('CVE-2026-12345');
  record.aliases = [BRACES];
  assert.deepEqual(
    classifyOsv(
      new Map([['CVE-2026-12345', ['braces@3.0.3']]]),
      new Map([['CVE-2026-12345', record]]),
      CLEAN_REPORT,
      ALLOWLIST,
    ),
    [],
  );
});

// --- the OSV arm end to end ---

const EMPTY_AUDIT = JSON.stringify({ vulnerabilities: {} });

test('cli: fails on the advisory npm audit cannot see', () => {
  // The regression this arm was built for, reproduced end to end: npm reports
  // a completely clean audit and the gate still goes red.
  const result = runGate({
    stdout: EMPTY_AUDIT,
    lockfile: lockfileWith('webpack-dev-middleware', '7.4.5'),
    osv: [{ body: batchAnswer(WDM) }, { body: osvRecord(WDM) }],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /reported by OSV and not by npm audit/);
  assert.match(
    result.stderr,
    new RegExp(`webpack-dev-middleware@7\\.4\\.5 \\(high\\): ${WDM}`),
  );
  assert.match(result.stderr, /raising its threshold cannot catch them/);
  assert.doesNotMatch(result.stdout, /audit-gate: ok/);
});

test('cli: passes once the package is upgraded past the advisory', () => {
  const result = runGate({
    stdout: EMPTY_AUDIT,
    lockfile: lockfileWith('webpack-dev-middleware', '7.4.6'),
    osv: [{ body: { results: [{}] } }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /OSV cross-check clean across 1 lockfile package/,
  );
});

test('cli: asks OSV about the lockfile and looks up only unresolved ids', () => {
  const result = runGate({
    stdout: EMPTY_AUDIT,
    lockfile: lockfileWith('webpack-dev-middleware', '7.4.5'),
    osv: [{ body: batchAnswer(WDM) }, { body: osvRecord(WDM, 'MODERATE') }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.osv.length, 2);
  assert.equal(result.osv[0].url, 'https://api.osv.dev/v1/querybatch');
  assert.equal(result.osv[0].method, 'POST');
  assert.deepEqual(JSON.parse(result.osv[0].body), {
    queries: [
      {
        package: { name: 'webpack-dev-middleware', ecosystem: 'npm' },
        version: '7.4.5',
      },
    ],
  });
  assert.equal(result.osv[1].url, `https://api.osv.dev/v1/vulns/${WDM}`);
  assert.equal(result.osv[1].method, 'GET');
  assert.equal(result.osv[1].body, null);
});

test('cli: a clean lockfile costs no OSV request at all', () => {
  const result = runGate({ stdout: EMPTY_AUDIT });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.osv, []);
  assert.match(
    result.stdout,
    /OSV cross-check clean across 0 lockfile package/,
  );
});

test('cli: an advisory npm already reports is not looked up again', () => {
  // npm has it, so the npm arm decided it; a second request could only cost a
  // round trip and risk the two arms disagreeing.
  const report = {
    vulnerabilities: { braces: entry('high', [advisory(BRACES)]) },
  };
  const result = runGate({
    stdout: JSON.stringify(report),
    status: '1',
    lockfile: lockfileWith('braces', '3.0.3'),
    osv: [{ body: batchAnswer(BRACES) }],
    allowlist: ALLOWLIST,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.osv.length, 1);
});

test('cli: splits the lockfile into batches of 500', () => {
  // One oversized body is a request nobody can retry cheaply, and a truncated
  // answer would silently drop whatever fell off the end.
  const packages = {};
  for (let index = 0; index < 501; index += 1) {
    packages[`node_modules/p${index}`] = { version: '1.0.0' };
  }
  const result = runGate({
    stdout: EMPTY_AUDIT,
    lockfile: { packages },
    osv: [
      { body: { results: Array.from({ length: 500 }, () => ({})) } },
      { body: { results: [{}] } },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.osv.length, 2);
  assert.equal(JSON.parse(result.osv[0].body).queries.length, 500);
  assert.equal(JSON.parse(result.osv[1].body).queries.length, 1);
  assert.match(result.stdout, /clean across 501 lockfile package/);
});

test('cli: an unidentified vuln in the answer is skipped', () => {
  const result = runGate({
    stdout: EMPTY_AUDIT,
    lockfile: lockfileWith('braces', '3.0.3'),
    osv: [{ body: { results: [{ vulns: [{}] }] } }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.osv.length, 1);
});

test('cli: fails closed when the lockfile cannot be read', () => {
  // A skipped cross-check is not a clean one: npm reporting nothing is
  // exactly what this arm refuses to accept as evidence of nothing.
  const result = runGate({ stdout: EMPTY_AUDIT, lockfile: null });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not read package-lock\.json/);
  assert.match(result.stderr, /a skipped cross-check is not a clean one/);
  assert.doesNotMatch(result.stdout, /audit-gate: ok/);
});

test('cli: fails closed when OSV answers a result count it cannot align', () => {
  // `results` is positional, so a short answer makes every id ambiguous.
  const result = runGate({
    stdout: EMPTY_AUDIT,
    lockfile: lockfileWith('braces', '3.0.3'),
    osv: [{ body: { results: [] } }],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /answered 0 result\(s\) for 1 quer\(ies\)/);
  assert.match(result.stderr, /did not complete/);
});

test('cli: fails closed when OSV answers no results array at all', () => {
  const result = runGate({
    stdout: EMPTY_AUDIT,
    lockfile: lockfileWith('braces', '3.0.3'),
    osv: [{ body: { error: 'nope' } }],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /answered no result\(s\) for 1 quer\(ies\)/);
});

test('cli: fails closed on an HTTP error from OSV', () => {
  const result = runGate({
    stdout: EMPTY_AUDIT,
    lockfile: lockfileWith('braces', '3.0.3'),
    osv: [{ status: 503 }],
  });
  assert.equal(result.status, 1);
  assert.equal(result.osv.length, 3);
  assert.match(result.stderr, /answered HTTP 503/);
  assert.match(result.stderr, /failed in 3 attempts/);
  assert.match(
    result.stderr,
    /the advisories only OSV carries are exactly the ones npm audit cannot report/,
  );
});

test('cli: a transient OSV fault is retried and the next answer decides', () => {
  // The gate must not red every open PR over one dropped connection, and it
  // must not pass over one either.
  const result = runGate({
    stdout: EMPTY_AUDIT,
    lockfile: lockfileWith('webpack-dev-middleware', '7.4.5'),
    osv: [
      { networkError: 'ECONNRESET' },
      { body: batchAnswer(WDM) },
      { body: osvRecord(WDM) },
    ],
  });
  assert.equal(result.status, 1);
  assert.equal(result.osv.length, 3);
  assert.match(result.stderr, /OSV querybatch failed \(Error: ECONNRESET\)/);
  assert.match(result.stderr, /retrying \(attempt 2 of 3\)/);
  assert.match(result.stderr, new RegExp(WDM));
});

test('cli: a failing record lookup is retried and then fails closed', () => {
  // The querybatch succeeded, so an advisory is known to exist; giving up on
  // its record and passing would be the blind spot all over again.
  const result = runGate({
    stdout: EMPTY_AUDIT,
    lockfile: lockfileWith('webpack-dev-middleware', '7.4.5'),
    osv: [{ body: batchAnswer(WDM) }, { networkError: 'ETIMEDOUT' }],
  });
  assert.equal(result.status, 1);
  assert.equal(result.osv.length, 4);
  assert.match(result.stderr, new RegExp(`OSV lookup of ${WDM} failed`));
  assert.match(result.stderr, /failed in 3 attempts/);
  assert.doesNotMatch(result.stdout, /audit-gate: ok/);
});
