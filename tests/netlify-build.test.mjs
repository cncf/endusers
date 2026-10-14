// Pins scripts/netlify-build.mjs, the entry point netlify.toml runs (ADR 0005).
//
// Two behaviors matter and neither is visible from a green deploy. The
// SITE_URL resolver decides what canonical and Open Graph URLs every page
// carries: a wrong branch here publishes a preview that claims to be
// production, or production that claims to be a preview, and nothing else in
// the suite reads Netlify's CONTEXT/URL/DEPLOY_PRIME_URL variables. The step
// runner is the #755 gate: automation pull requests never start ci.yml, so
// "stop at the first failing validator" is what keeps bad data out of the
// published site, and a runner that carried on to the build would publish it.

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
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BUILD_STEPS,
  resolveSiteUrl,
  runBuild,
} from '../scripts/netlify-build.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const PRODUCTION_URL = 'https://endusers.netlify.app';
const PREVIEW_URL = 'https://deploy-preview-7--endusers.netlify.app';

test('an explicit SITE_URL wins over every Netlify variable', () => {
  assert.equal(
    resolveSiteUrl({
      SITE_URL: 'https://example.test',
      CONTEXT: 'production',
      URL: PRODUCTION_URL,
      DEPLOY_PRIME_URL: PREVIEW_URL,
    }),
    'https://example.test',
  );
});

test('production deploys use the site URL', () => {
  assert.equal(
    resolveSiteUrl({
      CONTEXT: 'production',
      URL: PRODUCTION_URL,
      DEPLOY_PRIME_URL: PREVIEW_URL,
    }),
    PRODUCTION_URL,
  );
});

test('deploy previews and branch deploys use the per-deploy URL', () => {
  for (const context of ['deploy-preview', 'branch-deploy']) {
    assert.equal(
      resolveSiteUrl({
        CONTEXT: context,
        URL: PRODUCTION_URL,
        DEPLOY_PRIME_URL: PREVIEW_URL,
      }),
      PREVIEW_URL,
      context,
    );
  }
});

test('outside Netlify the config default is left in place', () => {
  assert.equal(resolveSiteUrl({}), undefined);
  // A context without its URL variable is not guessed at either.
  assert.equal(resolveSiteUrl({ CONTEXT: 'production' }), undefined);
  assert.equal(resolveSiteUrl({ CONTEXT: 'deploy-preview' }), undefined);
  // An unknown context never borrows the production URL.
  assert.equal(
    resolveSiteUrl({ CONTEXT: 'something-else', URL: PRODUCTION_URL }),
    undefined,
  );
});

test('the build validates before it builds', () => {
  const targets = BUILD_STEPS.map(([command, args]) => {
    assert.equal(command, 'npm');
    assert.equal(args[0], 'run');
    return args[1];
  });
  assert.deepEqual(targets, ['validate:all', 'build:production']);
});

test('every step runs with the resolved SITE_URL when all succeed', () => {
  const calls = [];
  const status = runBuild(
    { CONTEXT: 'production', URL: PRODUCTION_URL },
    (command, args, env) => {
      calls.push({ command, args, siteUrl: env.SITE_URL });
      return 0;
    },
  );
  assert.equal(status, 0);
  assert.deepEqual(calls, [
    { command: 'npm', args: ['run', 'validate:all'], siteUrl: PRODUCTION_URL },
    {
      command: 'npm',
      args: ['run', 'build:production'],
      siteUrl: PRODUCTION_URL,
    },
  ]);
});

test('a failing validator stops the sequence before the build', () => {
  const calls = [];
  const status = runBuild({}, (command, args, env) => {
    calls.push(args[1]);
    assert.equal(env.SITE_URL, undefined);
    return args[1] === 'validate:all' ? 3 : 0;
  });
  assert.equal(status, 3);
  assert.deepEqual(calls, ['validate:all']);
});

// --- CLI entry, with npm stubbed ---

// Stub placed first on PATH so the script under test never runs the real
// validators or build. It appends each invocation (arguments and the SITE_URL
// it was handed) to a log and exits with the canned status for that target,
// mirroring tests/audit-gate.test.mjs.
const NPM_STUB = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
appendFileSync(
  process.env.NETLIFY_STUB_LOG,
  JSON.stringify({ args: process.argv.slice(2), siteUrl: process.env.SITE_URL }) + '\\n',
);
const failing = process.env.NETLIFY_STUB_FAIL;
if (failing && process.argv.includes(failing)) {
  if (process.env.NETLIFY_STUB_SIGNAL) process.kill(process.pid, 'SIGKILL');
  process.exit(2);
}
process.exit(0);
`;

/**
 * Runs scripts/netlify-build.mjs as netlify.toml would, in a sandbox that
 * mirrors the repo layout (so coverage maps back to the real source).
 *
 * @param {object} options
 * @param {Record<string, string>} [options.env] Netlify variables to set
 * @param {string} [options.fail] the npm target the stub fails
 * @param {boolean} [options.signal] make that failure a signal death rather
 *   than an exit code, so spawnSync reports a null status
 * @param {boolean} [options.withNpm] install the stub at all; false makes
 *   spawnSync fail with ENOENT to exercise the spawn-error arm
 */
function runCli({ env = {}, fail = '', signal = false, withNpm = true } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-netlify-'));
  try {
    const script = join(work, 'scripts', 'netlify-build.mjs');
    mkdirSync(dirname(script), { recursive: true });
    cpSync(join(repoRoot, 'scripts', 'netlify-build.mjs'), script);

    const binDir = join(work, '.bin');
    mkdirSync(binDir, { recursive: true });
    symlinkSync(process.execPath, join(binDir, 'node'));
    if (withNpm) {
      const stub = join(binDir, 'npm');
      writeFileSync(stub, NPM_STUB);
      chmodSync(stub, 0o755);
    }
    const log = join(work, 'calls.log');
    writeFileSync(log, '');

    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !['SITE_URL', 'CONTEXT', 'URL', 'DEPLOY_PRIME_URL'].includes(key),
      ),
    );
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...cleanEnv,
        ...env,
        PATH: binDir,
        NETLIFY_STUB_LOG: log,
        NETLIFY_STUB_FAIL: fail,
        NETLIFY_STUB_SIGNAL: signal ? '1' : '',
      },
    });
    const calls = readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { status: result.status, stderr: result.stderr ?? '', calls };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test('cli: a production deploy runs every step with SITE_URL set from URL', () => {
  const result = runCli({
    env: { CONTEXT: 'production', URL: PRODUCTION_URL },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    { args: ['run', 'validate:all'], siteUrl: PRODUCTION_URL },
    { args: ['run', 'build:production'], siteUrl: PRODUCTION_URL },
  ]);
});

test('cli: a failing validator fails the deploy and skips the build', () => {
  const result = runCli({
    env: { CONTEXT: 'deploy-preview', DEPLOY_PRIME_URL: PREVIEW_URL },
    fail: 'validate:all',
  });
  assert.equal(result.status, 2);
  assert.deepEqual(result.calls, [
    { args: ['run', 'validate:all'], siteUrl: PREVIEW_URL },
  ]);
});

test('cli: fails when npm cannot be spawned at all', () => {
  const result = runCli({ withNpm: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/);
  assert.deepEqual(result.calls, []);
});

test('cli: a step killed by a signal still fails the deploy', () => {
  // spawnSync reports no exit status for a signal death; treating that as
  // success would let an OOM-killed validator publish unvalidated data.
  const result = runCli({ fail: 'validate:all', signal: true });
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls, [{ args: ['run', 'validate:all'] }]);
});
