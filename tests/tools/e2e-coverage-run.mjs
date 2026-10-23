import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { captureRunScripts } from './e2e-coverage-scripts.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// Residual uncovered regions, recorded the way tests/tools/e2e-coverage-report.mjs
// records its own so this file's region percentage is not re-investigated every
// cycle. Named by function and expression rather than by line, so the note does
// not go stale when the file moves:
//
//   readProvenance  `if (!(error instanceof SyntaxError)) throw error` -- the
//       re-throw arm needs `JSON.parse` to fail with something other than a
//       `SyntaxError`. The `try` wraps that one call and nothing else, and
//       `raw` is bound from a `'utf8'` read, so the argument is always a
//       string; `JSON.parse` of a string throws only `SyntaxError`. The
//       `SyntaxError` half of the same `catch` is reached by
//       tests/e2e-coverage-runtime.test.mjs.
//
// That premise is a claim about the code around the arm, not about the arm: a
// later edit that widens the `try` -- over the `readFile`, or over a validator
// -- makes the re-throw live without touching the line. It is asserted
// directly by tests/e2e-coverage-run-residual-arm.test.mjs, the way
// tests/e2e-coverage-error-arms.test.mjs asserts the premises behind the
// reporter's residuals, so a change that makes the arm reachable fails on its
// own name rather than merely moving the region count. Together they are 1
// region, which caps this file at 99.15% regions;
// tests/coverage-gate-thresholds.test.mjs reads that ceiling beside
// `--check-harness-file-regions` so the floor is never set above it. The
// denominator is V8's, so it drifts a little with the Node major -- 1/117 was
// measured on Node 26 while CI pins Node 22 -- which is why the floor sits
// below the ceiling rather than against it. Close the arm and shorten this
// note in the same change; do not raise the floor past it alone.

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

/**
 * The commit the coverage run measures, or null when it cannot be determined.
 *
 * Every line and region number the reporter emits is an offset into the source
 * as it stood at one commit. The manifest recorded `runId` but never that
 * commit, so an artifact outlived the coordinates it addresses: the
 * `e2e-coverage` artifact of run 38418930699 reports
 * `src/components/ReferenceArchitectures/index.js` as 95.65% regions with
 * uncovered regions at lines 13 and 34, and those lines named a `SyncStatus`
 * helper the file no longer has -- it was 142 lines then and is 104 now. A
 * reader with only the artifact cannot tell that apart from a live finding,
 * and chases an arm that no longer exists.
 *
 * `GITHUB_SHA` is preferred over `git rev-parse` because the merge_group and
 * pull_request lanes both build a ref that is not any local branch tip, and
 * the environment names the commit the workflow was handed. The `git` fallback
 * is what makes a local `npm run report:e2e:coverage` carry provenance too.
 * Neither being available is recorded as `null` rather than raised: provenance
 * is evidence for a later reader, and a run that cannot name its commit is
 * still a run worth reporting.
 *
 * @param {object} [deps]
 * @param {NodeJS.ProcessEnv} [deps.env] environment to read `GITHUB_SHA` from
 * @param {Function} [deps.spawn] `spawnSync`-shaped runner
 * @returns {string|null} the commit SHA, or null when unknown
 */
export function resolveRevision({ env = process.env, spawn = spawnSync } = {}) {
  const fromEnvironment = env.GITHUB_SHA;
  if (typeof fromEnvironment === 'string' && fromEnvironment.trim() !== '') {
    return fromEnvironment.trim();
  }
  const result = spawn('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (!result || result.status !== 0 || typeof result.stdout !== 'string') {
    return null;
  }
  const revision = result.stdout.trim();
  return revision === '' ? null : revision;
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

async function readProvenance(runDir, runId, buildDir) {
  const captures = new Map();
  const warnings = [];
  for (const entry of await readdir(runDir)) {
    if (!entry.endsWith('.json') || entry === 'manifest.json') continue;
    const raw = await readFile(join(runDir, entry), 'utf8');
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      warnings.push(
        `Capture runtime unavailable for ${entry}: ${error.message}`,
      );
      continue;
    }
    if (
      payload?.runId === runId &&
      [
        COVERAGE_ARTIFACT_KIND,
        'endusers.playwright.v8-coverage-error',
      ].includes(payload.kind)
    ) {
      const runtime = payload.runtime ?? null;
      captures.set(JSON.stringify(runtime), runtime);
    }
  }
  const builds = [];
  if (buildDir && (await exists(buildDir))) {
    const variants = (await readdir(buildDir, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.startsWith('e2e-coverage-'),
      )
      .map((entry) => entry.name)
      .sort();
    for (const build of ['.', ...variants]) {
      const path = join(buildDir, build, 'e2e-coverage-runtime.json');
      const hasRuntime = await exists(path);
      if (
        build !== '.' &&
        !hasRuntime &&
        !(await exists(join(buildDir, build, 'assets/js')))
      )
        continue;
      builds.push({
        build,
        runtime: hasRuntime ? JSON.parse(await readFile(path, 'utf8')) : null,
      });
    }
  }
  return {
    captureRuntimes: Array.from(captures.values()),
    buildRuntimes: builds,
    provenanceWarnings: warnings,
  };
}

export async function sealCoverageRun(
  runDir,
  status,
  { buildDir = null } = {},
) {
  if (!SEALED_STATUSES.has(status)) {
    throw new Error(`invalid coverage seal status: ${status}`);
  }
  const manifest = await readCoverageRun(runDir);
  if (manifest.status !== 'started') {
    throw new Error(
      `coverage run ${manifest.runId} is already sealed as ${manifest.status}`,
    );
  }
  // Copied before the manifest flips to a sealed status: once sealed the run is
  // immutable, and the reporter refuses to read it until then. Capture is
  // opt-in so that sealing never reaches for a build directory the caller did
  // not name; the CLI supplies the one CI builds into.
  const scripts = buildDir
    ? await captureRunScripts(runDir, {
        buildDir,
        artifactKind: COVERAGE_ARTIFACT_KIND,
      })
    : null;
  const sealed = {
    ...manifest,
    ...(await readProvenance(runDir, manifest.runId, buildDir)),
    status,
    sealedAt: new Date().toISOString(),
    ...(scripts
      ? {
          capturedScripts: scripts.copied.length,
          uncapturedScripts: scripts.missing,
        }
      : {}),
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

function optionalValue(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const runDir = optionValue(argv, '--dir');
  if (command === 'init') {
    const manifest = await initCoverageRun(
      runDir,
      optionValue(argv, '--run-id'),
      { project: 'chromium', revision: resolveRevision() },
    );
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
    return manifest;
  }
  if (command === 'seal') {
    const buildDir =
      optionalValue(argv, '--build-dir') ?? join(repoRoot, 'build');
    const manifest = await sealCoverageRun(
      runDir,
      optionValue(argv, '--status'),
      { buildDir: resolve(buildDir) },
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
