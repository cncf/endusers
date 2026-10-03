// `npm run report:e2e:coverage` runs tests/tools/e2e-coverage-report.mjs as a
// command, and the e2e-coverage CI job is `continue-on-error: true` -- so the
// only signal that the reporter failed rather than reported is the exit code
// its CLI entrypoint sets. tests/e2e-coverage-report.test.mjs drives `main()`
// in process, which never executes that entrypoint: the module-level
// `import.meta.url === pathToFileURL(process.argv[1]).href` guard is false
// under an import, so the `.catch()` that prints the stack and sets
// `process.exitCode = 1` had never run under coverage.
//
// Spawning the reporter is what records it. NODE_V8_COVERAGE is left in the
// child environment on purpose -- the unit-coverage reporter sets it for the
// `node --test` run, children inherit it, and the records the child writes are
// merged back. NODE_TEST_CONTEXT still has to go, or the child would believe
// it is running inside a test runner.

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  initCoverageRun,
  sealCoverageRun,
  writeCoverageArtifact,
} from './tools/e2e-coverage-run.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORTER = fileURLToPath(
  new URL('./tools/e2e-coverage-report.mjs', import.meta.url),
);

function runReporter(args) {
  const env = { ...process.env, TZ: 'UTC' };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [REPORTER, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
  });
}

async function fixtureRun() {
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-report-cli-'));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  await mkdir(join(buildDir, 'assets/js'), { recursive: true });
  await initCoverageRun(runDir, 'run-cli', { project: 'chromium' });
  return { root, runDir, buildDir };
}

// A single bundle line mapped straight back onto line 0 of one source file.
// The mapping is the degenerate VLQ case -- four zero fields -- so it needs no
// encoder of its own.
async function writeMappedScript(fixture) {
  const source = 'const value = 1;\n';
  const scriptText = `${source}\n//# sourceMappingURL=main.js.map\n`;
  await mkdir(join(fixture.root, 'src/components/Main'), { recursive: true });
  await writeFile(join(fixture.root, 'src/components/Main/index.js'), source);
  await writeFile(join(fixture.buildDir, 'assets/js/main.js'), scriptText);
  await writeFile(
    join(fixture.buildDir, 'assets/js/main.js.map'),
    JSON.stringify({
      version: 3,
      file: 'main.js',
      sources: ['../../../src/components/Main/index.js'],
      sourcesContent: [source],
      names: [],
      mappings: 'AAAA',
    }),
  );
  return scriptText;
}

test('the reporter CLI prints the report and exits zero for a usable run', async () => {
  const fixture = await fixtureRun();
  try {
    const scriptText = await writeMappedScript(fixture);
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-cli',
      result: [
        {
          url: 'http://localhost:3000/assets/js/main.js',
          scriptId: '3',
          sourceLength: scriptText.length,
          sourceSha256: createHash('sha256').update(scriptText).digest('hex'),
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [
                { startOffset: 0, endOffset: scriptText.length, count: 1 },
              ],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');
    const jsonPath = join(fixture.root, 'report.json');

    const result = runReporter([
      '--input',
      fixture.runDir,
      '--root',
      fixture.root,
      '--build',
      fixture.buildDir,
      '--json',
      jsonPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    // Without --text the rendered table is the CLI's stdout, which is what the
    // workflow step tees into its job summary.
    assert.match(result.stdout, /src\/components\/Main\/index\.js/);
    assert.equal(JSON.parse(await readFile(jsonPath, 'utf8')).status, 'ok');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('the reporter CLI still writes its artifact and exits nonzero on a tooling error', async () => {
  const fixture = await fixtureRun();
  try {
    // No eligible scripts at all, so nothing is attributable to src/** and
    // collectE2ECoverage refuses to report a vacuous 0%.
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-cli',
      result: [],
    });
    await sealCoverageRun(fixture.runDir, 'passed');
    const jsonPath = join(fixture.root, 'error-report.json');
    const textPath = join(fixture.root, 'error-report.txt');

    const result = runReporter([
      '--input',
      fixture.runDir,
      '--root',
      fixture.root,
      '--build',
      fixture.buildDir,
      '--json',
      jsonPath,
      '--text',
      textPath,
    ]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /No src\/\*\* coverage was attributable/);
    // The honest artifact survives the CLI boundary: a failed run leaves a
    // report saying so rather than leaving the previous run's file in place.
    assert.equal(
      JSON.parse(await readFile(jsonPath, 'utf8')).status,
      'tooling-error',
    );
    assert.match(await readFile(textPath, 'utf8'), /tooling-error/);
    // --text was given, so the table went to the file and not to stdout.
    assert.equal(result.stdout, '');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('the reporter CLI rejects an unusable option list before it reads anything', () => {
  // parseArgs throws ahead of main()'s try block, so these failures produce no
  // report at all -- only the entrypoint's stack and exit code.
  const missing = runReporter([]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--input is required/);

  const unknown = runReporter(['--input', 'coverage', '--unknown']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown e2e coverage report option: --unknown/);
});
