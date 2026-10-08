// Unit coverage for tests/tools/e2e-coverage-builds.mjs, the driver
// `npm run build:e2e:coverage:fixtures` runs.
//
// The compiles themselves are Docusaurus builds measured in minutes, so the
// in-process tests inject a spawn stub and assert the command, the derived
// output directory and base URL, and the stop-at-first-failure contract. The
// CLI tests run the real script with a stub `npm` first on PATH, so the
// entrypoint guard and the exit codes it forwards are exercised rather than
// described.

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { buildCommand, main } from './tools/e2e-coverage-builds.mjs';

const require = createRequire(import.meta.url);
const { coverageBuildNames } = require('./tools/e2e-data-fixtures.cjs');

const BUILDS_TOOL = fileURLToPath(
  new URL('./tools/e2e-coverage-builds.mjs', import.meta.url),
);
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function recordingSpawn(statuses = []) {
  const calls = [];
  let index = 0;
  return {
    calls,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      const status = index < statuses.length ? statuses[index] : 0;
      index += 1;
      return { status };
    },
  };
}

function runMain(deps) {
  const logs = [];
  const errors = [];
  const code = main({
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    ...deps,
  });
  return { code, logs, errors };
}

// A stub `npm` first on PATH: the driver shells out to `npm run docus:build`,
// and the point of the CLI tests is the driver's own control flow, not a site
// compile.
function withStubNpm(exitCode, run) {
  const binDir = mkdtempSync(join(tmpdir(), 'endusers-e2e-builds-bin-'));
  const log = join(binDir, 'calls.log');
  try {
    const npm = join(binDir, 'npm');
    writeFileSync(
      npm,
      `#!/bin/sh\nprintf '%s\\n' "$E2E_COVERAGE_BUILD|$BASE_URL|$DOCUSAURUS_NO_PERSISTENT_CACHE|$E2E_COVERAGE|$*" >> ${JSON.stringify(log)}\nexit ${exitCode}\n`,
    );
    chmodSync(npm, 0o755);
    return run({
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH}`,
      },
      log,
    });
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
}

test('buildCommand derives the out-dir and base URL from the build name', () => {
  const { command, args, options } = buildCommand('variant', { HOME: '/home' });
  assert.equal(command, 'npm');
  assert.deepEqual(args, [
    'run',
    'docus:build',
    '--',
    '--out-dir',
    'build/e2e-coverage-variant',
  ]);
  assert.equal(options.cwd, REPO_ROOT);
  assert.equal(options.stdio, 'inherit');
  assert.equal(options.env.BASE_URL, '/e2e-coverage-variant/');
  assert.equal(options.env.E2E_COVERAGE_BUILD, 'variant');
  assert.equal(options.env.E2E_COVERAGE, '1');
  assert.equal(options.env.DOCUSAURUS_NO_PERSISTENT_CACHE, '1');
  // The build inherits the ambient environment rather than replacing it.
  assert.equal(options.env.HOME, '/home');
});

test('main compiles every named build, in the order it was given', () => {
  const { calls, spawn } = recordingSpawn();
  const { code, logs, errors } = runMain({
    names: ['no-revision', 'variant'],
    spawn,
  });
  assert.equal(code, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    calls.map((call) => call.options.env.E2E_COVERAGE_BUILD),
    ['no-revision', 'variant'],
  );
  assert.deepEqual(
    calls.map((call) => call.args.at(-1)),
    ['build/e2e-coverage-no-revision', 'build/e2e-coverage-variant'],
  );
  assert.deepEqual(logs, [
    '\n==> e2e coverage build "no-revision"',
    '\n==> e2e coverage build "variant"',
  ]);
});

test('main stops at the first failing build and forwards its status', () => {
  const { calls, spawn } = recordingSpawn([0, 3]);
  const { code, errors } = runMain({
    names: ['first', 'second', 'third'],
    spawn,
  });
  assert.equal(code, 3);
  assert.equal(calls.length, 2, 'the third build must not be started');
  assert.deepEqual(errors, ['e2e coverage build "second" failed']);
});

// spawnSync reports a signalled child as status null, which would otherwise
// be forwarded as a zero exit code and pass the job on a build that never
// finished.
test('main reports a signalled build as a failure', () => {
  const { spawn } = recordingSpawn([null]);
  const { code, errors } = runMain({ names: ['variant'], spawn });
  assert.equal(code, 1);
  assert.deepEqual(errors, ['e2e coverage build "variant" failed']);
});

test('main fails when no fixture build directory exists', () => {
  const { calls, spawn } = recordingSpawn();
  const { code, logs, errors } = runMain({ names: [], spawn });
  assert.equal(code, 1);
  assert.deepEqual(calls, []);
  assert.deepEqual(logs, []);
  assert.match(errors[0], /no fixture build to serve/);
});

// The default name list is the directory listing, so the checked-in fixture
// directories are the builds the real run compiles.
test('main defaults to the committed fixture build directories', () => {
  const { calls, spawn } = recordingSpawn();
  const { code } = runMain({ spawn });
  assert.equal(code, 0);
  assert.ok(calls.length > 0, 'the repository must declare a fixture build');
  assert.deepEqual(
    calls.map((call) => call.options.env.E2E_COVERAGE_BUILD),
    coverageBuildNames(),
  );
});

test('the CLI compiles each build and exits 0', () => {
  const { status, calls } = withStubNpm(0, ({ env, log }) => {
    const result = spawnSync(process.execPath, [BUILDS_TOOL], {
      env,
      encoding: 'utf8',
    });
    return {
      status: result.status,
      calls: spawnSync('cat', [log], { encoding: 'utf8' }).stdout ?? '',
    };
  });
  assert.equal(status, 0);
  const lines = calls.trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'the CLI must run at least one build');
  for (const line of lines) {
    const [name, baseUrl, noCache, coverage, argv] = line.split('|');
    assert.equal(baseUrl, `/e2e-coverage-${name}/`);
    assert.equal(noCache, '1');
    assert.equal(coverage, '1');
    assert.equal(
      argv,
      `run docus:build -- --out-dir build/e2e-coverage-${name}`,
    );
  }
});

test('the CLI exits non-zero when a build fails', () => {
  const status = withStubNpm(3, ({ env }) => {
    const result = spawnSync(process.execPath, [BUILDS_TOOL], {
      env,
      encoding: 'utf8',
    });
    return result.status;
  });
  assert.equal(status, 3);
});
