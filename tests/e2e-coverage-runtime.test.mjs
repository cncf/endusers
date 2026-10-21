// The e2e coverage report's region percentages are only meaningful against
// the runtime that produced them.
//
// V8 decides how many ranges one expression splits into, so the region
// *denominator* moves between runtimes while the code, the suite and the
// fixture builds stay put. CONTRIBUTING.md measures the size of that drift,
// and tests/e2e-coverage-gate.test.mjs pins the Node major its floors were
// measured on -- but neither of those reaches the artifact. A report opened
// out of the 90-day upload, or pasted into a pull request from a local
// render, used to carry percentages with nothing in them to say which runtime
// chose the denominator, which is exactly the confusion that makes a
// contributor read headroom the gate does not have.
//
// `revision` already answers "which code?". These tests hold the matching
// answer to "which runtime?" in both the JSON envelope and the text render,
// on the success path and the failure path alike.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main, renderE2ECoverageReport } from './tools/e2e-coverage-report.mjs';
import { initCoverageRun, sealCoverageRun } from './tools/e2e-coverage-run.mjs';

/** A minimal report shell, so the two render cases differ only in runtime. */
function reportWith(runtime) {
  return {
    status: 'ok',
    runId: 'run-1',
    runStatus: 'passed',
    revision: null,
    runtime,
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

test('the text report states the runtime on its own line', () => {
  const text = renderE2ECoverageReport(
    reportWith({ node: 'v22.23.3', v8: '12.4.254.21-node.26' }),
  );
  assert.match(
    text,
    /^Runtime: node v22\.23\.3 \(v8 12\.4\.254\.21-node\.26\)$/mu,
  );
  assert.match(
    text,
    /^Revision: unknown$/mu,
    'the runtime is a line of its own beside the revision, not folded into it',
  );
});

test('a report with no runtime says so rather than printing nothing', () => {
  // The same shape `revision` uses: a consumer always gets the line, so a
  // missing value reads as missing instead of as a report that never had the
  // field.
  assert.match(
    renderE2ECoverageReport(reportWith(undefined)),
    /^Runtime: node unknown \(v8 unknown\)$/mu,
  );
});

test('the failure artifact stamps the runtime it ran on', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = join(root, 'coverage');
  const jsonPath = join(root, 'report.json');
  await initCoverageRun(runDir, 'run-runtime', { project: 'chromium' });
  // Sealed with no coverage artifacts at all, so the reporter refuses to
  // publish a vacuous 0% and takes the error envelope instead. That envelope
  // is the only record a run which broke before reporting leaves behind,
  // which is the case where "which runtime was this?" matters most.
  await sealCoverageRun(runDir, 'passed');

  await assert.rejects(() => main(['--input', runDir, '--json', jsonPath]));

  const report = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(report.kind, 'endusers.e2e.coverage-report-error');
  // Read from the live process rather than hard-coded: the point of the stamp
  // is that it reports the runtime that actually produced the numbers, so a
  // literal here would pass while the field lied.
  assert.deepEqual(report.runtime, {
    node: process.version,
    v8: process.versions.v8,
  });
});
