import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const COVERAGE_RUN_SCHEMA_VERSION = 1;
export const COVERAGE_RUN_KIND = 'endusers.e2e.coverage-run';
export const COVERAGE_ARTIFACT_KIND = 'endusers.playwright.v8-coverage';

const SEALED_STATUSES = new Set([
  'passed',
  'failed',
  'cancelled',
  'tooling-error',
]);
const STEM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function manifestPath(runDir) {
  return join(runDir, 'manifest.json');
}

function assertRunId(runId) {
  if (typeof runId !== 'string' || runId.trim() === '') {
    throw new Error('coverage runId must be a non-empty string');
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporary, path);
}

function validateManifest(manifest) {
  if (
    !manifest ||
    manifest.schemaVersion !== COVERAGE_RUN_SCHEMA_VERSION ||
    manifest.kind !== COVERAGE_RUN_KIND
  ) {
    throw new Error(`invalid coverage run manifest`);
  }
  assertRunId(manifest.runId);
  if (manifest.status !== 'started' && !SEALED_STATUSES.has(manifest.status)) {
    throw new Error(`invalid coverage run status: ${manifest.status}`);
  }
  return manifest;
}

export async function initCoverageRun(runDir, runId, metadata = {}) {
  assertRunId(runId);
  await mkdir(runDir, { recursive: true });
  const entries = await readdir(runDir);
  if (entries.length > 0) {
    if (entries.includes('manifest.json')) {
      throw new Error(
        `coverage directory ${runDir} already contains a coverage run manifest`,
      );
    }
    throw new Error(
      `coverage directory ${runDir} already contains files but no coverage run manifest`,
    );
  }

  const manifest = {
    schemaVersion: COVERAGE_RUN_SCHEMA_VERSION,
    kind: COVERAGE_RUN_KIND,
    runId,
    status: 'started',
    createdAt: new Date().toISOString(),
    ...metadata,
  };
  await writeJsonAtomic(manifestPath(runDir), manifest);
  return manifest;
}

export async function readCoverageRun(runDir) {
  const raw = await readFile(manifestPath(runDir), 'utf8');
  return validateManifest(JSON.parse(raw));
}

export async function sealCoverageRun(runDir, status) {
  if (!SEALED_STATUSES.has(status)) {
    throw new Error(`invalid coverage seal status: ${status}`);
  }
  const manifest = await readCoverageRun(runDir);
  if (manifest.status !== 'started') {
    throw new Error(
      `coverage run ${manifest.runId} is already sealed as ${manifest.status}`,
    );
  }
  const sealed = {
    ...manifest,
    status,
    sealedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(manifestPath(runDir), sealed);
  return sealed;
}

export async function writeCoverageArtifact(runDir, stem, payload) {
  if (typeof stem !== 'string' || !STEM_PATTERN.test(stem)) {
    throw new Error(`invalid coverage artifact name: ${stem}`);
  }
  const manifest = await readCoverageRun(runDir);
  if (manifest.status !== 'started') {
    throw new Error(
      `coverage run ${manifest.runId} is already sealed as ${manifest.status}`,
    );
  }
  if (payload?.runId !== manifest.runId) {
    throw new Error(
      `coverage artifact runId ${payload?.runId ?? '<missing>'} does not match ${manifest.runId}`,
    );
  }
  const path = join(runDir, `${stem}.json`);
  if (await exists(path)) {
    throw new Error(`coverage artifact ${path} already exists`);
  }
  await writeJsonAtomic(path, payload);
  return path;
}

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || argv[index + 1] === undefined) {
    throw new Error(`${name} is required`);
  }
  return argv[index + 1];
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const runDir = optionValue(argv, '--dir');
  if (command === 'init') {
    const manifest = await initCoverageRun(
      runDir,
      optionValue(argv, '--run-id'),
      { project: 'chromium' },
    );
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
    return manifest;
  }
  if (command === 'seal') {
    const manifest = await sealCoverageRun(
      runDir,
      optionValue(argv, '--status'),
    );
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
    return manifest;
  }
  throw new Error(`unknown coverage run command: ${command}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.stack ?? error);
    process.exitCode = 1;
  });
}
