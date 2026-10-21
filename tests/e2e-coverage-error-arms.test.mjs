// The residual note at the top of tests/tools/e2e-coverage-report.mjs lists
// four arms no probe could reach. Two of them are the error-path fallbacks:
//
//   main                `error.message ?? String(error)`
//   the CLI entrypoint  `error.stack ?? error`
//
// (Named by function and expression rather than by line, as that note asks, so
// this header does not go stale when the file moves.)
//
// Both are unreachable for one reason, and it lives outside the arms: every
// value in `main()`'s call graph is an `Error`, so a rejection always carries
// a string `message` and a `stack`. That is a claim about code which can
// change without either arm changing -- a `throw` written in a later edit, of
// a string or of a plain object, makes both live at once -- and an
// unreachable arm asserted by nothing is indistinguishable from an arm whose
// fixture is merely missing. The consequence is not only the region count: the
// failure artifact is written from `error.message`, so a non-`Error` rejection
// would publish `null` as the reason the e2e gate failed.
//
// These tests state that premise directly, the way
// tests/e2e-coverage-split-range.test.mjs states the one behind the third
// residual arm, so a change that makes either fallback live fails here on its
// own name. The fourth arm, `collectE2ECoverage`'s zero-statement skip, is
// left alone deliberately: no published artifact has ever carried a
// zero-line source entry, so there is no real shape to pin a fixture to.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from './tools/e2e-coverage-report.mjs';
import {
  initCoverageRun,
  sealCoverageRun,
  writeCoverageArtifact,
} from './tools/e2e-coverage-run.mjs';

const REPORTER_SOURCE = fileURLToPath(
  new URL('./tools/e2e-coverage-report.mjs', import.meta.url),
);

// ---------------------------------------------------------------------------
// `?? String(error)` and `?? error` -- both fire only for a thrown value with
// no `message` or no `stack`, which is to say a value that is not an Error.
// ---------------------------------------------------------------------------

test('the reporter module throws nothing but Errors and its own re-throw', async () => {
  const source = await readFile(REPORTER_SOURCE, 'utf8');
  // Every `throw` written in the module, with the expression it throws. The
  // scan is deliberately textual: the point is to catch a *newly written*
  // `throw` of a non-Error, which no fixture would exercise.
  const thrown = [...source.matchAll(/\bthrow\s+([^\s;(]+)/gu)].map(
    (match) => match[1],
  );
  assert.ok(thrown.length > 0, 'the reporter still throws somewhere');

  const rethrows = thrown.filter((expression) => expression === 'error');
  // main()'s catch re-throws the value it just reported on, after writing the
  // failure artifact. That value came from the `try` block, so it is covered
  // by the constructors below rather than by its own name.
  assert.equal(
    rethrows.length,
    1,
    "exactly one bare re-throw is expected, in main()'s catch",
  );

  for (const expression of thrown) {
    if (expression === 'error') continue;
    assert.equal(
      expression,
      'new',
      `the reporter throws a value that is not constructed: ${expression}`,
    );
  }
  for (const match of source.matchAll(/\bthrow\s+new\s+([A-Za-z0-9_$]+)/gu)) {
    assert.match(
      match[1],
      /Error$/u,
      `the reporter throws a non-Error constructor: ${match[1]}`,
    );
  }
});

async function fixtureRun(runId) {
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-residual-run-'));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  await mkdir(join(buildDir, 'assets/js'), { recursive: true });
  await initCoverageRun(runDir, runId, { project: 'chromium' });
  return { root, runDir, buildDir, json: join(root, 'report.json') };
}

// One bundle line mapped straight back onto line 1 of one source file, the
// degenerate VLQ case -- the same fixture shape as
// tests/e2e-coverage-report-cli.test.mjs, which needs no encoder.
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

async function writeCoveredArtifact(fixture, runId, scriptText) {
  await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId,
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
}

// Two generated lines, each mapped to the original line of the same number,
// with only the first executed. The run is therefore a real 50% line score --
// the shape a `--check-source` failure actually has, as opposed to an
// out-of-range flag, which never reaches the gate at all.
async function writeHalfCoveredScript(fixture) {
  const source = 'const kept = 1;\nconst skipped = 2;\n';
  const scriptText = `${source}\n//# sourceMappingURL=half.js.map\n`;
  const secondLine = source.indexOf('\n') + 1;
  await mkdir(join(fixture.root, 'src/components/Half'), { recursive: true });
  await writeFile(join(fixture.root, 'src/components/Half/index.js'), source);
  await writeFile(join(fixture.buildDir, 'assets/js/half.js'), scriptText);
  await writeFile(
    join(fixture.buildDir, 'assets/js/half.js.map'),
    JSON.stringify({
      version: 3,
      file: 'half.js',
      sources: ['../../../src/components/Half/index.js'],
      sourcesContent: [source],
      names: [],
      // 'AAAA' opens source 0 at original line 1 column 0; ';AACA' is the
      // next generated line, advancing the original line by one.
      mappings: 'AAAA;AACA',
    }),
  );
  await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId: 'run-residual',
    result: [
      {
        url: 'http://localhost:3000/assets/js/half.js',
        scriptId: '4',
        sourceLength: scriptText.length,
        sourceSha256: createHash('sha256').update(scriptText).digest('hex'),
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [
              { startOffset: 0, endOffset: scriptText.length, count: 1 },
              { startOffset: secondLine, endOffset: source.length, count: 0 },
            ],
          },
        ],
      },
    ],
  });
  return scriptText;
}

