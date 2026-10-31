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
  unusedAllowlistEntries,
  fixableAllowlistedAdvisories,
  inRangeFixableAdvisories,
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

// --- inRangeFixableAdvisories ---

/** @returns {object} a below-threshold entry carrying one advisory */
function lowEntry(
  fixAvailable,
  severity = 'low',
  via = [advisory(NEW_BAD, severity)],
) {
  return { severity, via, range: '<7.1.3', nodes: [], fixAvailable };
}

test('inRangeFixableAdvisories names a low advisory npm can fix in range', () => {
  // The shape that slipped past the gate before: an override floor satisfied by a still-vulnerable
  // release, with the patched one inside the same caret.
  const report = {
    vulnerabilities: { 'serialize-javascript': lowEntry(true) },
  };
  assert.deepEqual(inRangeFixableAdvisories(report, ALLOWLIST), [
    {
      name: 'serialize-javascript',
      severity: 'low',
      advisories: [NEW_BAD],
      fixAvailable: true,
    },
  ]);
});

test('inRangeFixableAdvisories accepts a non-major fix object and keeps it for the log', () => {
  const fix = { name: 'fast-uri', version: '3.1.9', isSemVerMajor: false };
  const report = {
    vulnerabilities: { 'fast-uri': lowEntry(fix, 'moderate') },
  };
  const [item] = inRangeFixableAdvisories(report, ALLOWLIST);
  assert.equal(item.severity, 'moderate');
  assert.equal(item.fixAvailable, fix);
});

test('inRangeFixableAdvisories leaves unfixable and semver-major findings alone', () => {
  // Both need a human decision; the severity threshold defers them on
  // purpose and this check must not undo that.
  const report = {
    vulnerabilities: {
      stuck: lowEntry(false),
      major: lowEntry({ name: 'major', version: '2.0.0', isSemVerMajor: true }),
    },
  };
  assert.deepEqual(inRangeFixableAdvisories(report, ALLOWLIST), []);
});

test('inRangeFixableAdvisories ignores high and critical entries', () => {
  // Those block through classifyAudit whatever their fix status; reporting
  // them twice would bury the stronger message.
  const report = {
    vulnerabilities: {
      bad: { ...lowEntry(true), severity: 'high' },
      worse: { ...lowEntry(true), severity: 'critical' },
    },
  };
  assert.deepEqual(inRangeFixableAdvisories(report, ALLOWLIST), []);
});

test('inRangeFixableAdvisories reports only the carrier, not packages that inherit', () => {
  const report = {
    vulnerabilities: {
      'serialize-javascript': lowEntry(true),
      'copy-webpack-plugin': lowEntry(true, 'low', ['serialize-javascript']),
    },
  };
  assert.deepEqual(
    inRangeFixableAdvisories(report, ALLOWLIST).map((f) => f.name),
    ['serialize-javascript'],
  );
});

test('inRangeFixableAdvisories excludes allowlisted advisories', () => {
  // fixableAllowlistedAdvisories owns that case and its removal instructions.
  const report = {
    vulnerabilities: {
      braces: lowEntry(true, 'low', [advisory(BRACES, 'low')]),
      both: lowEntry(true, 'low', [
        advisory(BRACES, 'low'),
        advisory(NEW_BAD, 'low'),
      ]),
    },
  };
  assert.deepEqual(inRangeFixableAdvisories(report, ALLOWLIST), [
    {
      name: 'both',
      severity: 'low',
      advisories: [NEW_BAD],
      fixAvailable: true,
    },
  ]);
});

test('inRangeFixableAdvisories sorts the advisory ids of one entry', () => {
  const report = {
    vulnerabilities: {
      dep: lowEntry(true, 'low', [
        advisory('GHSA-zzzz-zzzz-zzzz', 'low'),
        advisory(NEW_BAD, 'low'),
      ]),
    },
  };
  assert.deepEqual(inRangeFixableAdvisories(report, ALLOWLIST)[0].advisories, [
    NEW_BAD,
    'GHSA-zzzz-zzzz-zzzz',
  ]);
});

test('inRangeFixableAdvisories sorts by package and tolerates bare reports', () => {
  const report = {
    vulnerabilities: {
      zeta: lowEntry(true),
      alpha: lowEntry(true),
      bare: { severity: 'low', fixAvailable: true },
    },
  };
  assert.deepEqual(
    inRangeFixableAdvisories(report, ALLOWLIST).map((f) => f.name),
    ['alpha', 'zeta'],
  );
  assert.deepEqual(inRangeFixableAdvisories({}, ALLOWLIST), []);
});

