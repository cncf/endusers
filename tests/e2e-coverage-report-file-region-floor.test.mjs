// `--check-source-regions` is an aggregate, and an aggregate hides where its
// own slack is spent. The `e2e-coverage` job asks for 95%, so roughly one
// region in twenty may be uncovered anywhere across `src/**` -- and nothing
// says those regions have to be spread out. A single component can hold all of
// the slack and sit far below the floor while the job stays green, which is
// the same hole `tests/tools/coverage-report.mjs` closed on the unit run with
// `--check-source-file-regions`.
//
// The companion line gate does not catch it either: a lost *region* need not
// be a lost *line*. An unexecuted ternary arm or `??` fallback sits on a line
// the surrounding statement still covers, so a file can report 100% lines
// while its region percentage falls.
//
// The fixture below is the proof rather than an illustration. Two source files
// share one bundle; one is fully covered and the other is not, and the numbers
// are chosen so the aggregate clears a floor that the worse file fails. A gate
// that only ever asked the aggregate would pass that run.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from './tools/e2e-coverage-report.mjs';
import {
  initCoverageRun,
  sealCoverageRun,
  writeCoverageArtifact,
} from './tools/e2e-coverage-run.mjs';

const VLQ_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(value) {
  let encoded = value < 0 ? (-value << 1) | 1 : value << 1;
  let output = '';
  do {
    let digit = encoded & 31;
    encoded >>>= 5;
    if (encoded > 0) digit |= 32;
    output += VLQ_CHARS[digit];
  } while (encoded > 0);
  return output;
}

function mapLines(entries) {
  let previousSource = 0;
  let previousLine = 0;
  return entries
    .map(([sourceIndex, originalLine]) => {
      const segment = [
        vlq(0),
        vlq(sourceIndex - previousSource),
        vlq(originalLine - previousLine),
        vlq(0),
      ].join('');
      previousSource = sourceIndex;
      previousLine = originalLine;
      return segment;
    })
    .join(';');
}

// Two bundles, one src file each, as Docusaurus emits them. `Covered/index.js`
// has both of its lines executed; `Uneven/index.js` has one of two. The run
// therefore clears a 66% aggregate (two of three regions) while
// `Uneven/index.js` alone sits at 50%.
//
// Each file gets its own bundle and its own map deliberately: a single map
// naming two sources is resolved by `v8-to-istanbul` into one source only, so
// a merged fixture would silently measure one file and prove nothing.
async function unevenRun() {
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-file-floor-'));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  await mkdir(join(buildDir, 'assets/js'), { recursive: true });
  await mkdir(join(root, 'src/components/Covered'), { recursive: true });
  await mkdir(join(root, 'src/components/Uneven'), { recursive: true });
  await initCoverageRun(runDir, 'run-file-floor', { project: 'chromium' });

  const bundles = [
    { name: 'covered', dir: 'Covered', body: 'const a = 1;\nconst b = 2;\n' },
    { name: 'uneven', dir: 'Uneven', body: 'const c = 3;\nconst d = 4;\n' },
  ];
  const result = [];
  for (const bundle of bundles) {
    const scriptText = `${bundle.body}\n//# sourceMappingURL=${bundle.name}.js.map\n`;
    await writeFile(
      join(root, `src/components/${bundle.dir}/index.js`),
      bundle.body,
    );
    await writeFile(join(buildDir, `assets/js/${bundle.name}.js`), scriptText);
    await writeFile(
      join(buildDir, `assets/js/${bundle.name}.js.map`),
      JSON.stringify({
        version: 3,
        file: `${bundle.name}.js`,
        sources: [`webpack://endusers/./src/components/${bundle.dir}/index.js`],
        sourcesContent: [bundle.body],
        names: [],
        mappings: mapLines([
          [0, 0],
          [0, 1],
        ]),
      }),
    );
    // The uneven bundle leaves its second statement unexecuted; the covered
    // one is entered whole.
    const ranges =
      bundle.dir === 'Uneven'
        ? [
            {
              startOffset: bundle.body.indexOf('const d'),
              endOffset: scriptText.length,
              count: 0,
            },
            { startOffset: 0, endOffset: scriptText.length, count: 1 },
          ]
        : [{ startOffset: 0, endOffset: scriptText.length, count: 1 }];
    result.push({
      url: `http://localhost:3000/assets/js/${bundle.name}.js`,
      scriptId: String(result.length + 1),
      functions: [{ functionName: '', isBlockCoverage: true, ranges }],
    });
  }
  await writeCoverageArtifact(runDir, 'worker-0-page-0', {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId: 'run-file-floor',
    result,
  });
  await sealCoverageRun(runDir, 'passed');
  return { root, runDir, buildDir };
}

function reportArgs(fixture, extra = []) {
  return [
    '--input',
    fixture.runDir,
    '--root',
    fixture.root,
    '--build',
    fixture.buildDir,
    '--json',
    join(fixture.root, 'report.json'),
    '--text',
    join(fixture.root, 'report.txt'),
    ...extra,
  ];
}

// The whole argument for the flag, in one assertion: the same run that clears
// the aggregate floor fails the per-file one.
test('a per-file floor catches a file the aggregate floor averages away', async () => {
  const fixture = await unevenRun();
  try {
    const passed = await main(
      reportArgs(fixture, ['--check-source-regions', '66']),
    );
    assert.equal(passed.summary.regionPercent, 66.67);

    await assert.rejects(
      () => main(reportArgs(fixture, ['--check-source-file-regions', '66'])),
      (error) => {
        assert.match(
          error.message,
          /1 source file\(s\) fall below the required 66% region coverage per file:/,
        );
        assert.match(
          error.message,
          /src\/components\/Uneven\/index\.js 50\.00% \(1\/2 regions; uncovered at 2\)/,
        );
        // The file that is fine must not be named: an offender list that
        // reports every file is a list nobody reads.
        assert.doesNotMatch(error.message, /Covered/);
        return true;
      },
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// Same ordering contract the aggregate gates already hold: a threshold failure
// must still leave behind the report that explains it.
test('--check-source-file-regions keeps the artifacts it fails on', async () => {
  const fixture = await unevenRun();
  try {
    await assert.rejects(() =>
      main(reportArgs(fixture, ['--check-source-file-regions', '100'])),
    );
    const json = JSON.parse(
      await readFile(join(fixture.root, 'report.json'), 'utf8'),
    );
    assert.equal(json.status, 'ok');
    const uneven = json.sources.find((row) =>
      row.file.endsWith('Uneven/index.js'),
    );
    assert.equal(uneven.regionPercent, 50);
    assert.ok(
      (await readFile(join(fixture.root, 'report.txt'), 'utf8')).length > 0,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('--check-source-file-regions passes when every file meets the floor', async () => {
  const fixture = await unevenRun();
  try {
    const report = await main(
      reportArgs(fixture, ['--check-source-file-regions', '50']),
    );
    assert.equal(report.status, 'ok');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('omitting --check-source-file-regions leaves the reporter ungated', async () => {
  const fixture = await unevenRun();
  try {
    const report = await main(reportArgs(fixture));
    assert.equal(report.summary.regionPercent, 66.67);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// A silently-ignored bad threshold would read as a gate in the workflow while
// enforcing nothing, which is worse than no gate at all.
test('--check-source-file-regions rejects thresholds that are not a percentage', async () => {
  for (const value of ['', 'ninety', '-1', '101']) {
    await assert.rejects(
      () => main(['--input', 'unused', '--check-source-file-regions', value]),
      /--check-source-file-regions expects a percentage between 0 and 100/,
    );
  }
});
