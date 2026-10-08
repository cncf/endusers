// `tests/tools/` is walked by `--require-source-files`, so every module in it
// is *required* to be measured -- and until the `--check-harness` family
// existed, nothing scored what the measurement said.
//
// The reason is structural rather than an oversight of degree.
// `--check-source`, `--check-source-regions` and `--check-source-file-regions`
// are all built from `isSourceFile()`, which classifies everything under
// `tests/` as non-source, so the harness enters none of their ratios. The only
// floor left over it was `--check-regions`, an all-files aggregate over ~8900
// regions that the suite's own test files dominate: a harness module could
// lose every region it has and move that number by a fraction of a percent.
//
// That matters more here than the arithmetic suggests. `tests/tools/` is where
// the coverage reporters, the Playwright coverage fixture, the data-overlay
// loader and the JSX/DOM harness live, so a gap there is a gap in the
// instrument every other gate reads.
//
// These tests pin what the family is for: that the harness gets a row of its
// own rather than being folded into `src files`, that the row is built from
// the same `SOURCE_ROOTS` entry `--require-source-files` walks, that each of
// the three floors fails on a real run, that the per-file floor names the
// file and its uncovered regions, and that none of them passes vacuously over
// a run that recorded no harness file at all.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  countsForScript,
  isHarnessFile,
  isSourceFile,
  report,
} from './tools/coverage-report.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORTER = fileURLToPath(
  new URL('./tools/coverage-report.mjs', import.meta.url),
);

// Mirrors tests/coverage-report-file-region-floor.test.mjs: NODE_V8_COVERAGE
// stays set for the reporter itself (it overrides the variable for the `node
// --test` it spawns, so the grandchild writes elsewhere), and NODE_TEST_CONTEXT
// is removed because `node --test` refuses to run inside another runner.
function runReporter(args) {
  const env = { ...process.env, TZ: 'UTC' };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [REPORTER, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
  });
}

// A driver that imports a harness module without calling into it, so that
// module's function bodies are recorded as uncovered lines and regions. It is
// written inside the repository because the reporter maps coverage records
// onto repo-relative paths and drops everything outside, and it is
// dot-prefixed so `node --test`'s own discovery (which matches *.test.*)
// cannot pick it up while it exists; the reporter is handed the path
// explicitly.
function withImportOnlyDriver(body) {
  const relative = `tests/.coverage-harness-floor-${randomUUID()}.mjs`;
  writeFileSync(
    join(REPO_ROOT, relative),
    [
      "import test from 'node:test';",
      "import * as staticReferences from './tools/static-references.mjs';",
      "test('imports a harness module without exercising it', () => {",
      "  if (!staticReferences) throw new Error('module did not load');",
      '});',
      '',
    ].join('\n'),
  );
  try {
    return body(relative);
  } finally {
    rmSync(join(REPO_ROOT, relative), { force: true });
  }
}

function silently(body) {
  const log = console.log;
  console.log = () => {};
  try {
    return body();
  } finally {
    console.log = log;
  }
}

// One function whose body never ran, inside a file whose every line is
// otherwise executed: the sub-line gap shape the line gates cannot see.
const PARTIAL_SOURCE = 'export const pick = (value) => value ?? fallback();\n';

function partialCounts() {
  return countsForScript(
    {
      functions: [
        {
          ranges: [
            { startOffset: 0, endOffset: PARTIAL_SOURCE.length, count: 1 },
            { startOffset: 40, endOffset: 50, count: 0 },
          ],
        },
      ],
    },
    PARTIAL_SOURCE.length,
  );
}

function mergedWith(files) {
  return new Map(
    files.map((file) => [
      file,
      { source: PARTIAL_SOURCE, counts: partialCounts() },
    ]),
  );
}

// The predicate is what keeps the row and the file-set floor naming the same
// tree. tests/tools/ is the one subtree of tests/ that --require-source-files
// enumerates, and it is deliberately not source: both halves of that have to
// hold at once or the harness falls through the gap between them again.
test('the harness tree is the part of SOURCE_ROOTS that is not source', () => {
  assert.equal(isHarnessFile('tests/tools/coverage-report.mjs'), true);
  assert.equal(isHarnessFile('tests/tools/docusaurus-stubs/Link.mjs'), true);
  assert.equal(isSourceFile('tests/tools/coverage-report.mjs'), false);

  // Everything else under tests/ is the suite measuring itself: neither
  // source nor harness, and in no gated row.
  assert.equal(isHarnessFile('tests/static-assets.test.mjs'), false);
  assert.equal(isHarnessFile('tests/tools-of-the-trade.mjs'), false);
  // The shipped trees stay source; the harness row must not quietly annex
  // them and score them against a laxer floor.
  assert.equal(isHarnessFile('scripts/lib/validate-utils.mjs'), false);
  assert.equal(isHarnessFile('src/components/Foo/index.js'), false);
});