test('inRangeFixableAdvisories defaults to the shipped allowlist', () => {
  const report = { vulnerabilities: { dep: lowEntry(true) } };
  assert.equal(inRangeFixableAdvisories(report).length, 1);
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
//
// A step may also carry `lockfile`, which the stub writes to
// package-lock.json in its working directory: that is how a test decides what
// the gate's scratch `npm audit fix` run "moved". The argv line records the
// working directory and whether an .npmrc was copied beside the lockfile, so
// a test can check the scratch copy is complete and is not the project tree.
const NPM_STUB = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
const log = process.env.AUDIT_STUB_ARGV;
const responses = JSON.parse(process.env.AUDIT_STUB_RESPONSES);
let seen = 0;
try {
  seen = readFileSync(log, 'utf8').split('\\n').filter(Boolean).length;
} catch {}
const marks = [];
if (process.argv[3] === 'fix') {
  marks.push('cwd=' + process.cwd());
  if (existsSync('.npmrc')) marks.push('npmrc');
}
appendFileSync(log, [...process.argv.slice(2), ...marks].join(' ') + '\\n');
const step = responses[Math.min(seen, responses.length - 1)];
if (step.lockfile !== undefined) {
  writeFileSync('package-lock.json', JSON.stringify(step.lockfile));
}
process.stdout.write(step.stdout);
process.exit(step.status);
`;

// Capture the actual CLI's subprocess options and synthesize deadline errors
// without making the suite wait a minute for each timed-out attempt.
// AUDIT_STUB_FIX_TIMEOUT times out the scratch `npm audit fix` run instead,
// which the gate does not retry.
const SPAWN_PRELOAD = `import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const spawn = childProcess.spawnSync;
let timeouts = Number(process.env.AUDIT_STUB_TIMEOUTS);
const fixTimeout = process.env.AUDIT_STUB_FIX_TIMEOUT === '1';
childProcess.spawnSync = (command, args, options) => {
  appendFileSync(process.env.AUDIT_STUB_SPAWNS, JSON.stringify({
    timeout: options.timeout,
    killSignal: options.killSignal,
  }) + '\\n');
  const isFix = args[1] === 'fix';
  if ((isFix && fixTimeout) || (!isFix && timeouts > 0)) {
    if (!isFix) timeouts -= 1;
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
 * @param {boolean} [options.fixTimeout] deadline error on the scratch
 *   `npm audit fix` run
 * @param {object} [options.lockfile] package-lock.json to place in the
 *   sandbox the gate runs in (with a minimal package.json beside it); omitted,
 *   the sandbox has no lockfile at all
 * @param {string} [options.npmrc] an .npmrc to place beside the lockfile
 * @param {Iterable<string>} [options.allowlist] GHSA ids to run the gate
 *   with, through a wrapper entry that calls main(); omitted, the script runs
 *   as the CLI does with its shipped allowlist
 * @returns {{status: number, stdout: string, stderr: string,
 *   attempts: number, argv: string[], spawns: object[], work: string}} `argv`
 *   holds the invocations that reached npm; `spawns` includes timed-out
 *   attempts; `work` is the (since removed) sandbox the gate ran in.
 */
function runGate({
  stdout = '',
  status = '0',
  responses,
  withNpm = true,
  timeouts = 0,
  fixTimeout = false,
  lockfile,
  npmrc,
  allowlist,
} = {}) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-audit-'));
  try {
    const script = join(work, 'scripts', 'audit-gate.mjs');
    mkdirSync(dirname(script), { recursive: true });
    cpSync(join(repoRoot, 'scripts', 'audit-gate.mjs'), script);
    if (lockfile) {
      writeFileSync(join(work, 'package.json'), '{"name":"sandbox"}\n');
      writeFileSync(join(work, 'package-lock.json'), JSON.stringify(lockfile));
    }
    if (npmrc) writeFileSync(join(work, '.npmrc'), npmrc);

    let entrypoint = script;
    if (allowlist) {
      entrypoint = join(work, 'run-gate.mjs');
      writeFileSync(
        entrypoint,
        `import { main } from './scripts/audit-gate.mjs';\n` +
          `main(new Set(${JSON.stringify([...allowlist])}));\n`,
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
    const preload = join(work, 'spawn-preload.mjs');
    writeFileSync(preload, SPAWN_PRELOAD);
    const result = spawnSync(
      process.execPath,
      ['--import', preload, entrypoint],
      {
        cwd: work,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: binDir,
          AUDIT_STUB_ARGV: argvLog,
          AUDIT_STUB_SPAWNS: spawnLog,
          AUDIT_STUB_TIMEOUTS: String(timeouts),
          AUDIT_STUB_FIX_TIMEOUT: fixTimeout ? '1' : '0',
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
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      attempts: spawns.length,
      argv,
      spawns,
      work,
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

// --- in-range fixes, confirmed against a scratch `npm audit fix` ---

// The lockfile the sandbox starts from. `serialize-javascript` is nested
// under a parent as well as hoisted, so a test can show that every depth is
// compared, not just the top-level entry.
const LOCK_BEFORE = {
  packages: {
    '': { name: 'sandbox' },
    'node_modules/serialize-javascript': { version: '7.1.2' },
    'node_modules/parent': { version: '1.0.0' },
    'node_modules/parent/node_modules/serialize-javascript': {
      version: '7.1.2',
    },
    'node_modules/deepmerge': { version: '4.3.1' },
  },
};

/** @returns {object} LOCK_BEFORE with the given package entries replaced */
function lockAfter(changes) {
  const packages = { ...LOCK_BEFORE.packages };
  for (const [path, pkg] of Object.entries(changes)) {
    if (pkg === null) delete packages[path];
    else packages[path] = pkg;
  }
  return { packages };
}

// What a completed `npm audit fix --json` prints: the post-fix audit report,
// with npm exiting 1 because advisories remain.
const FIX_COMPLETED = {
  stdout: JSON.stringify({
    added: 0,
    removed: 0,
    changed: 0,
    audit: { vulnerabilities: {} },
  }),
  status: 1,
};

const IN_RANGE_REPORT = JSON.stringify({
  vulnerabilities: {
    'serialize-javascript': lowEntry({
      name: 'serialize-javascript',
      version: '7.1.3',
      isSemVerMajor: false,
    }),
  },
});

test('cli: exits 1 when a low advisory is fixable in range and the fix moves the package', () => {
  const result = runGate({
    responses: [
      { stdout: IN_RANGE_REPORT, status: 1 },
      {
        ...FIX_COMPLETED,
        lockfile: lockAfter({
          'node_modules/serialize-javascript': { version: '7.1.3' },
        }),
      },
    ],
    lockfile: LOCK_BEFORE,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /moderate\/low advisories npm can fix/);
  assert.match(
    result.stderr,
    new RegExp(
      `serialize-javascript \\(low\\): ${NEW_BAD} — upgrade to serialize-javascript@7\\.1\\.3`,
    ),
  );
  assert.match(result.stderr, /npm audit fix --package-lock-only/);
  assert.doesNotMatch(result.stderr, /warning/);
  assert.doesNotMatch(result.stdout, /audit-gate: ok/);
});

test('cli: the scratch fix runs on a copy of the project files, never the project tree', () => {
  const result = runGate({
    responses: [
      { stdout: IN_RANGE_REPORT, status: 1 },
      { ...FIX_COMPLETED, lockfile: LOCK_BEFORE },
    ],
    lockfile: LOCK_BEFORE,
    npmrc: 'fund=false\n',
  });
  assert.equal(result.argv.length, 2);
  const [, fix] = result.argv;
  assert.match(
    fix,
    /^audit fix --package-lock-only --ignore-scripts --no-fund --json --fetch-timeout=60000 cwd=/,
  );
  const cwd = /cwd=(\S+)/.exec(fix)[1];
  assert.notEqual(cwd, result.work);
  assert.match(cwd, /audit-gate-fix-/);
  assert.ok(!existsSync(cwd), 'the scratch copy is removed afterwards');
  assert.match(fix, / npmrc$/, 'the .npmrc travels with the lockfile');
  for (const options of result.spawns) {
    assert.equal(options.timeout, 60000);
    assert.equal(options.killSignal, 'SIGKILL');
  }
});

test('cli: exits 0 with a warning when the reported fix leaves the package where it is', () => {
  // npm 10 reports deepmerge's GHSA-gcqx-w48m-w2h4 as fixable although every
  // published release sits inside the vulnerable range. `npm audit fix`
  // moves nothing, so the finding cannot be acted on and must not red the
  // gate; it is named in the log so the phantom is visible, not hidden.
  const report = JSON.stringify({
    vulnerabilities: { deepmerge: lowEntry(true) },
  });
  const result = runGate({
    responses: [
      { stdout: report, status: 1 },
      { ...FIX_COMPLETED, lockfile: LOCK_BEFORE },
    ],
    lockfile: LOCK_BEFORE,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stderr,
    new RegExp(
      `warning — deepmerge \\(low\\): ${NEW_BAD} is reported as fixable`,
    ),
  );
  assert.match(result.stderr, /leaves its locked version unchanged/);
  assert.doesNotMatch(result.stderr, /moderate\/low advisories npm can fix/);
  assert.match(result.stdout, /audit-gate: ok/);
});

test('cli: a nested copy moving counts as a real fix', () => {
  const result = runGate({
    responses: [
      { stdout: IN_RANGE_REPORT, status: 1 },
      {
        ...FIX_COMPLETED,
        lockfile: lockAfter({
          'node_modules/parent/node_modules/serialize-javascript': {
            version: '7.1.3',
          },
        }),
      },
    ],
    lockfile: LOCK_BEFORE,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /moderate\/low advisories npm can fix/);
});

test('cli: a fix that removes the package altogether counts as real', () => {
  const result = runGate({
    responses: [
      { stdout: IN_RANGE_REPORT, status: 1 },
      {
        ...FIX_COMPLETED,
        lockfile: lockAfter({
          'node_modules/serialize-javascript': null,
          'node_modules/parent/node_modules/serialize-javascript': null,
        }),
      },
    ],
    lockfile: LOCK_BEFORE,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /moderate\/low advisories npm can fix/);
});

test('cli: lists only the confirmed fixes and warns about the phantom ones', () => {
  const report = JSON.stringify({
    vulnerabilities: {
      deepmerge: lowEntry(true),
      'serialize-javascript': lowEntry(true, 'moderate'),
    },
  });
  const result = runGate({
    responses: [
      { stdout: report, status: 1 },
      {
        ...FIX_COMPLETED,
        lockfile: lockAfter({
          'node_modules/serialize-javascript': { version: '7.1.3' },
          'node_modules/parent/node_modules/serialize-javascript': {
            version: '7.1.3',
          },
        }),
      },
    ],
    lockfile: LOCK_BEFORE,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /warning — deepmerge \(low\)/);
  assert.match(result.stderr, /^ {2}serialize-javascript \(moderate\)/m);
  assert.doesNotMatch(result.stderr, /^ {2}deepmerge/m);
});

test('cli: a lockfile without a packages map, or a version-less link entry, compares as absent', () => {
  // A v1 lockfile has `dependencies` rather than `packages`, and a workspace
  // link entry has no `version`; neither can show a move, so the finding is
  // treated as a phantom rather than crashing the comparison.
  const result = runGate({
    responses: [
      { stdout: IN_RANGE_REPORT, status: 1 },
      {
        ...FIX_COMPLETED,
        lockfile: {
          packages: {
            'node_modules/serialize-javascript': { link: true },
          },
        },
      },
    ],
    lockfile: { lockfileVersion: 1, dependencies: {} },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning — serialize-javascript \(low\)/);
});

test('cli: fails closed when the scratch fix reports an npm error document', () => {
  const result = runGate({
    responses: [
      { stdout: IN_RANGE_REPORT, status: 1 },
      { stdout: QUICK_ENDPOINT_FAILURE, status: 1 },
    ],
    lockfile: LOCK_BEFORE,
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /could not confirm the reported fixes \(npm audit fix did not complete \(exit code 1\)/,
  );
  assert.match(result.stderr, /treating each as real/);
  assert.match(result.stderr, /moderate\/low advisories npm can fix/);
  assert.equal(result.argv.length, 2, 'the scratch fix is not retried');
});

test('cli: fails closed when the scratch fix prints no JSON', () => {
  const result = runGate({
    responses: [
      { stdout: IN_RANGE_REPORT, status: 1 },
      { stdout: 'npm ERR! something', status: 1 },
    ],
    lockfile: LOCK_BEFORE,
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /could not confirm the reported fixes \(npm audit fix did not produce parseable JSON/,
  );
  assert.match(result.stderr, /moderate\/low advisories npm can fix/);
});

test('cli: fails closed when the scratch fix hits its deadline', () => {
  const result = runGate({
    stdout: IN_RANGE_REPORT,
    status: '1',
    fixTimeout: true,
    lockfile: LOCK_BEFORE,
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /could not confirm the reported fixes \(npm audit fix did not run: .*ETIMEDOUT/,
  );
  assert.match(result.stderr, /moderate\/low advisories npm can fix/);
  assert.equal(result.argv.length, 1);
});

test('cli: fails closed when there is no lockfile to compare against', () => {
  const result = runGate({ stdout: IN_RANGE_REPORT, status: '1' });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /could not confirm the reported fixes \(cannot read .*package-lock\.json/,
  );
  assert.match(result.stderr, /moderate\/low advisories npm can fix/);
  assert.equal(result.argv.length, 1, 'nothing to copy, so npm is not asked');
});

test('cli: exits 0 when the only low advisory needs a semver-major upgrade', () => {
  const report = {
    vulnerabilities: {
      stuck: lowEntry({ name: 'stuck', version: '2.0.0', isSemVerMajor: true }),
    },
  };
  const result = runGate({ stdout: JSON.stringify(report), status: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /audit-gate: ok/);
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
