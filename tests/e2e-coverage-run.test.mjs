import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  initCoverageRun,
  main,
  readCoverageRun,
  sealCoverageRun,
  writeCoverageArtifact,
} from './tools/e2e-coverage-run.mjs';

async function tempRunDir() {
  return mkdtemp(join(tmpdir(), 'endusers-e2e-coverage-run-'));
}

const RUN_TOOL = fileURLToPath(
  new URL('./tools/e2e-coverage-run.mjs', import.meta.url),
);

test('initializes a run manifest and rejects stale content', async () => {
  const runDir = await tempRunDir();
  try {
    const manifest = await initCoverageRun(runDir, 'run-1', {
      project: 'chromium',
    });
    assert.equal(manifest.status, 'started');
    assert.equal((await readCoverageRun(runDir)).runId, 'run-1');

    await assert.rejects(
      () => initCoverageRun(runDir, 'run-2'),
      /already contains a coverage run manifest/,
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('rejects invalid run identifiers and malformed manifests', async () => {
  const runDir = await tempRunDir();
  try {
    await assert.rejects(
      () => initCoverageRun(runDir, ''),
      /coverage runId must be a non-empty string/,
    );
    await writeFile(join(runDir, 'manifest.json'), '{}');
    await assert.rejects(
      () => readCoverageRun(runDir),
      /invalid coverage run manifest/,
    );
    await writeFile(
      join(runDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'endusers.e2e.coverage-run',
        runId: 'run-invalid-status',
        status: 'unknown',
      }),
    );
    await assert.rejects(
      () => readCoverageRun(runDir),
      /invalid coverage run status/,
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('rejects a non-empty directory without a matching manifest', async () => {
  const runDir = await tempRunDir();
  try {
    await writeFile(join(runDir, 'stale.json'), '{}');
    await assert.rejects(
      () => initCoverageRun(runDir, 'run-1'),
      /already contains files but no coverage run manifest/,
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('seals a run and writes collision-safe coverage artifacts', async () => {
  const runDir = await tempRunDir();
  try {
    await initCoverageRun(runDir, 'run-1');
    const artifact = await writeCoverageArtifact(runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [],
    });

    assert.match(artifact, /worker-0-page-0\.json$/);
    assert.deepEqual(JSON.parse(await readFile(artifact, 'utf8')).result, []);
    await assert.rejects(
      () =>
        writeCoverageArtifact(runDir, 'worker-0-page-0', {
          schemaVersion: 1,
          kind: 'endusers.playwright.v8-coverage',
          runId: 'run-1',
          result: [],
        }),
      /already exists/,
    );

    const sealed = await sealCoverageRun(runDir, 'passed');
    assert.equal(sealed.status, 'passed');
    assert.equal((await readCoverageRun(runDir)).status, 'passed');
    await assert.rejects(
      () =>
        writeCoverageArtifact(runDir, 'late-write', {
          runId: 'run-1',
          result: [],
        }),
      /already sealed as passed/,
    );
    assert.ok((await readdir(runDir)).includes('manifest.json'));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('the run CLI awaits init and seal operations', async () => {
  const runDir = await tempRunDir();
  try {
    await main(['init', '--dir', runDir, '--run-id', 'run-cli']);
    await main(['seal', '--dir', runDir, '--status', 'passed']);
    assert.equal((await readCoverageRun(runDir)).status, 'passed');
    await assert.rejects(
      () => sealCoverageRun(runDir, 'not-a-status'),
      /invalid coverage seal status/,
    );
    await assert.rejects(
      () => sealCoverageRun(runDir, 'passed'),
      /already sealed/,
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('rejects invalid artifact names and mismatched run IDs', async () => {
  const runDir = await tempRunDir();
  try {
    await initCoverageRun(runDir, 'run-invalid');
    await assert.rejects(
      () =>
        writeCoverageArtifact(runDir, 'bad/name', {
          runId: 'run-invalid',
        }),
      /invalid coverage artifact name/,
    );
    await assert.rejects(
      () =>
        writeCoverageArtifact(runDir, 'mismatch', {
          runId: 'other-run',
        }),
      /does not match run-invalid/,
    );
    await assert.rejects(
      () => writeCoverageArtifact(runDir, 'missing-run-id', {}),
      /does not match run-invalid/,
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('run CLI rejects missing options and unknown commands', async () => {
  const runDir = await tempRunDir();
  try {
    await assert.rejects(
      () => main(['init', '--dir', runDir]),
      /--run-id is required/,
    );
    await assert.rejects(
      () => main(['unknown', '--dir', runDir]),
      /unknown coverage run command/,
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('run CLI entrypoint executes when launched as a Node process', async () => {
  const runDir = await tempRunDir();
  try {
    const result = spawnSync(
      process.execPath,
      [RUN_TOOL, 'init', '--dir', runDir, '--run-id', 'subprocess-1'],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await readCoverageRun(runDir)).runId, 'subprocess-1');
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
