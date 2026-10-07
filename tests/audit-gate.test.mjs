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
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ALLOWLISTED_ADVISORIES,
  advisoryId,
  classifyAudit,
} from '../scripts/audit-gate.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const BRACES = 'GHSA-vfj7-8cjw-p6xm';
const NEW_BAD = 'GHSA-aaaa-bbbb-cccc';

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
  const { blocked, allowlisted } = classifyAudit(report);
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
  const { blocked, allowlisted } = classifyAudit(report);
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
  const clean = classifyAudit({
    vulnerabilities: {
      a: entry('high', [advisory(BRACES), 'b']),
      b: entry('high', ['a']),
    },
  });
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

// --- CLI entry, with npm stubbed ---

// Stub placed first on PATH so the script under test never reaches the real
// npm or the network. It prints a canned report and exits with a canned
// status, mirroring tests/helpers-gh-sandbox.mjs.
const NPM_STUB = `#!/usr/bin/env node
process.stdout.write(process.env.AUDIT_STUB_STDOUT ?? '');
process.exit(Number(process.env.AUDIT_STUB_STATUS ?? '0'));
`;

/**
 * Runs scripts/audit-gate.mjs in a sandbox that mirrors the repo layout
 * (so coverage maps back to the real source) with `npm` stubbed.
 *
 * @param {object} options
 * @param {string} [options.stdout] what the npm stub prints
 * @param {string} [options.status] the npm stub's exit code
 * @param {boolean} [options.withNpm] install the stub at all; false makes
 *   spawnSync fail with ENOENT to exercise the spawn-error arm
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function runGate({ stdout = '', status = '0', withNpm = true } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-audit-'));
  try {
    const script = join(work, 'scripts', 'audit-gate.mjs');
    mkdirSync(dirname(script), { recursive: true });
    cpSync(join(repoRoot, 'scripts', 'audit-gate.mjs'), script);

    const binDir = join(work, '.bin');
    mkdirSync(binDir, { recursive: true });
    // The stub's shebang (and nothing else on the stripped PATH) needs node.
    symlinkSync(process.execPath, join(binDir, 'node'));
    if (withNpm) {
      const stub = join(binDir, 'npm');
      writeFileSync(stub, NPM_STUB);
      chmodSync(stub, 0o755);
    }

    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: binDir,
        AUDIT_STUB_STDOUT: stdout,
        AUDIT_STUB_STATUS: status,
      },
    });
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test('cli: exits 0 on a clean report', () => {
  const result = runGate({
    stdout: JSON.stringify({ vulnerabilities: {} }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /audit-gate: ok/);
});

test('cli: exits 0 when every finding is allowlisted, despite npm exiting 1', () => {
  const report = {
    vulnerabilities: {
      braces: entry('high', [advisory(BRACES)]),
      micromatch: entry('high', ['braces']),
    },
  };
  const result = runGate({ stdout: JSON.stringify(report), status: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 high\/critical finding/);
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
