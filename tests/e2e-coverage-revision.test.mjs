// Provenance for the e2e coverage report: which commit its numbers address.
//
// Every line and region the reporter names is an offset into the source as it
// stood at one commit, and until now nothing in the artifact said which. The
// failure that motivated this is concrete: the `e2e-coverage` artifact of run
// 38418930699 lists
// `src/components/ReferenceArchitectures/index.js` at 95.65% regions with
// uncovered regions at lines 13 and 34. Those lines addressed a `SyncStatus`
// helper that the file no longer contains -- 142 lines at that commit, 104
// today -- so read against the current tree they point at a component's card
// rendering instead, and a reader triaging them chases an arm that does not
// exist. `runId` does not help: resolving a run to a commit means leaving the
// artifact for the API.
//
// `resolveRevision()` is therefore recorded into the run manifest at init and
// copied onto the report, and the cases below pin each arm it can take. They
// drive the function directly rather than through a workflow because the
// `e2e-coverage` job calls the same `init` subcommand this module exports.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initCoverageRun, resolveRevision } from './tools/e2e-coverage-run.mjs';
import { renderE2ECoverageReport } from './tools/e2e-coverage-report.mjs';

const SHA = '1e37cdcd499390193e5915d26807f85cf4a484e8';

/** A `spawnSync` stand-in that records its call and returns a fixed result. */
function stubSpawn(result) {
  const calls = [];
  return {
    calls,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return result;
    },
  };
}

test('GITHUB_SHA names the revision without consulting git', () => {
  const { calls, spawn } = stubSpawn(null);
  assert.equal(resolveRevision({ env: { GITHUB_SHA: SHA }, spawn }), SHA);
  assert.deepEqual(
    calls,
    [],
    'the environment already names the commit the workflow was handed',
  );
});

test('a padded GITHUB_SHA is trimmed rather than recorded verbatim', () => {
  const { spawn } = stubSpawn(null);
  assert.equal(
    resolveRevision({ env: { GITHUB_SHA: `  ${SHA}\n` }, spawn }),
    SHA,
  );
});

test('a blank GITHUB_SHA falls through to git', () => {
  const { calls, spawn } = stubSpawn({ status: 0, stdout: `${SHA}\n` });
  assert.equal(resolveRevision({ env: { GITHUB_SHA: '   ' }, spawn }), SHA);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['rev-parse', 'HEAD']);
});

test('an absent GITHUB_SHA falls through to git', () => {
  const { spawn } = stubSpawn({ status: 0, stdout: `${SHA}\n` });
  assert.equal(resolveRevision({ env: {}, spawn }), SHA);
});

test('a failing git call records no revision rather than raising', () => {
  const { spawn } = stubSpawn({ status: 128, stdout: '' });
  assert.equal(
    resolveRevision({ env: {}, spawn }),
    null,
    'a run that cannot name its commit is still a run worth reporting',
  );
});

test('a git call that could not spawn records no revision', () => {
  const { spawn } = stubSpawn(null);
  assert.equal(resolveRevision({ env: {}, spawn }), null);
});

test('a git call with no captured stdout records no revision', () => {
  const { spawn } = stubSpawn({ status: 0, stdout: undefined });
  assert.equal(resolveRevision({ env: {}, spawn }), null);
});

test('git output that is only whitespace records no revision', () => {
  const { spawn } = stubSpawn({ status: 0, stdout: '\n' });
  assert.equal(resolveRevision({ env: {}, spawn }), null);
});

test('the default dependencies resolve this checkout', () => {
  // No injection: the `init` subcommand calls resolveRevision() with none, so
  // the defaults are the path CI actually takes.
  const revision = resolveRevision();
  assert.ok(
    revision === null || /^[0-9a-f]{40}$/u.test(revision),
    `expected a SHA or null, got ${revision}`,
  );
});

test('initCoverageRun records the revision it is handed in the manifest', async (t) => {
  const runDir = join(
    await mkdtemp(join(tmpdir(), 'e2e-coverage-revision-')),
    'run',
  );
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const manifest = await initCoverageRun(runDir, 'run-1', {
    project: 'chromium',
    revision: SHA,
  });
  assert.equal(manifest.revision, SHA);

  const onDisk = JSON.parse(
    await readFile(join(runDir, 'manifest.json'), 'utf8'),
  );
  assert.equal(
    onDisk.revision,
    SHA,
    'the artifact a later reader opens must carry it, not just the return value',
  );
});

/** A minimal report shell, so the two render cases differ only in revision. */
function reportWith(revision) {
  return {
    status: 'ok',
    runId: 'run-1',
    runStatus: 'passed',
    revision,
    sources: [],
    summary: {
      executableLines: 1,
      coveredLines: 1,
      linePercent: 100,
      regions: 1,
      coveredRegions: 1,
      regionPercent: 100,
    },
    unmappedSources: [],
    missingSourceFiles: [],
    diagnostics: { warnings: [], errors: [] },
  };
}

test('the text report states the revision on its own line', () => {
  const text = renderE2ECoverageReport(reportWith(SHA));
  assert.match(text, /^Revision: 1e37cdcd499390193e5915d26807f85cf4a484e8$/mu);
  assert.match(
    text,
    /^E2E coverage: ok \(run run-1; status passed\)$/mu,
    'the header keeps its shape; the revision is a line of its own',
  );
});

test('a report with no revision says so rather than printing nothing', () => {
  assert.match(
    renderE2ECoverageReport(reportWith(null)),
    /^Revision: unknown$/mu,
  );
});
