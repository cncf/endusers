import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import {
  collectE2ECoverage,
  main,
  renderE2ECoverageReport,
  sourcePathFromReference,
} from './tools/e2e-coverage-report.mjs';
import {
  initCoverageRun,
  sealCoverageRun,
  writeCoverageArtifact,
} from './tools/e2e-coverage-run.mjs';
import { transpileJsx } from './tools/jsx-hooks.mjs';

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
  let previousColumn = 0;
  return entries
    .map(([sourceIndex, originalLine]) => {
      const segment = [
        vlq(0),
        vlq(sourceIndex - previousSource),
        vlq(originalLine - previousLine),
        vlq(0 - previousColumn),
      ].join('');
      previousSource = sourceIndex;
      previousLine = originalLine;
      previousColumn = 0;
      return segment;
    })
    .join(';');
}

function mapSingleLine(sourceIndex, originalLine, endColumn) {
  return [
    [vlq(0), vlq(sourceIndex), vlq(originalLine), vlq(0)].join(''),
    [vlq(endColumn), vlq(0), vlq(0), vlq(endColumn)].join(''),
  ].join(',');
}

async function fixtureRun() {
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-report-'));
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  await mkdir(buildDir, { recursive: true });
  await mkdir(join(buildDir, 'assets/js'), { recursive: true });
  await initCoverageRun(runDir, 'run-1', { project: 'chromium' });
  return { root, runDir, buildDir };
}

