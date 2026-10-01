import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
        coveredLines: 2,
        linePercent: 100,
        branchTotal: 2,
        branchCovered: 1,
        branchPercent: 50,
        uncoveredLines: [],
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
    assert.equal(report.sources.length, 2);
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
      /no sourceMappingURL/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
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
      report.sources.map(({ file, branchPercent }) => [file, branchPercent]),
      [
        ['src/components/First/index.js', 100],
        ['src/components/Second/index.js', 0],
      ],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('renderE2ECoverageReport exposes original src paths and no bundle paths', () => {
  const text = renderE2ECoverageReport({
    schemaVersion: 1,
    kind: 'endusers.e2e.coverage-report',
    status: 'ok',
    runId: 'run-1',
    sources: [
      {
        file: 'src/components/Example/index.js',
        executableLines: 2,
        coveredLines: 1,
        linePercent: 50,
        branchTotal: 2,
        branchCovered: 1,
        branchPercent: 50,
        uncoveredLines: [2],
      },
    ],
    summary: {
      executableLines: 2,
      coveredLines: 1,
      linePercent: 50,
      branchTotal: 2,
      branchCovered: 1,
      branchPercent: 50,
    },
    diagnostics: { warnings: [], errors: [] },
    unmappedSources: [],
  });

  assert.match(text, /src\/components\/Example\/index\.js/);
  assert.doesNotMatch(text, /assets\/js/);
});

test('renderE2ECoverageReport names unmapped sources and diagnostics', () => {
  const text = renderE2ECoverageReport({
    schemaVersion: 1,
    kind: 'endusers.e2e.coverage-report-error',
    status: 'tooling-error',
    runId: 'run-1',
    sources: [],
    summary: {
      executableLines: 0,
      coveredLines: 0,
      linePercent: 0,
      branchTotal: 0,
      branchCovered: 0,
      branchPercent: 0,
    },
    unmappedSources: ['src/components/NotLoaded/index.js'],
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