test('report() summarises the harness separately from src files', () => {
  const merged = mergedWith([
    'src/lib/partial.mjs',
    'tests/tools/partial.mjs',
    // Neither source nor harness: it must land in `all files` alone.
    'tests/partial.test.mjs',
  ]);

  const totals = silently(() => report(merged));

  assert.deepEqual(
    totals.harnessFileRegions.map((entry) => entry.file),
    ['tests/tools/partial.mjs'],
  );
  assert.deepEqual(
    totals.sourceFileRegions.map((entry) => entry.file),
    ['src/lib/partial.mjs'],
  );
  // The zero-count range splits the file into three regions: the covered run
  // before it, the gap itself, and the covered run after.
  const [entry] = totals.harnessFileRegions;
  assert.equal(entry.regions, 3);
  assert.equal(entry.covered, 2);
  assert.equal(Number(entry.percent.toFixed(2)), 66.67);
  assert.ok(entry.uncovered.length > 0);
  assert.equal(Number(totals.harnessRegionPct.toFixed(2)), 66.67);
  assert.equal(totals.harnessLinePct, 100);
  assert.equal(totals.harnessExecutable, 1);
  assert.equal(totals.harnessRegions, 3);
  // Three rows, three denominators: folding the harness into `src files`
  // would let its gap be paid for out of the shipped tree's slack.
  assert.equal(totals.sourceRegions, 3);
  assert.equal(Number(totals.totalRegionPct.toFixed(2)), 66.67);
});

test('the report prints a harness files row beside src files', () => {
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    report(mergedWith(['src/lib/partial.mjs', 'tests/tools/partial.mjs']));
  } finally {
    console.log = log;
  }
  const labels = lines
    .map((line) => line.split('|')[0].trim())
    .filter((label) =>
      ['src files', 'harness files', 'all files'].includes(label),
    );
  assert.deepEqual(labels, ['src files', 'harness files', 'all files']);
  const harnessRow = lines.find((line) => line.startsWith('harness files'));
  assert.match(
    harnessRow,
    /\| +100\.00 \| +66\.67 \| 1\/1 lines \| 2\/3 regions$/,
  );
});

test('--check-harness fails a run the source line gate passes', () => {
  withImportOnlyDriver((driver) => {
    // The driver loads a harness module and nothing under scripts/ or src/,
    // so --check-source cannot speak to this run at all while the harness
    // line ratio is plainly short of 100.
    const result = runReporter(['--check-harness', '100', '--', driver]);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Harness line coverage \d+\.\d{2}% is below the required 100%\./,
    );
  });
});

test('--check-harness-regions fails on the harness alone', () => {
  withImportOnlyDriver((driver) => {
    const result = runReporter([
      '--check-harness-regions',
      '100',
      '--',
      driver,
    ]);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Harness region coverage \d+\.\d{2}% is below the required 100%\./,
    );
  });
});

test('--check-harness-file-regions names the file, its ratio and its uncovered regions', () => {
  withImportOnlyDriver((driver) => {
    const result = runReporter([
      '--check-harness-file-regions',
      '100',
      '--',
      driver,
    ]);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /1 harness file\(s\) fall below the required 100% region coverage per file:/,
    );
    assert.match(
      result.stderr,
      /^ {2}tests\/tools\/static-references\.mjs \d+\.\d{2}% \(\d+\/\d+ regions; uncovered at \d[\d\s-]*\)$/m,
    );
  });
});

test('the harness floors pass when the run clears them', () => {
  withImportOnlyDriver((driver) => {
    const result = runReporter([
      '--check-harness',
      '1',
      '--check-harness-regions',
      '1',
      '--check-harness-file-regions',
      '1',
      '--',
      driver,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /Harness /);
    assert.doesNotMatch(result.stderr, /fall below the required/);
  });
});

// A run that loads no harness module leaves every harness ratio a 0/0
// fraction, which percent() reports as 100%. Without these guards the gates
// would be green on a run that verified nothing about the harness -- exactly
// the silence they were added to end.
const VACUOUS_CASES = [
  ['--check-harness', /--check-harness was requested, but no harness lines/],
  [
    '--check-harness-regions',
    /--check-harness-regions was requested, but no harness regions/,
  ],
  [
    '--check-harness-file-regions',
    /--check-harness-file-regions was requested, but no harness file/,
  ],
];

for (const [flag, expected] of VACUOUS_CASES) {
  test(`${flag} refuses to pass when no harness file was measured`, () => {
    // This test file touches no module under tests/tools/, so the run
    // produces harness rows for nothing at all.
    const result = runReporter([
      flag,
      '97',
      '--',
      'tests/markdown-link-check-config.test.mjs',
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    // The directory is named so the reader is not left guessing which tree
    // "harness" meant.
    assert.match(result.stderr, /tests\/tools\//);
  });
}
