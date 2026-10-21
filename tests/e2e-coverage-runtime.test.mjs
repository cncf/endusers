// Captured browser ranges, built JavaScript and report conversion can come
// from different runtimes. Re-rendering must not relabel the original producers.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main, renderE2ECoverageReport } from './tools/e2e-coverage-report.mjs';
import {
  initCoverageRun,
  readCoverageRun,
  sealCoverageRun,
  writeCoverageArtifact,
} from './tools/e2e-coverage-run.mjs';

/** A minimal report shell, so the two render cases differ only in runtime. */
function reportWith(reporterRuntime) {
  return {
    status: 'ok',
    runId: 'run-1',
    runStatus: 'passed',
    revision: null,
    reporterRuntime,
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

test('the text report distinguishes build, capture and reporter runtimes', () => {
  const report = reportWith({ node: 'v22.23.3', v8: '12.4.254.21-node.26' });
  report.buildRuntimes = [{ build: '.', runtime: { node: 'v20', v8: '11' } }];
  report.captureRuntimes = [
    {
      node: 'v21',
      v8: '12',
      playwright: '1.64',
      browser: 'Chrome/123',
      browserV8: '12.3',
    },
  ];
  const text = renderE2ECoverageReport(report);
  assert.match(
    text,
    /^Reporter runtime: node v22\.23\.3 \(v8 12\.4\.254\.21-node\.26\)$/mu,
  );
  assert.match(text, /^Build runtimes: \.: node v20 \(v8 11\)$/mu);
  assert.match(
    text,
    /^Capture runtimes: node v21 \(v8 12\), Playwright 1\.64, browser Chrome\/123 \(v8 12\.3\)$/mu,
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
    /^Reporter runtime: node unknown \(v8 unknown\)$/mu,
  );
  const report = reportWith(undefined);
  assert.match(renderE2ECoverageReport(report), /^Build runtimes: unknown$/mu);
  assert.match(
    renderE2ECoverageReport(report),
    /^Capture runtimes: unknown$/mu,
  );
  report.captureRuntimes = [null];
  report.buildRuntimes = [{ build: '.', runtime: null }];
  assert.match(
    renderE2ECoverageReport(report),
    /Playwright unknown, browser unknown \(v8 unknown\)/u,
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
  assert.deepEqual(report.reporterRuntime, {
    node: process.version,
    v8: process.versions.v8,
  });
});

test('sealing and re-rendering preserve producer identity on failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-producers-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  const variant = 'e2e-coverage-variant';
  const legacy = 'e2e-coverage-legacy';
  await mkdir(join(buildDir, variant), { recursive: true });
  await mkdir(join(buildDir, legacy));
  await mkdir(join(buildDir, legacy, 'assets/js'), { recursive: true });
  await mkdir(join(buildDir, 'e2e-coverage-fixtures'));
  const buildRuntime = { node: 'v18', v8: '10' };
  await writeFile(
    join(buildDir, 'e2e-coverage-runtime.json'),
    JSON.stringify(buildRuntime),
  );
  await writeFile(
    join(buildDir, variant, 'e2e-coverage-runtime.json'),
    JSON.stringify({ node: 'v20', v8: '11' }),
  );
  const captureRuntime = {
    node: 'v21',
    v8: '12',
    playwright: '1.64',
    browser: 'Chrome/123',
    browserV8: '12.3',
  };
  await initCoverageRun(runDir, 'producers');
  for (const stem of ['first', 'second'])
    await writeCoverageArtifact(runDir, stem, {
      kind: 'endusers.playwright.v8-coverage-error',
      runId: 'producers',
      runtime: captureRuntime,
      error: { message: 'capture failed' },
    });
  await writeCoverageArtifact(runDir, 'legacy', {
    kind: 'endusers.playwright.v8-coverage',
    runId: 'producers',
    result: [],
  });
  const sealed = await sealCoverageRun(runDir, 'failed', { buildDir });
  assert.deepEqual(sealed.captureRuntimes, [captureRuntime, null]);
  assert.deepEqual(sealed.buildRuntimes, [
    { build: '.', runtime: buildRuntime },
    { build: legacy, runtime: null },
    { build: variant, runtime: { node: 'v20', v8: '11' } },
  ]);
  await writeFile(
    join(buildDir, 'e2e-coverage-runtime.json'),
    JSON.stringify({ node: 'changed', v8: 'changed' }),
  );
  for (const name of ['first', 'rerender']) {
    const jsonPath = join(root, `${name}.json`);
    await assert.rejects(
      () => main(['--input', runDir, '--json', jsonPath]),
      /sealed as failed/,
    );
    const report = JSON.parse(await readFile(jsonPath, 'utf8'));
    assert.deepEqual(report.buildRuntimes, sealed.buildRuntimes);
    assert.deepEqual(report.captureRuntimes, sealed.captureRuntimes);
    assert.equal(report.reporterRuntime.node, process.version);
  }
});

test('invalid capture JSON keeps an explicit provenance warning for the reporter', async (t) => {
  const runDir = await mkdtemp(join(tmpdir(), 'endusers-e2e-runtime-invalid-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));
  await initCoverageRun(runDir, 'invalid');
  await writeFile(join(runDir, 'bad.json'), '{ invalid');
  await writeFile(join(runDir, 'ignored.json'), 'null');
  const sealed = await sealCoverageRun(runDir, 'passed', {
    buildDir: join(runDir, 'absent'),
  });
  assert.equal(sealed.provenanceWarnings.length, 1);
  assert.match(
    sealed.provenanceWarnings[0],
    /Capture runtime unavailable for bad.json/,
  );
  assert.deepEqual(sealed.captureRuntimes, []);
  assert.deepEqual(sealed.buildRuntimes, []);
});

test('malformed build runtime metadata fails sealing explicitly', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-build-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  await mkdir(buildDir);
  await writeFile(join(buildDir, 'e2e-coverage-runtime.json'), '{ invalid');
  await initCoverageRun(runDir, 'bad-build');
  await assert.rejects(
    () => sealCoverageRun(runDir, 'passed', { buildDir }),
    SyntaxError,
  );
  assert.equal((await readCoverageRun(runDir)).status, 'started');
});
