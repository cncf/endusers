// `--check-source-regions` is an aggregate, and an aggregate spends its slack
// wherever the regression happens to be.
//
// `npm run test:unit:coverage:check` floors source region coverage over the
// whole of scripts/ and src/ at once. At the 2545/2547 source regions the
// suite records, a 99% floor leaves 23 regions of slack, and nothing stops a
// single file from taking all of them: every other file's regions pay for it
// and the `src files` row stays above the gate.
//
// The line gates do not catch that either, and the reason is structural
// rather than a question of how much slack they have. A lost region need not
// be a lost line: an unexecuted `??` fallback or ternary arm shares its line
// with the statement around it, so the file still reports 100% lines while
// its region percentage falls. `--check-source 100` is therefore green across
// exactly the regression `--check-source-regions` averages away.
//
// `--check-source-file-regions` applies the same floor to each source file on
// its own. These tests pin the four things that make it worth having: which
// rows it measures, that it fails a run the aggregate region gate passes,
// that it names the file and its uncovered regions rather than a bare
// percentage, and that it refuses to pass vacuously when the run recorded no
// source region at all.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { countsForScript, report } from './tools/coverage-report.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORTER = fileURLToPath(
  new URL('./tools/coverage-report.mjs', import.meta.url),
);

// Mirrors tests/coverage-report-cli.test.mjs: NODE_V8_COVERAGE stays set for
// the reporter itself (it overrides the variable for the `node --test` it
// spawns, so the grandchild writes elsewhere), and NODE_TEST_CONTEXT is
// removed because `node --test` refuses to run inside another runner.
function runReporter(args) {
  const env = { ...process.env, TZ: 'UTC' };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [REPORTER, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
  });
}

// A driver that imports a source module without calling into it, so that
// module's function bodies are recorded as uncovered regions. It is written
// inside the repository because the reporter maps coverage records onto
// repo-relative paths and drops everything outside, and it is dot-prefixed so
// `node --test`'s own discovery (which matches *.test.*) cannot pick it up
// while it exists; the reporter is handed the path explicitly.
function withImportOnlyDriver(body) {
  const relative = `tests/.coverage-file-region-floor-${randomUUID()}.mjs`;
  writeFileSync(
    join(REPO_ROOT, relative),
    [
      "import test from 'node:test';",
      "import * as validateUtils from '../scripts/lib/validate-utils.mjs';",
      "test('imports a source module without exercising it', () => {",
      "  if (!validateUtils) throw new Error('module did not load');",
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

// One function whose body never ran, inside a file whose every line is
// otherwise executed: `partial` is the sub-line gap shape the line gates
// cannot see.
function sourceWithSubLineGap() {
  return 'export const pick = (value) => value ?? fallback();\n';
}

test('report() reports one region ratio per source file', () => {
  const source = sourceWithSubLineGap();
  const merged = new Map([
    [
      'src/lib/partial.mjs',
      {
        source,
        counts: countsForScript(
          {
            functions: [
              {
                ranges: [
                  { startOffset: 0, endOffset: source.length, count: 1 },
                  { startOffset: 40, endOffset: 50, count: 0 },
                ],
              },
            ],
          },
          source.length,
        ),
      },
    ],
    // Outside the source roots: the per-file floor gates shipped code, and
    // the suite measuring itself is not that.
    [
      'tests/partial.test.mjs',
      {
        source,
        counts: countsForScript(
          {
            functions: [
              {
                ranges: [
                  { startOffset: 0, endOffset: source.length, count: 1 },
                  { startOffset: 40, endOffset: 50, count: 0 },
                ],
              },
            ],
          },
          source.length,
        ),
      },
    ],
  ]);

  const log = console.log;
  console.log = () => {};
  let totals;
  try {
    totals = report(merged);
  } finally {
    console.log = log;
  }

  assert.deepEqual(
    totals.sourceFileRegions.map((entry) => entry.file),
    ['src/lib/partial.mjs'],
  );
  const [entry] = totals.sourceFileRegions;
  // The zero-count range splits the file into three regions: the covered run
  // before it, the gap itself, and the covered run after.
  assert.equal(entry.regions, 3);
  assert.equal(entry.covered, 2);
  assert.equal(Number(entry.percent.toFixed(2)), 66.67);
  // The start lines are what locates a sub-line gap; a percentage alone sends
  // the reader back to reimplementing summarizeRegions by hand.
  assert.ok(entry.uncovered.length > 0);
});

test('the per-file floor fails a run the aggregate region gate passes', () => {
  withImportOnlyDriver((driver) => {
    // The driver leaves scripts/lib/validate-utils.mjs at 50% regions, which
    // clears --check-source-regions 50 and fails the per-file floor. Both
    // gates read the same run, so the difference is the granularity and
    // nothing else.
    const result = runReporter([
      '--check-source-regions',
      '50',
      '--check-source-file-regions',
      '100',
      '--',
      driver,
    ]);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /1 source file\(s\) fall below the required 100% region coverage per file:/,
    );
    assert.doesNotMatch(result.stderr, /Source region coverage .* is below/);
  });
});

test('the failure names the file, its ratio and its uncovered regions', () => {
  withImportOnlyDriver((driver) => {
    const result = runReporter([
      '--check-source-file-regions',
      '100',
      '--',
      driver,
    ]);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /^ {2}scripts\/lib\/validate-utils\.mjs \d+\.\d{2}% \(\d+\/\d+ regions; uncovered at \d[\d\s-]*\)$/m,
    );
  });
});

test('the per-file floor passes when every source file clears it', () => {
  withImportOnlyDriver((driver) => {
    const result = runReporter([
      '--check-source-file-regions',
      '50',
      '--',
      driver,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /fall below the required/);
  });
});

test('the per-file floor refuses to pass when no source region was recorded', () => {
  // This test touches no module under scripts/ or src/, so the run produces
  // source rows for nothing at all. percent() reports 100% for a 0/0
  // fraction, so without this guard an empty list of offenders would read as
  // a pass.
  const result = runReporter([
    '--check-source-file-regions',
    '97',
    '--',
    'tests/markdown-link-check-config.test.mjs',
  ]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /--check-source-file-regions was requested, but no source file outside tests\/ recorded any region\./,
  );
});