test('collectE2ECoverage rejects an unsealed run instead of mixing stale data', async () => {
  const fixture = await fixtureRun();
  try {
    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /coverage run is not sealed/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('main labels failed runs as failed and exits nonzero', async () => {
  const fixture = await fixtureRun();
  try {
    await sealCoverageRun(fixture.runDir, 'failed');
    const jsonPath = join(fixture.root, 'failed-report.json');
    const textPath = join(fixture.root, 'failed-report.txt');
    await assert.rejects(
      () =>
        main([
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
        ]),
      /sealed as failed/,
    );
    const report = JSON.parse(await readFile(jsonPath, 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.runStatus, 'failed');
    assert.match(await readFile(textPath, 'utf8'), /status failed/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('a sealed JavaScript-disabled run is valid individually but fails aggregate attribution', async () => {
  const fixture = await fixtureRun();
  try {
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [],
    });
    await sealCoverageRun(fixture.runDir, 'passed');
    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /No src\/\*\* coverage was attributable/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('main surfaces recorded capture-error artifacts instead of treating them as unknown JSON', async () => {
  const fixture = await fixtureRun();
  try {
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0-error', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage-error',
      runId: 'run-1',
      testId: 'metrics-dashboard',
      pageIndex: 0,
      error: { name: 'Error', message: 'stop failed', stack: 'trace' },
    });
    await sealCoverageRun(fixture.runDir, 'passed');
    const jsonPath = join(fixture.root, 'capture-error.json');
    await assert.rejects(
      () =>
        main([
          '--input',
          fixture.runDir,
          '--root',
          fixture.root,
          '--build',
          fixture.buildDir,
          '--json',
          jsonPath,
        ]),
      /metrics-dashboard page 0: stop failed/,
    );
    const report = JSON.parse(await readFile(jsonPath, 'utf8'));
    assert.equal(report.status, 'tooling-error');
    assert.match(report.diagnostics.errors[0], /stop failed/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage maps V8 ranges through an external source map to src lines', async () => {
  const fixture = await fixtureRun();
  try {
    const source = 'const hit = 1;\nconst miss = 2;\n';
    const generated = source;
    const scriptText = `${generated}\n//# sourceMappingURL=app.js.map\n`;
    const script = join(fixture.buildDir, 'assets/js/app.js');
    const map = join(fixture.buildDir, 'assets/js/app.js.map');
    const original = join(fixture.root, 'src/components/Example/index.js');
    await mkdir(join(fixture.root, 'src/components/Example'), {
      recursive: true,
    });
    await writeFile(original, source);
    await writeFile(script, scriptText);
    await writeFile(
      map,
      JSON.stringify({
        version: 3,
        file: 'app.js',
        sources: ['webpack://endusers/./src/components/Example/index.js'],
        sourcesContent: [source],
        names: [],
        mappings: mapLines([
          [0, 0],
          [0, 1],
        ]),
      }),
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/app.js',
          scriptId: '1',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [
                {
                  startOffset: generated.indexOf('const miss'),
                  endOffset: scriptText.length,
                  count: 0,
                },
                { startOffset: 0, endOffset: scriptText.length, count: 1 },
              ],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.equal(report.status, 'ok');
    assert.deepEqual(report.sources, [
      {
        file: 'src/components/Example/index.js',
        executableLines: 2,
        coveredLines: 1,
        linePercent: 50,
        uncoveredLines: [2],
        regions: 2,
        coveredRegions: 1,
        regionPercent: 50,
        uncoveredRegions: [2],
      },
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// v8-to-istanbul builds every region from a *generated* block boundary and maps
// its endpoints back through the source map. Minified output has no mapping at
// most boundaries, so an endpoint lands on whatever mapping precedes it and a
// block that never ran is reported as an original span that demonstrably did:
// at 900592b the report put a zero-count region across useFocusTrap.js lines
// 38-40 -- the Shift+Tab wrap arm that tests/e2e/interactions.spec.js:217
// presses and asserts -- while statement coverage put all three of those lines
// at 1 in the same union (#1035). Those spans inflated the denominator and sent
// contributors to write tests for branches that were already covered.
test('a zero-count region spanning only covered lines is not counted against the file', async () => {
  const fixture = await fixtureRun();
  try {
    const lines = [
      'const a = 1;',
      '',
      'const c = 3;',
      'const d = 4;',
      'const e = 5;',
    ];
    const source = `${lines.join('\n')}\n`;
    const scriptText = `${source}\n//# sourceMappingURL=app.js.map\n`;
    const offset = (text) => source.indexOf(text);
    const original = join(fixture.root, 'src/components/Example/index.js');
    await mkdir(join(fixture.root, 'src/components/Example'), {
      recursive: true,
    });
    await writeFile(original, source);
    await writeFile(join(fixture.buildDir, 'assets/js/app.js'), scriptText);
    await writeFile(
      join(fixture.buildDir, 'assets/js/app.js.map'),
      JSON.stringify({
        version: 3,
        file: 'app.js',
        sources: ['webpack://endusers/./src/components/Example/index.js'],
        sourcesContent: [source],
        names: [],
        // Every line maps at column 0; line 4 carries a second mapping at
        // column 8, so a block opening mid-line resolves inside it rather
        // than snapping back to the start of the line.
        mappings: `${mapLines([
          [0, 0],
          [0, 1],
          [0, 2],
          [0, 3],
          [0, 4],
        ])},${[vlq(8), vlq(0), vlq(0), vlq(8)].join('')}`,
      }),
    );

    // One page runs everything but the last line.
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/app.js',
          scriptId: '1',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [
                {
                  startOffset: 0,
                  endOffset: scriptText.length,
                  count: 1,
                },
                {
                  startOffset: offset('const e'),
                  endOffset: scriptText.length,
                  count: 0,
                },
              ],
            },
          ],
        },
      ],
    });
    // A second page contributes two more zero-count blocks: one over lines
    // 1-3, standing in for the mis-mapped multi-line span (line 2 is blank, so
    // the span has to be judged on the lines that carry statements), and one
    // from inside line 4 to the end of line 5, which closes on a line nothing
    // ran. Only the first is a phantom.
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-1', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/app.js',
          scriptId: '2',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [
                { startOffset: 0, endOffset: scriptText.length, count: 1 },
                { startOffset: 0, endOffset: offset('const d'), count: 0 },
                {
                  startOffset: offset('const d') + 'const d'.length,
                  endOffset: offset('const e') + 'const e = 5;'.length,
                  count: 0,
                },
              ],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.equal(report.status, 'ok');
    const [entry] = report.sources;
    assert.equal(entry.file, 'src/components/Example/index.js');
    assert.deepEqual(entry.uncoveredLines, [5]);
    // Line 1 is gone: nothing in lines 1-3 went unexecuted, so no region can
    // span them unexecuted. The span closing on line 5 and the region confined
    // to line 5 both stay, and so does their weight in the denominator.
    assert.deepEqual(entry.uncoveredRegions, [4, 5]);
    assert.equal(entry.regions - entry.coveredRegions, 2);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// The fold above is deliberately limited to *multi-line* zero spans, and this
// is the boundary it must not cross. Every genuinely uncovered arm the report
// still reports is single-line and sits inside the span of some covered region
// contributed by another artifact of the same script -- that is simply what a
// branch arm inside an enclosing block looks like once V8's ranges are mapped
// back. Measured on the published `e2e-coverage` artifact for run
// 37412914368, GroupLinkStatus's `checkedAt` guard, DirectoryFreshness's
// plural arms and RadarReports' empty-corpus arms are each enclosed exactly as
// the drifted spans in #1079 are, so folding a zero region into a covered one
// that contains it would erase real gaps that tests are still being written
// for (#1094, #1097). Enclosure is therefore not evidence of drift.
//
// The two artifacts below put one zero region, `1:6:1:12`, against three
// covered regions that each enclose it in a different way: `1:0:3:12` from the
// *other* artifact (whole-span containment across artifacts), `1:0:1:12` (the
// same line), and `1:6:3:12` (the same start column, differing end -- the
// shape #1066 proposed keying away). It survives all three.
test('a single-line zero-count region survives a covered region that encloses it', async () => {
  const fixture = await fixtureRun();
  try {
    const lines = ['const a = 1;', 'const b = 2;', 'const c = 3;'];
    const source = `${lines.join('\n')}\n`;
    const scriptText = `${source}\n//# sourceMappingURL=app.js.map\n`;
    const original = join(fixture.root, 'src/components/Example/index.js');
    await mkdir(join(fixture.root, 'src/components/Example'), {
      recursive: true,
    });
    await writeFile(original, source);
    await writeFile(join(fixture.buildDir, 'assets/js/app.js'), scriptText);
    await writeFile(
      join(fixture.buildDir, 'assets/js/app.js.map'),
      JSON.stringify({
        version: 3,
        file: 'app.js',
        sources: ['webpack://endusers/./src/components/Example/index.js'],
        sourcesContent: [source],
        names: [],
        // Line 1 carries a second mapping at column 6 so a block opening and
        // closing inside it resolves to columns of its own instead of
        // snapping back to the start of the line. Without that the zero
        // region would be a zero-width span and prove nothing about columns.
        mappings: [
          `${[vlq(0), vlq(0), vlq(0), vlq(0)].join('')},${[
            vlq(6),
            vlq(0),
            vlq(0),
            vlq(6),
          ].join('')}`,
          `${[vlq(0), vlq(0), vlq(1), vlq(-6)].join('')}`,
          `${[vlq(0), vlq(0), vlq(1), vlq(0)].join('')}`,
        ].join(';'),
      }),
    );

    // One page runs the whole script and nothing else, contributing a covered
    // region that spans every line of the file.
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/app.js',
          scriptId: '1',
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
    // A second page reaches the same script but leaves one arm inside line 1
    // unexecuted. The covered region from the first page encloses it on both
    // lines and columns; it is still a real gap.
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-1', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/app.js',
          scriptId: '2',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [
                { startOffset: 0, endOffset: scriptText.length, count: 1 },
                {
                  startOffset: source.indexOf('= 1;'),
                  endOffset: source.indexOf('= 1;') + '= 1;'.length,
                  count: 0,
                },
              ],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.equal(report.status, 'ok');
    const [entry] = report.sources;
    assert.equal(entry.file, 'src/components/Example/index.js');
    // Every line ran somewhere, so the line view sees nothing -- which is
    // precisely why the region has to survive on its own.
    assert.deepEqual(entry.uncoveredLines, []);
    assert.deepEqual(entry.uncoveredRegions, [1]);
    assert.equal(entry.regions - entry.coveredRegions, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// The shape above survives; this one must not. Two branch spans of one source
// file either nest or stay disjoint, because both are AST extents -- so a
// covered span that *begins inside* a zero span and *ends after* it is a
// crossing, which no source can produce. It only appears when two artifacts of
// the same chunk map one original branch to different spans (#1079): the
// `''` arm of `useBaseUrl(member.logo || '')` in
// `src/components/MemberDirectory/MemberProfile.js` is reported zero at
// `10:40-10:48` by one artifact while another reports it covered at
// `10:44-15:19`, and `15:19-15:80` crosses `15:70-38:15` the same way. The
// start columns differ, so the ordinal key proposed in #1066 keeps them apart,
// and neither contains the other, so #1051's multi-line fold and the
// enclosure rule the test above pins both leave them standing.
//
// Below, the zero region `1:0-1:6` is crossed by the covered `1:3-3:12`: the
// covered region starts at column 3, strictly inside the zero span, and runs
// past its end. That pair cannot both be real, so the zero half is dropped.
test('a zero-count region crossed by a covered one is treated as source-map drift', async () => {
  const fixture = await fixtureRun();
  try {
    const lines = ['const a = 1;', 'const b = 2;', 'const c = 3;'];
    const source = `${lines.join('\n')}\n`;
    const scriptText = `${source}\n//# sourceMappingURL=app.js.map\n`;
    const original = join(fixture.root, 'src/components/Example/index.js');
    await mkdir(join(fixture.root, 'src/components/Example'), {
      recursive: true,
    });
    await writeFile(original, source);
    await writeFile(join(fixture.buildDir, 'assets/js/app.js'), scriptText);
    await writeFile(
      join(fixture.buildDir, 'assets/js/app.js.map'),
      JSON.stringify({
        version: 3,
        file: 'app.js',
        sources: ['webpack://endusers/./src/components/Example/index.js'],
        sourcesContent: [source],
        names: [],
        // Line 1 carries mappings at columns 0, 3 and 6 so that two block
        // boundaries inside it resolve to distinct original columns. Without
        // the middle one the two spans could only nest or coincide, and the
        // crossing this test is about would be unrepresentable.
        mappings: [
          [
            [vlq(0), vlq(0), vlq(0), vlq(0)].join(''),
            [vlq(3), vlq(0), vlq(0), vlq(3)].join(''),
            [vlq(3), vlq(0), vlq(0), vlq(3)].join(''),
          ].join(','),
          [vlq(0), vlq(0), vlq(1), vlq(-6)].join(''),
          [vlq(0), vlq(0), vlq(1), vlq(0)].join(''),
        ].join(';'),
      }),
    );

    // One page runs the whole script, and a block from column 3 onwards twice
    // over -- a loop body. Its differing count is what makes V8 emit the
    // boundary at column 3 at all.
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/app.js',
          scriptId: '1',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [
                { startOffset: 0, endOffset: scriptText.length, count: 1 },
                { startOffset: 3, endOffset: scriptText.length, count: 2 },
              ],
            },
          ],
        },
      ],
    });
    // A second page maps the same original branch to a span that starts
    // earlier and ends earlier, and reports it unexecuted.
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-1', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/app.js',
          scriptId: '2',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [
                { startOffset: 0, endOffset: scriptText.length, count: 1 },
                { startOffset: 0, endOffset: 6, count: 0 },
              ],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.equal(report.status, 'ok');
    const [entry] = report.sources;
    assert.equal(entry.file, 'src/components/Example/index.js');
    assert.deepEqual(entry.uncoveredLines, []);
    assert.deepEqual(entry.uncoveredRegions, []);
    assert.equal(entry.regions, entry.coveredRegions);
    // The drifted half is dropped, not counted as covered: the denominator
    // loses it too, so the file cannot be credited for a region nobody saw.
    assert.equal(entry.regions, 3);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// `npm run build:e2e:coverage` compiles the site twice: once from the real
// data, and once with tests/e2e/fixtures/data-variants/** layered on, into
// build/e2e-coverage-variant under its own base URL. That is what makes a
// branch gated on a document-level field reachable -- clearing the field in
// the one build would swap which arm the one page renders rather than add a
// case -- and it only pays off if the report treats the two builds as one
// measurement. Both conditions are pinned here: a script served under the
// variant base must resolve inside the ordinary build directory, and the lines
// it reached must union with the ones the real build's script reached rather
// than replace them.
test('collectE2ECoverage unions the two builds of one source file', async () => {
  const fixture = await fixtureRun();
  try {
    const source = 'const verified = 1;\nconst unverified = 2;\n';
    const original = join(fixture.root, 'src/components/Example/index.js');
    await mkdir(join(fixture.root, 'src/components/Example'), {
      recursive: true,
    });
    await writeFile(original, source);
    await mkdir(join(fixture.buildDir, 'e2e-coverage-variant/assets/js'), {
      recursive: true,
    });

    // Each build covers the line the other does not: the real page renders the
    // field-present arm, the variant page the arm beside it.
    const builds = [
      { dir: 'assets/js', path: '/assets/js', covered: 0, uncovered: 1 },
      {
        dir: 'e2e-coverage-variant/assets/js',
        path: '/e2e-coverage-variant/assets/js',
        covered: 1,
        uncovered: 0,
      },
    ];
    const lineOffsets = [0, source.indexOf('const unverified')];
    const scriptText = `${source}\n//# sourceMappingURL=app.js.map\n`;
    for (const build of builds) {
      await writeFile(join(fixture.buildDir, build.dir, 'app.js'), scriptText);
      await writeFile(
        join(fixture.buildDir, build.dir, 'app.js.map'),
        JSON.stringify({
          version: 3,
          file: 'app.js',
          sources: ['webpack://endusers/./src/components/Example/index.js'],
          sourcesContent: [source],
          names: [],
          mappings: mapLines([
            [0, 0],
            [0, 1],
          ]),
        }),
      );
      await writeCoverageArtifact(
        fixture.runDir,
        `worker-0-page-${build.covered}`,
        {
          schemaVersion: 1,
          kind: 'endusers.playwright.v8-coverage',
          runId: 'run-1',
          result: [
            {
              url: `http://localhost:3000${build.path}/app.js`,
              scriptId: '1',
              functions: [
                {
                  functionName: '',
                  isBlockCoverage: true,
                  ranges: [
                    {
                      startOffset: lineOffsets[build.uncovered],
                      endOffset:
                        build.uncovered === 0
                          ? lineOffsets[1]
                          : scriptText.length,
                      count: 0,
                    },
                    { startOffset: 0, endOffset: scriptText.length, count: 1 },
                  ],
                },
              ],
            },
          ],
        },
      );
    }
    await sealCoverageRun(fixture.runDir, 'passed');

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.equal(report.status, 'ok');
    assert.deepEqual(report.sources, [
      {
        file: 'src/components/Example/index.js',
        executableLines: 2,
        coveredLines: 2,
        linePercent: 100,
        uncoveredLines: [],
        // One build covers one line and the other build the other, so only
        // the union sees both regions covered -- same property as lines.
        regions: 2,
        coveredRegions: 2,
        regionPercent: 100,
        uncoveredRegions: [],
      },
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage rejects an unreadable source map', async () => {
  const fixture = await fixtureRun();
  try {
    await writeFile(
      join(fixture.buildDir, 'assets.js'),
      'const value = 1;\n//# sourceMappingURL=missing.js.map\n',
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets.js',
          scriptId: '1',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: 15, count: 1 }],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');

    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /source map|missing\.js\.map/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('main awaits conversion and report writes', async () => {
  const fixture = await fixtureRun();
  try {
    const source = 'const value = 1;\n';
    const scriptText = `${source}\n//# sourceMappingURL=main.js.map\n`;
    const script = join(fixture.buildDir, 'assets/js/main.js');
    const map = join(fixture.buildDir, 'assets/js/main.js.map');
    const original = join(fixture.root, 'src/components/Main/index.js');
    await mkdir(join(fixture.root, 'src/components/Main'), {
      recursive: true,
    });
    await writeFile(original, source);
    await writeFile(script, scriptText);
    await writeFile(
      map,
      JSON.stringify({
        version: 3,
        file: 'main.js',
        sources: ['../../../src/components/Main/index.js'],
        sourcesContent: [source],
        names: [],
        mappings: mapLines([[0, 0]]),
      }),
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
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
        {
          url: 'not-a-url',
          scriptId: 'ignored',
          functions: [],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');
    const jsonPath = join(fixture.root, 'report.json');
    const textPath = join(fixture.root, 'report.txt');

    const report = await main([
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
    assert.equal(report.status, 'ok');
    assert.match(await readFile(textPath, 'utf8'), /src\/components\/Main/);
    assert.equal(JSON.parse(await readFile(jsonPath, 'utf8')).status, 'ok');
    await main([
      '--input',
      fixture.runDir,
      '--root',
      fixture.root,
      '--build',
      fixture.buildDir,
      '--json',
      join(fixture.root, 'report-only-json.json'),
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('main writes an honest tooling-error artifact before surfacing failure', async () => {
  const fixture = await fixtureRun();
  try {
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [],
    });

    await sealCoverageRun(fixture.runDir, 'passed');
    const jsonPath = join(fixture.root, 'error-report.json');
    const textPath = join(fixture.root, 'error-report.txt');

    await assert.rejects(
      () =>
        main([
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
        ]),
      /No src\/\*\* coverage was attributable/,
    );
    assert.equal(
      JSON.parse(await readFile(jsonPath, 'utf8')).status,
      'tooling-error',
    );
    assert.match(await readFile(textPath, 'utf8'), /tooling-error/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('report parsing rejects missing and unknown CLI options', async () => {
  await assert.rejects(() => main([]), /--input is required/);
  await assert.rejects(
    () => main(['--input', 'coverage', '--unknown']),
    /unknown e2e coverage report option/,
  );
});

test('collectE2ECoverage rejects source-content mismatch and bad offsets', async () => {
  const fixture = await fixtureRun();
  try {
    const source = 'const value = 1;\n';
    const scriptText = `${source}\n//# sourceMappingURL=bad.js.map\n`;
    const script = join(fixture.buildDir, 'assets/js/bad.js');
    const map = join(fixture.buildDir, 'assets/js/bad.js.map');
    const original = join(fixture.root, 'src/components/Bad/index.js');
    await mkdir(join(fixture.root, 'src/components/Bad'), {
      recursive: true,
    });
    await writeFile(original, source);
    await writeFile(script, scriptText);
    await writeFile(
      map,
      JSON.stringify({
        version: 3,
        file: 'bad.js',
        sources: ['../../../src/components/Bad/index.js'],
        sourcesContent: ['different'],
        names: [],
        mappings: mapLines([[0, 0]]),
      }),
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/bad.js',
          scriptId: 'bad-map',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [
                {
                  startOffset: 0,
                  endOffset: scriptText.length + 1,
                  count: 1,
                },
              ],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');
    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /source map content does not match/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage accepts base64 and URI-encoded inline maps', async () => {
  const fixture = await fixtureRun();
  try {
    const entries = [
      {
        name: 'inline',
        source: 'const inline = 1;\n',
        mapPath: 'src/components/Inline/index.js',
        encode: (map) =>
          `data:application/json;base64,${Buffer.from(
            JSON.stringify(map),
          ).toString('base64')}`,
      },
      {
        name: 'inline-uri',
        source: 'const inlineUri = 2;\n',
        mapPath: 'src/components/InlineUri/index.js',
        encode: (map) =>
          `data:application/json,${encodeURIComponent(JSON.stringify(map))}`,
      },
      {
        // Written without percent-encoding and containing a raw `%` that
        // defeats decodeURIComponent: before #1150 this aborted the whole
        // report with URIError. The undecoded payload is the JSON itself.
        // The source text carries no whitespace because the
        // sourceMappingURL comment only captures up to the first space.
        name: 'inline-raw',
        source: "x='100%';\n",
        mapPath: 'src/components/InlineRaw/index.js',
        encode: (map) => `data:application/json,${JSON.stringify(map)}`,
      },
    ];
    const result = [];
    for (const [index, entry] of entries.entries()) {
      const scriptSource = `${entry.source}\n`;
      const original = join(fixture.root, entry.mapPath);
      const script = join(fixture.buildDir, `assets/js/${entry.name}.js`);
      await mkdir(join(original, '..'), { recursive: true });
      await writeFile(original, entry.source);
      const map = {
        version: 3,
        file: `${entry.name}.js`,
        sources: [`../../../${entry.mapPath}`],
        sourcesContent: [entry.source],
        names: [],
        mappings: mapLines([[0, 0]]),
      };
      await writeFile(
        script,
        `${scriptSource}//# sourceMappingURL=${entry.encode(map)}\n`,
      );
      result.push({
        url: `http://localhost:3000/assets/js/${entry.name}.js`,
        scriptId: String(index + 10),
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [
              { startOffset: 0, endOffset: scriptSource.length, count: 1 },
            ],
          },
        ],
      });
    }
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result,
    });
    await sealCoverageRun(fixture.runDir, 'passed');

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.equal(report.sources.length, 3);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage rejects partial and foreign artifacts', async () => {
  const partial = await fixtureRun();
  try {
    await writeFile(join(partial.runDir, 'partial.tmp'), 'incomplete');
    await sealCoverageRun(partial.runDir, 'passed');
    await assert.rejects(
      () =>
        collectE2ECoverage(partial.runDir, {
          root: partial.root,
          buildDir: partial.buildDir,
        }),
      /incomplete temporary artifacts/,
    );
  } finally {
    await rm(partial.root, { recursive: true, force: true });
  }

  const foreign = await fixtureRun();
  try {
    await writeFile(
      join(foreign.runDir, 'foreign.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'other-kind',
        runId: 'run-1',
        result: [],
      }),
    );
    await sealCoverageRun(foreign.runDir, 'passed');
    await assert.rejects(
      () => collectE2ECoverage(foreign.runDir),
      /unexpected coverage artifact kind/,
    );
  } finally {
    await rm(foreign.root, { recursive: true, force: true });
  }

  const mismatched = await fixtureRun();
  try {
    await writeFile(
      join(mismatched.runDir, 'foreign-run.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'endusers.playwright.v8-coverage',
        runId: 'other-run',
        result: [],
      }),
    );
    await sealCoverageRun(mismatched.runDir, 'passed');
    await assert.rejects(
      () => collectE2ECoverage(mismatched.runDir),
      /belongs to another run/,
    );
  } finally {
    await rm(mismatched.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage rejects an eligible script without a map', async () => {
  const fixture = await fixtureRun();
  try {
    await writeFile(
      join(fixture.buildDir, 'assets/js/no-map.js'),
      'const value = 1;\n',
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/no-map.js',
          scriptId: 'no-map',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: 16, count: 1 }],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');
    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /^Error: generated source has no sourceMappingURL comment$/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage rejects a source map that escapes buildDir', async () => {
  const fixture = await fixtureRun();
  try {
    await mkdir(join(fixture.buildDir, 'assets/js'), { recursive: true });
    await writeFile(
      join(fixture.root, 'outside.map'),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: '' }),
    );
    const script = join(fixture.buildDir, 'assets/js/escape.js');
    const scriptText =
      'const value = 1;\n//# sourceMappingURL=../../../outside.map\n';
    await writeFile(script, scriptText);
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/escape.js',
          scriptId: 'escape',
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
    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /source map escapes build directory/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage rejects symlinked maps, bundles, and sources', async () => {
  const mapFixture = await fixtureRun();
  try {
    const outsideMap = join(mapFixture.root, 'outside.map');
    await writeFile(
      outsideMap,
      JSON.stringify({ version: 3, sources: [], names: [], mappings: '' }),
    );
    await symlink(outsideMap, join(mapFixture.buildDir, 'assets/js/link.map'));
    const script = 'const value = 1;\n//# sourceMappingURL=link.map\n';
    await writeFile(join(mapFixture.buildDir, 'assets/js/link.js'), script);
    await writeCoverageArtifact(mapFixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/link.js',
          scriptId: 'link-map',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: script.length, count: 1 }],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(mapFixture.runDir, 'passed');
    await assert.rejects(
      () =>
        collectE2ECoverage(mapFixture.runDir, {
          root: mapFixture.root,
          buildDir: mapFixture.buildDir,
        }),
      /source map escapes build directory/,
    );
  } finally {
    await rm(mapFixture.root, { recursive: true, force: true });
  }

  const scriptFixture = await fixtureRun();
  try {
    const outsideScript = join(scriptFixture.root, 'outside.js');
    await writeFile(outsideScript, 'const outside = 1;\n');
    await symlink(
      outsideScript,
      join(scriptFixture.buildDir, 'assets/js/link.js'),
    );
    await writeCoverageArtifact(scriptFixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/link.js',
          scriptId: 'link-script',
          functions: [],
        },
      ],
    });
    await sealCoverageRun(scriptFixture.runDir, 'passed');
    await assert.rejects(
      () =>
        collectE2ECoverage(scriptFixture.runDir, {
          root: scriptFixture.root,
          buildDir: scriptFixture.buildDir,
        }),
      /coverage script escapes build directory/,
    );
  } finally {
    await rm(scriptFixture.root, { recursive: true, force: true });
  }

  const sourceFixture = await fixtureRun();
  const outsideSourceRoot = await mkdtemp(
    join(tmpdir(), 'endusers-outside-source-'),
  );
  try {
    const outsideSource = join(outsideSourceRoot, 'outside.js');
    await writeFile(outsideSource, 'const outside = 1;\n');
    await mkdir(join(sourceFixture.root, 'src/components/Link'), {
      recursive: true,
    });
    await symlink(
      outsideSource,
      join(sourceFixture.root, 'src/components/Link/index.js'),
    );
    const script =
      'const value = 1;\n//# sourceMappingURL=link-source.js.map\n';
    await writeFile(
      join(sourceFixture.buildDir, 'assets/js/link-source.js'),
      script,
    );
    await writeFile(
      join(sourceFixture.buildDir, 'assets/js/link-source.js.map'),
      JSON.stringify({
        version: 3,
        file: 'link-source.js',
        sources: ['../../../src/components/Link/index.js'],
        sourcesContent: ['const outside = 1;\n'],
        names: [],
        mappings: 'AAAA',
      }),
    );
    await writeCoverageArtifact(sourceFixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/link-source.js',
          scriptId: 'link-source',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: script.length, count: 1 }],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(sourceFixture.runDir, 'passed');
    await assert.rejects(
      () =>
        collectE2ECoverage(sourceFixture.runDir, {
          root: sourceFixture.root,
          buildDir: sourceFixture.buildDir,
        }),
      /source map source escapes src directory/,
    );
  } finally {
    await rm(sourceFixture.root, { recursive: true, force: true });
    await rm(outsideSourceRoot, { recursive: true, force: true });
  }
});

test('collectE2ECoverage rejects a nominal src symlink to an unrelated repo file', async () => {
  const fixture = await fixtureRun();
  try {
    const privateFixture = join(fixture.root, 'private-fixture.txt');
    const nominalSource = join(fixture.root, 'src/components/Link/index.js');
    const source = 'const privateFixture = 1;\n';
    const script = 'const value = 1;\n//# sourceMappingURL=nominal.js.map\n';
    await writeFile(privateFixture, source);
    await mkdir(join(fixture.root, 'src/components/Link'), {
      recursive: true,
    });
    await symlink(privateFixture, nominalSource);
    await writeFile(join(fixture.buildDir, 'assets/js/nominal.js'), script);
    await writeFile(
      join(fixture.buildDir, 'assets/js/nominal.js.map'),
      JSON.stringify({
        version: 3,
        file: 'nominal.js',
        sources: ['../../../src/components/Link/index.js'],
        sourcesContent: [source],
        names: [],
        mappings: 'AAAA',
      }),
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/nominal.js',
          scriptId: 'nominal',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: script.length, count: 1 }],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');

    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /source map source escapes src directory/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage rejects a src tree symlinked outside the repository', async () => {
  const fixture = await fixtureRun();
  const outsideRoot = await mkdtemp(join(tmpdir(), 'endusers-outside-src-'));
  try {
    // `src` itself is the symlink, so every containment check that resolves
    // through it agrees the source is inside `src` -- only the repository
    // check sees that `src` now points out of the tree.
    const source = 'const outside = 1;\n';
    await mkdir(join(outsideRoot, 'components/Link'), { recursive: true });
    await writeFile(join(outsideRoot, 'components/Link/index.js'), source);
    await symlink(outsideRoot, join(fixture.root, 'src'));
    const script = 'const value = 1;\n//# sourceMappingURL=outside.js.map\n';
    await writeFile(join(fixture.buildDir, 'assets/js/outside.js'), script);
    await writeFile(
      join(fixture.buildDir, 'assets/js/outside.js.map'),
      JSON.stringify({
        version: 3,
        file: 'outside.js',
        sources: ['../../../src/components/Link/index.js'],
        sourcesContent: [source],
        names: [],
        mappings: 'AAAA',
      }),
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/outside.js',
          scriptId: 'outside',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: script.length, count: 1 }],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');

    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /source map source escapes repository/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test('collectE2ECoverage flattens an indexed multi-source map', async () => {
  const fixture = await fixtureRun();
  try {
    const sourceA = 'const first = 1;\n';
    const sourceB = 'const second = 2;\n';
    const generated = `${sourceA}${sourceB}`;
    const scriptText = `${generated}\n//# sourceMappingURL=indexed.js.map\n`;
    const script = join(fixture.buildDir, 'assets/js/indexed.js');
    const map = join(fixture.buildDir, 'assets/js/indexed.js.map');
    const pathA = join(fixture.root, 'src/components/First/index.js');
    const pathB = join(fixture.root, 'src/components/Second/index.js');
    await mkdir(join(fixture.root, 'src/components/First'), {
      recursive: true,
    });
    await mkdir(join(fixture.root, 'src/components/Second'), {
      recursive: true,
    });
    await writeFile(pathA, sourceA);
    await writeFile(pathB, sourceB);
    await writeFile(script, scriptText);
    await writeFile(
      map,
      JSON.stringify({
        version: 3,
        file: 'indexed.js',
        sections: [
          {
            offset: { line: 0, column: 0 },
            map: {
              version: 3,
              sources: ['../../../src/components/First/index.js'],
              sourcesContent: [sourceA],
              names: [],
              mappings: mapSingleLine(0, 0, sourceA.length - 1),
            },
          },
          {
            offset: { line: 1, column: 0 },
            map: {
              version: 3,
              sources: ['../../../src/components/Second/index.js'],
              sourcesContent: [sourceB],
              names: [],
              mappings: mapSingleLine(0, 0, sourceB.length - 1),
            },
          },
        ],
      }),
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/indexed.js',
          scriptId: '2',
          functions: [
            {
              functionName: 'first',
              isBlockCoverage: true,
              ranges: [
                {
                  startOffset: 0,
                  endOffset: sourceA.length - 1,
                  count: 1,
                },
              ],
            },
            {
              functionName: 'second',
              isBlockCoverage: true,
              ranges: [
                {
                  startOffset: sourceA.length,
                  endOffset: scriptText.length,
                  count: 0,
                },
              ],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.deepEqual(
      report.sources.map(({ file, linePercent }) => [file, linePercent]),
      [
        ['src/components/First/index.js', 100],
        ['src/components/Second/index.js', 0],
      ],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage keeps a mapped but unexecuted source explicit', async () => {
  const fixture = await fixtureRun();
  try {
    const sourceA = 'const first = 1;\n';
    const sourceB = 'const second = 2;\n';
    const generated = `${sourceA}${sourceB}`;
    const scriptText = `${generated}\n//# sourceMappingURL=mixed.js.map\n`;
    const pathA = join(fixture.root, 'src/components/MixedA/index.js');
    const pathB = join(fixture.root, 'src/components/MixedB/index.js');
    await mkdir(join(fixture.root, 'src/components/MixedA'), {
      recursive: true,
    });
    await mkdir(join(fixture.root, 'src/components/MixedB'), {
      recursive: true,
    });
    await writeFile(pathA, sourceA);
    await writeFile(pathB, sourceB);
    await writeFile(join(fixture.buildDir, 'assets/js/mixed.js'), scriptText);
    await writeFile(
      join(fixture.buildDir, 'assets/js/mixed.js.map'),
      JSON.stringify({
        version: 3,
        file: 'mixed.js',
        sources: [
          '../../../src/components/MixedA/index.js',
          '../../../src/components/MixedB/index.js',
        ],
        sourcesContent: [sourceA, sourceB],
        names: [],
        mappings: `${mapSingleLine(0, 0, sourceA.length - 1)};${mapSingleLine(1, 0, sourceB.length - 1)}`,
      }),
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/mixed.js',
          scriptId: 'mixed',
          functions: [
            {
              functionName: 'first',
              isBlockCoverage: true,
              ranges: [
                { startOffset: 0, endOffset: sourceA.length - 1, count: 1 },
              ],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.deepEqual(
      report.sources.map((row) => row.file),
      ['src/components/MixedA/index.js'],
    );
    assert.deepEqual(report.unmappedSources, [
      'src/components/MixedB/index.js',
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage attributes a real JSX source map to original lines', async () => {
  const fixture = await fixtureRun();
  try {
    const source =
      'export default function Widget() {\n' +
      '  return <div>Cloud Native</div>;\n' +
      '}\n';
    const original = join(fixture.root, 'src/components/Widget/index.js');
    const script = join(fixture.buildDir, 'assets/js/widget.js');
    const mapPath = join(fixture.buildDir, 'assets/js/widget.js.map');
    await mkdir(join(fixture.root, 'src/components/Widget'), {
      recursive: true,
    });
    await writeFile(original, source);
    const transformed = transpileJsx(source, original);
    const scriptText = `${transformed.code}\n//# sourceMappingURL=widget.js.map\n`;
    await writeFile(script, scriptText);
    await writeFile(mapPath, transformed.map);
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/widget.js',
          scriptId: 'jsx',
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

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.deepEqual(report.sources, [
      {
        file: 'src/components/Widget/index.js',
        executableLines: 3,
        coveredLines: 3,
        linePercent: 100,
        uncoveredLines: [],
        // Straight-line JSX with no block ranges yields no branch regions;
        // zero regions report as 100%, matching the unit reporter.
        regions: 0,
        coveredRegions: 0,
        regionPercent: 100,
        uncoveredRegions: [],
      },
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage attributes a real mjs source map to exact lines', async () => {
  const fixture = await fixtureRun();
  try {
    const source = 'export const first = 1;\nexport const second = 2;\n';
    const original = join(fixture.root, 'src/lib/example.mjs');
    const script = join(fixture.buildDir, 'assets/js/example.js');
    const map = join(fixture.buildDir, 'assets/js/example.js.map');
    await mkdir(join(fixture.root, 'src/lib'), { recursive: true });
    await writeFile(original, source);
    await writeFile(script, `${source}\n//# sourceMappingURL=example.js.map\n`);
    await writeFile(
      map,
      JSON.stringify({
        version: 3,
        file: 'example.js',
        sources: ['../../../src/lib/example.mjs'],
        sourcesContent: [source],
        names: [],
        mappings: mapLines([
          [0, 0],
          [0, 1],
        ]),
      }),
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/example.js',
          scriptId: 'mjs',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [
                {
                  startOffset: 0,
                  endOffset: source.length + 1,
                  count: 1,
                },
              ],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.deepEqual(report.sources, [
      {
        file: 'src/lib/example.mjs',
        executableLines: 2,
        coveredLines: 2,
        linePercent: 100,
        uncoveredLines: [],
        regions: 1,
        coveredRegions: 1,
        regionPercent: 100,
        uncoveredRegions: [],
      },
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('renderE2ECoverageReport exposes original src paths and no bundle paths', () => {
  const text = renderE2ECoverageReport({
    schemaVersion: 2,
    kind: 'endusers.e2e.coverage-report',
    status: 'ok',
    runId: 'run-1',
    sources: [
      {
        file: 'src/components/Example/index.js',
        executableLines: 2,
        coveredLines: 1,
        linePercent: 50,
        uncoveredLines: [2],
        regions: 2,
        coveredRegions: 1,
        regionPercent: 50,
        uncoveredRegions: [2],
      },
    ],
    summary: {
      executableLines: 2,
      coveredLines: 1,
      linePercent: 50,
      regions: 2,
      coveredRegions: 1,
      regionPercent: 50,
    },
    diagnostics: { warnings: [], errors: [] },
    unmappedSources: [],
    missingSourceFiles: [],
  });

  assert.match(text, /src\/components\/Example\/index\.js/);
  assert.doesNotMatch(text, /assets\/js/);
  // The region column is what makes a --check-source-regions failure
  // diagnosable from the text artifact alone.
  assert.match(
    text,
    /file \| line % \| region % \| uncovered lines \| uncovered regions/,
  );
  assert.match(
    text,
    /src files \| 50\.00 \| 50\.00 \| 1\/2 lines \| 1\/2 regions/,
  );
});

test('renderE2ECoverageReport names unmapped sources and diagnostics', () => {
  const text = renderE2ECoverageReport({
    schemaVersion: 2,
    kind: 'endusers.e2e.coverage-report-error',
    status: 'tooling-error',
    runId: 'run-1',
    sources: [],
    summary: {
      executableLines: 0,
      coveredLines: 0,
      linePercent: 0,
      regions: 0,
      coveredRegions: 0,
      regionPercent: 0,
    },
    unmappedSources: ['src/components/NotLoaded/index.js'],
    missingSourceFiles: [],
    diagnostics: { warnings: [], errors: ['invalid map'] },
  });
  assert.match(text, /Unmapped sources/);
  assert.match(text, /invalid map/);
});

test('sourcePathFromReference handles empty and webpack source references', () => {
  assert.equal(
    sourcePathFromReference('', '/repo/build/app.js.map', '/repo'),
    null,
  );
  assert.deepEqual(
    sourcePathFromReference(
      'webpack://endusers/./src/components/Example/index.js',
      '/repo/build/app.js.map',
      '/repo',
    ),
    {
      absolute: '/repo/src/components/Example/index.js',
      relative: 'src/components/Example/index.js',
    },
  );
});

// Before #1150 a stray `%` in a sources entry threw URIError out of the
// decode and aborted the entire report; the undecoded text is now treated as
// the already-decoded path, with containment still enforced afterwards.
test('sourcePathFromReference tolerates a reference that defeats percent-decoding', () => {
  assert.deepEqual(
    sourcePathFromReference(
      'webpack://endusers/./src/components/Share/100%.js',
      '/repo/build/app.js.map',
      '/repo',
    ),
    {
      absolute: '/repo/src/components/Share/100%.js',
      relative: 'src/components/Share/100%.js',
    },
  );
  assert.equal(
    sourcePathFromReference('../100%.js', '/repo/build/app.js.map', '/repo'),
    null,
  );
});

/**
 * A build whose bundle, map and original source all agree, so each test below
 * can tamper with exactly one field and attribute the rejection to the guard
 * under test rather than to an unrelated inconsistency.
 */
async function tamperFixture(name) {
  const fixture = await fixtureRun();
  const source = 'const value = 1;\n';
  const scriptText = `${source}\n//# sourceMappingURL=${name}.js.map\n`;
  const script = join(fixture.buildDir, `assets/js/${name}.js`);
  await mkdir(join(fixture.root, `src/components/${name}`), {
    recursive: true,
  });
  await writeFile(
    join(fixture.root, `src/components/${name}/index.js`),
    source,
  );
  await writeFile(script, scriptText);
  await writeFile(
    join(fixture.buildDir, `assets/js/${name}.js.map`),
    JSON.stringify({
      version: 3,
      file: `${name}.js`,
      sources: [`../../../src/components/${name}/index.js`],
      sourcesContent: [source],
      names: [],
      mappings: mapLines([[0, 0]]),
    }),
  );
  return { ...fixture, scriptText, source, script };
}

function coverageEntry(url, scriptText, extra = {}) {
  return {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId: 'run-1',
    result: [
      {
        url,
        scriptId: 'tampered',
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [
              { startOffset: 0, endOffset: scriptText.length, count: 1 },
            ],
          },
        ],
        ...extra,
      },
    ],
  };
}

test('collectE2ECoverage rejects a coverage URL that escapes the build directory', async () => {
  const fixture = await fixtureRun();
  try {
    const scriptText = 'const value = 1;\n';
    await writeFile(join(fixture.root, 'outside.js'), scriptText);
    await writeCoverageArtifact(
      fixture.runDir,
      'worker-0-page-0',
      // Encoded as one opaque segment so URL parsing cannot normalise the
      // traversal away before the guard sees it.
      coverageEntry('http://localhost:3000/%2e%2e%2foutside.js', scriptText),
    );
    await sealCoverageRun(fixture.runDir, 'passed');
    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /coverage script escapes build directory/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage rejects a recorded source length that disagrees with the bundle', async () => {
  const fixture = await tamperFixture('LengthMismatch');
  try {
    await writeCoverageArtifact(
      fixture.runDir,
      'worker-0-page-0',
      coverageEntry(
        'http://localhost:3000/assets/js/LengthMismatch.js',
        fixture.scriptText,
        { sourceLength: fixture.scriptText.length + 1 },
      ),
    );
    await sealCoverageRun(fixture.runDir, 'passed');
    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /generated source length mismatch/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage rejects a recorded source hash that disagrees with the bundle', async () => {
  const fixture = await tamperFixture('HashMismatch');
  try {
    await writeCoverageArtifact(
      fixture.runDir,
      'worker-0-page-0',
      coverageEntry(
        'http://localhost:3000/assets/js/HashMismatch.js',
        fixture.scriptText,
        {
          sourceLength: fixture.scriptText.length,
          sourceSha256: createHash('sha256').update('other').digest('hex'),
        },
      ),
    );
    await sealCoverageRun(fixture.runDir, 'passed');
    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /generated source hash mismatch/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage rejects coverage offsets past the end of the bundle', async () => {
  const fixture = await tamperFixture('OffsetOverflow');
  try {
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/OffsetOverflow.js',
          scriptId: 'overflow',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [
                {
                  startOffset: 0,
                  endOffset: fixture.scriptText.length + 1,
                  count: 1,
                },
              ],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');
    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /coverage offsets exceed generated source length/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('sourcePathFromReference unwraps a webpack loader chain to the real file', () => {
  assert.deepEqual(
    sourcePathFromReference(
      'webpack://endusers/./node_modules/babel-loader/lib/index.js|/repo/src/components/Example/index.js',
      '/repo/build/assets/js/app.js.map',
      '/repo',
    ),
    {
      absolute: '/repo/src/components/Example/index.js',
      relative: 'src/components/Example/index.js',
    },
  );
});

test('sourcePathFromReference rejects an absolute reference outside the repository', () => {
  assert.equal(
    sourcePathFromReference(
      '/elsewhere/lib/index.js',
      '/repo/build/assets/js/app.js.map',
      '/repo',
    ),
    null,
  );
});

test('sourcePathFromReference never returns a path outside <root>/src', () => {
  // The single containment guard in normalizeSourceMap checks the *resolved*
  // path, because this contract already rules out a lexical escape. Pin it:
  // every reference either resolves inside <root>/src or is rejected outright.
  const mapPath = '/repo/build/assets/js/app.js.map';
  const root = '/repo';
  const srcRoot = '/repo/src';
  const references = [
    '../../../src/components/Example/index.js',
    '../../../../elsewhere/lib/index.js',
    '/repo/docusaurus.config.js',
    '/repo/src/../scripts/validate-members.mjs',
    '/repo/srcish/index.js',
    '/repo/src',
    'webpack://endusers/./src/components/Example/index.js',
    'webpack://endusers/./node_modules/clsx/dist/clsx.js',
    'file:///repo/src/components/Example/index.js',
    'file:///repo/package.json',
    'src/../../outside.js',
    '%2e%2e/%2e%2e/outside.js',
    'src\\components\\Example\\index.js',
  ];

  for (const reference of references) {
    const resolved = sourcePathFromReference(reference, mapPath, root);
    if (resolved === null) continue;
    assert.ok(
      resolved.absolute === join(srcRoot, relative(srcRoot, resolved.absolute)),
      `${reference} resolved outside src: ${resolved.absolute}`,
    );
    assert.ok(
      resolved.relative.startsWith('src/'),
      `${reference} produced a non-src relative path: ${resolved.relative}`,
    );
  }
});

test('collectE2ECoverage ignores a bundled dependency alongside a src source', async () => {
  const fixture = await fixtureRun();
  try {
    const appSource = 'const app = 1;\n';
    const vendorSource = 'const vendor = 2;\n';
    const generated = `${appSource}${vendorSource}`;
    const scriptText = `${generated}\n//# sourceMappingURL=mixed.js.map\n`;
    const script = join(fixture.buildDir, 'assets/js/mixed.js');
    await mkdir(join(fixture.root, 'src/components/Mixed'), {
      recursive: true,
    });
    await writeFile(
      join(fixture.root, 'src/components/Mixed/index.js'),
      appSource,
    );
    await writeFile(script, scriptText);
    await writeFile(
      join(fixture.buildDir, 'assets/js/mixed.js.map'),
      JSON.stringify({
        version: 3,
        file: 'mixed.js',
        sources: [
          '../../../src/components/Mixed/index.js',
          'webpack://endusers/./node_modules/vendor/lib.js',
        ],
        sourcesContent: [appSource, vendorSource],
        names: [],
        mappings: mapLines([
          [0, 0],
          [1, 0],
        ]),
      }),
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/mixed.js',
          scriptId: '1',
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

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.equal(report.status, 'ok');
    assert.deepEqual(
      report.sources.map(({ file }) => file),
      ['src/components/Mixed/index.js'],
    );
    assert.ok(
      !JSON.stringify(report).includes('node_modules'),
      'a bundled dependency must not reach the report',
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage ignores a non-script src source such as a stylesheet', async () => {
  const fixture = await fixtureRun();
  try {
    const appSource = 'const styled = 1;\n';
    const styleSource = '.styled {\n  color: red;\n}\n';
    const generated = `${appSource}${styleSource}`;
    const scriptText = `${generated}\n//# sourceMappingURL=styled.js.map\n`;
    const script = join(fixture.buildDir, 'assets/js/styled.js');
    await mkdir(join(fixture.root, 'src/components/Styled'), {
      recursive: true,
    });
    await writeFile(
      join(fixture.root, 'src/components/Styled/index.js'),
      appSource,
    );
    await writeFile(
      join(fixture.root, 'src/components/Styled/styles.module.css'),
      styleSource,
    );
    await writeFile(script, scriptText);
    await writeFile(
      join(fixture.buildDir, 'assets/js/styled.js.map'),
      JSON.stringify({
        version: 3,
        file: 'styled.js',
        sources: [
          '../../../src/components/Styled/index.js',
          '../../../src/components/Styled/styles.module.css',
        ],
        sourcesContent: [appSource, styleSource],
        names: [],
        mappings: mapLines([
          [0, 0],
          [1, 0],
        ]),
      }),
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/styled.js',
          scriptId: '1',
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

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.equal(report.status, 'ok');
    assert.deepEqual(
      report.sources.map(({ file }) => file),
      ['src/components/Styled/index.js'],
    );
    assert.ok(
      !JSON.stringify(report).includes('styles.module.css'),
      'a stylesheet must not be reported as covered source',
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('collectE2ECoverage reports a script recorded with no functions as unattributable', async () => {
  const fixture = await fixtureRun();
  try {
    const source = 'const idle = 1;\n';
    const scriptText = `${source}\n//# sourceMappingURL=idle.js.map\n`;
    const script = join(fixture.buildDir, 'assets/js/idle.js');
    await mkdir(join(fixture.root, 'src/components/Idle'), {
      recursive: true,
    });
    await writeFile(join(fixture.root, 'src/components/Idle/index.js'), source);
    await writeFile(script, scriptText);
    await writeFile(
      join(fixture.buildDir, 'assets/js/idle.js.map'),
      JSON.stringify({
        version: 3,
        file: 'idle.js',
        sources: ['../../../src/components/Idle/index.js'],
        sourcesContent: [source],
        names: [],
        mappings: mapLines([[0, 0]]),
      }),
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/idle.js',
          scriptId: '1',
          functions: [],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');

    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /No src\/\*\* coverage was attributable/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('sourcePathFromReference rejects a webpack reference with no path after the authority', () => {
  // `webpack://<authority>` with no following slash leaves nothing to resolve,
  // so the reference must not fall through to the map's own directory.
  assert.equal(
    sourcePathFromReference(
      'webpack://endusers',
      '/repo/build/assets/js/app.js.map',
      '/repo',
    ),
    null,
  );
});

test('sourcePathFromReference rejects a reference that resolves to the repository root', () => {
  // Containment alone accepts the root itself; only the repo-relative form
  // being empty rejects it.
  assert.equal(
    sourcePathFromReference(
      '../../..',
      '/repo/build/assets/js/app.js.map',
      '/repo',
    ),
    null,
  );
});

test('collectE2ECoverage reads original content from disk when the map omits sourcesContent', async () => {
  const fixture = await fixtureRun();
  try {
    const source = 'const hit = 1;\nconst miss = 2;\n';
    const scriptText = `${source}\n//# sourceMappingURL=app.js.map\n`;
    const script = join(fixture.buildDir, 'assets/js/app.js');
    const map = join(fixture.buildDir, 'assets/js/app.js.map');
    const original = join(fixture.root, 'src/components/Example/index.js');
    await mkdir(join(fixture.root, 'src/components/Example'), {
      recursive: true,
    });
    await writeFile(original, source);
    await writeFile(script, scriptText);
    await writeFile(
      map,
      JSON.stringify({
        version: 3,
        file: 'app.js',
        // Both a src source and an external one, and no sourcesContent at all:
        // the src source must be read from disk and the external one blanked.
        sources: [
          'webpack://endusers/./src/components/Example/index.js',
          'webpack://endusers/./node_modules/vendor/index.js',
        ],
        names: [],
        mappings: mapLines([
          [0, 0],
          [0, 1],
        ]),
      }),
    );
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/app.js',
          scriptId: '1',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [
                {
                  startOffset: source.indexOf('const miss'),
                  endOffset: scriptText.length,
                  count: 0,
                },
                { startOffset: 0, endOffset: scriptText.length, count: 1 },
              ],
            },
          ],
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed');

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.equal(report.status, 'ok');
    assert.deepEqual(report.sources, [
      {
        file: 'src/components/Example/index.js',
        executableLines: 2,
        coveredLines: 1,
        linePercent: 50,
        uncoveredLines: [2],
        regions: 2,
        coveredRegions: 1,
        regionPercent: 50,
        uncoveredRegions: [2],
      },
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// The published artifact has to carry its own inputs. Rendering it required a
// byte-identical build/, and that build does not reproduce outside the runner,
// so the number behind the merge gate could not be audited anywhere else.
async function selfContainedFixture({ writeMap = true } = {}) {
  const fixture = await fixtureRun();
  const source = 'const hit = 1;\nconst miss = 2;\n';
  const scriptText = `${source}\n//# sourceMappingURL=app.js.map\n`;
  const original = join(fixture.root, 'src/components/Example/index.js');
  await mkdir(join(fixture.root, 'src/components/Example'), {
    recursive: true,
  });
  await writeFile(original, source);
  await writeFile(join(fixture.buildDir, 'assets/js/app.js'), scriptText);
  if (writeMap) {
    await writeFile(
      join(fixture.buildDir, 'assets/js/app.js.map'),
      JSON.stringify({
        version: 3,
        file: 'app.js',
        sources: ['webpack://endusers/./src/components/Example/index.js'],
        sourcesContent: [source],
        names: [],
        mappings: mapLines([
          [0, 0],
          [0, 1],
        ]),
      }),
    );
  }
  await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId: 'run-1',
    result: [
      {
        url: 'http://localhost:3000/assets/js/app.js',
        scriptId: '1',
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [
              {
                startOffset: source.indexOf('const miss'),
                endOffset: scriptText.length,
                count: 0,
              },
              { startOffset: 0, endOffset: scriptText.length, count: 1 },
            ],
          },
        ],
      },
    ],
  });
  return { ...fixture, scriptText };
}

test('collectE2ECoverage renders a sealed run after the build directory is gone', async () => {
  const fixture = await selfContainedFixture();
  try {
    const manifest = await sealCoverageRun(fixture.runDir, 'passed', {
      buildDir: fixture.buildDir,
    });
    assert.equal(manifest.capturedScripts, 2);
    assert.deepEqual(manifest.uncapturedScripts, []);

    // The exact condition an auditor is in: the artifact, the repository, and
    // no build whatsoever.
    await rm(fixture.buildDir, { recursive: true, force: true });

    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.equal(report.status, 'ok');
    assert.deepEqual(
      report.sources.map((entry) => [
        entry.file,
        entry.executableLines,
        entry.coveredLines,
      ]),
      [['src/components/Example/index.js', 2, 1]],
    );
    assert.deepEqual(report.sources[0].uncoveredLines, [2]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('the captured copy is still held to the recorded source hash', async () => {
  const fixture = await selfContainedFixture();
  try {
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-1', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/assets/js/app.js',
          scriptId: '2',
          functions: [],
          sourceLength: fixture.scriptText.length,
          sourceSha256: createHash('sha256')
            .update(fixture.scriptText)
            .digest('hex'),
        },
      ],
    });
    await sealCoverageRun(fixture.runDir, 'passed', {
      buildDir: fixture.buildDir,
    });
    await rm(fixture.buildDir, { recursive: true, force: true });

    // A self-contained artifact is only trustworthy while the integrity checks
    // still apply to the copy that travels with it.
    const captured = join(fixture.runDir, 'scripts/assets/js/app.js');
    await writeFile(captured, fixture.scriptText.replace('hit', 'HIT'));
    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /generated source hash mismatch/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('a script resolvable from no root fails the report closed', async () => {
  const fixture = await selfContainedFixture();
  try {
    await sealCoverageRun(fixture.runDir, 'passed', {
      buildDir: fixture.buildDir,
    });
    await rm(fixture.buildDir, { recursive: true, force: true });
    await rm(join(fixture.runDir, 'scripts'), {
      recursive: true,
      force: true,
    });
    // Skipping the script instead would let the gate pass on partial data.
    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /coverage script not found/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('a script whose source map is missing is left to the build directory', async () => {
  const fixture = await selfContainedFixture({ writeMap: false });
  try {
    const manifest = await sealCoverageRun(fixture.runDir, 'passed', {
      buildDir: fixture.buildDir,
    });
    // Copying the script without its map would shadow a usable build/ copy
    // with one the reporter cannot map, so neither is captured.
    assert.equal(manifest.capturedScripts, 0);
    assert.deepEqual(manifest.uncapturedScripts, ['assets/js/app.js']);
    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /ENOENT/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('sealing without a build directory captures nothing', async () => {
  const fixture = await selfContainedFixture();
  try {
    const manifest = await sealCoverageRun(fixture.runDir, 'passed');
    assert.equal(manifest.capturedScripts, undefined);
    assert.equal(manifest.uncapturedScripts, undefined);
    const report = await collectE2ECoverage(fixture.runDir, {
      root: fixture.root,
      buildDir: fixture.buildDir,
    });
    assert.equal(report.status, 'ok');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('an escaping coverage URL is declined by capture and rejected by the report', async () => {
  const fixture = await fixtureRun();
  try {
    await writeFile(join(fixture.root, 'outside.js'), 'const outside = 1;\n');
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [
        {
          url: 'http://localhost:3000/%2e%2e%2foutside.js',
          scriptId: '1',
          functions: [],
        },
      ],
    });
    // Capture declines quietly so that sealing a run can never fail on a
    // hostile URL; the reporter stays the one place that rejects it.
    const manifest = await sealCoverageRun(fixture.runDir, 'passed', {
      buildDir: fixture.buildDir,
    });
    assert.equal(manifest.capturedScripts, 0);
    await assert.rejects(
      () =>
        collectE2ECoverage(fixture.runDir, {
          root: fixture.root,
          buildDir: fixture.buildDir,
        }),
      /coverage script escapes build directory/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('a tooling-error artifact still names the run the manifest records', async () => {
  const fixture = await fixtureRun();
  try {
    await writeCoverageArtifact(fixture.runDir, 'worker-0-page-0', {
      schemaVersion: 1,
      kind: 'endusers.playwright.v8-coverage',
      runId: 'run-1',
      result: [],
    });
    await sealCoverageRun(fixture.runDir, 'passed');
    const jsonPath = join(fixture.root, 'identified-error.json');
    const textPath = join(fixture.root, 'identified-error.txt');

    await assert.rejects(
      () =>
        main([
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
        ]),
      /No src\/\*\* coverage was attributable/,
    );

    const report = JSON.parse(await readFile(jsonPath, 'utf8'));
    assert.equal(report.status, 'tooling-error');
    assert.equal(report.runId, 'run-1');
    assert.equal(report.runStatus, 'passed');
    assert.match(
      await readFile(textPath, 'utf8'),
      /^E2E coverage: tooling-error \(run run-1; status passed\)$/mu,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('a tooling-error artifact reports no run when the manifest is unreadable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-report-'));
  try {
    const runDir = join(root, 'coverage');
    await mkdir(runDir, { recursive: true });
    const jsonPath = join(root, 'unreadable-error.json');

    await assert.rejects(() =>
      main(['--input', runDir, '--root', root, '--json', jsonPath]),
    );

    const report = JSON.parse(await readFile(jsonPath, 'utf8'));
    assert.equal(report.status, 'tooling-error');
    assert.equal(report.runId, null);
    assert.equal(report.runStatus, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