// One fixture per distinct failure path main() can take, so the assertion
// below is made against the whole family rather than one representative.
const FAILURES = [
  {
    name: 'an unknown option',
    artifact: 'none',
    async build() {
      const fixture = await fixtureRun('run-residual');
      return { fixture, argv: ['--input', fixture.runDir, '--nope'] };
    },
  },
  {
    name: 'a missing --input',
    artifact: 'none',
    async build() {
      const fixture = await fixtureRun('run-residual');
      return { fixture, argv: [] };
    },
  },
  {
    name: 'a run that was never sealed',
    artifact: 'error',
    async build() {
      const fixture = await fixtureRun('run-residual');
      return { fixture, argv: baseArgv(fixture) };
    },
  },
  {
    name: 'a run sealed as failed',
    artifact: 'error',
    async build() {
      const fixture = await fixtureRun('run-residual');
      await sealCoverageRun(fixture.runDir, 'failed');
      return { fixture, argv: baseArgv(fixture) };
    },
  },
  {
    name: 'an artifact of an unexpected kind',
    artifact: 'error',
    async build() {
      const fixture = await fixtureRun('run-residual');
      await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
        schemaVersion: 1,
        kind: 'endusers.playwright.not-coverage',
        runId: 'run-residual',
        result: [],
      });
      await sealCoverageRun(fixture.runDir, 'passed');
      return { fixture, argv: baseArgv(fixture) };
    },
  },
  {
    name: 'an artifact belonging to another run',
    artifact: 'error',
    async build() {
      const fixture = await fixtureRun('run-residual');
      // Written past writeCoverageArtifact, which refuses a foreign runId of
      // its own accord: the guard under test is the reporter's, and it is the
      // one that has to hold for an artifact directory assembled by anything
      // other than that writer.
      await writeFile(
        join(fixture.runDir, 'worker-0-page-0.json'),
        JSON.stringify({
          schemaVersion: 1,
          kind: 'endusers.playwright.v8-coverage',
          runId: 'some-other-run',
          result: [],
        }),
      );
      await sealCoverageRun(fixture.runDir, 'passed');
      return { fixture, argv: baseArgv(fixture) };
    },
  },
  {
    name: 'a run with nothing attributable to src/**',
    artifact: 'error',
    async build() {
      const fixture = await fixtureRun('run-residual');
      await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
        schemaVersion: 1,
        kind: 'endusers.playwright.v8-coverage',
        runId: 'run-residual',
        result: [],
      });
      await sealCoverageRun(fixture.runDir, 'passed');
      return { fixture, argv: baseArgv(fixture) };
    },
  },
  {
    name: 'a generated source whose hash moved under the run',
    artifact: 'error',
    async build() {
      const fixture = await fixtureRun('run-residual');
      const scriptText = await writeMappedScript(fixture);
      await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
        schemaVersion: 1,
        kind: 'endusers.playwright.v8-coverage',
        runId: 'run-residual',
        result: [
          {
            url: 'http://localhost:3000/assets/js/main.js',
            scriptId: '3',
            sourceSha256: createHash('sha256').update('other').digest('hex'),
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
      return { fixture, argv: baseArgv(fixture) };
    },
  },
  {
    name: 'a --check-source value outside 0..100',
    artifact: 'none',
    async build() {
      const fixture = await fixtureRun('run-residual');
      return {
        fixture,
        argv: [...baseArgv(fixture), '--check-source', '101'],
      };
    },
  },
  {
    name: 'a line percentage below --check-source',
    artifact: 'report',
    async build() {
      const fixture = await fixtureRun('run-residual');
      await writeHalfCoveredScript(fixture);
      await sealCoverageRun(fixture.runDir, 'passed');
      return {
        fixture,
        argv: [...baseArgv(fixture), '--check-source', '100'],
      };
    },
  },
  {
    name: '--require-source-files against a module the run never measured',
    artifact: 'report',
    async build() {
      const fixture = await fixtureRun('run-residual');
      const scriptText = await writeMappedScript(fixture);
      await mkdir(join(fixture.root, 'src/components/Absent'), {
        recursive: true,
      });
      await writeFile(
        join(fixture.root, 'src/components/Absent/index.js'),
        'export const absent = 1;\n',
      );
      await writeCoveredArtifact(fixture, 'run-residual', scriptText);
      await sealCoverageRun(fixture.runDir, 'passed');
      return {
        fixture,
        argv: [...baseArgv(fixture), '--require-source-files'],
      };
    },
  },
];

function baseArgv(fixture) {
  return [
    '--input',
    fixture.runDir,
    '--root',
    fixture.root,
    '--build',
    fixture.buildDir,
    '--json',
    fixture.json,
    // Without --text main() writes the rendered table to stdout, which would
    // interleave with the test runner's own output on the success path. Every
    // fixture here fails before that line, but pinning it keeps a future
    // fixture from being the one that discovers the difference.
    '--text',
    join(fixture.root, 'report.txt'),
  ];
}

for (const failure of FAILURES) {
  test(`main() rejects with a reportable Error for ${failure.name}`, async () => {
    const { fixture, argv } = await failure.build();
    try {
      const error = await main(argv).then(
        () => null,
        (rejection) => rejection,
      );
      assert.ok(error instanceof Error, 'rejected with a non-Error value');
      // `?? String(error)` and `?? error` are the arms these two properties
      // retire: a thrown value carrying both never reaches either fallback.
      assert.equal(typeof error.message, 'string');
      assert.notEqual(error.message, '');
      assert.equal(typeof error.stack, 'string');

      if (failure.artifact === 'none') return;
      const report = JSON.parse(await readFile(fixture.json, 'utf8'));
      if (failure.artifact === 'report') {
        // A threshold is evaluated after the report is on disk, so the run
        // still publishes an ordinary report and the message lives only in
        // the rejection.
        assert.equal(report.kind, 'endusers.e2e.coverage-report');
        assert.deepEqual(report.diagnostics.errors, []);
        return;
      }
      // The failure artifact is written from `error.message` directly, so a
      // thrown value whose message were absent would publish `null` here
      // rather than the `String(error)` text the fallback exists to supply.
      assert.equal(report.kind, 'endusers.e2e.coverage-report-error');
      assert.deepEqual(report.diagnostics.errors, [error.message]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}
