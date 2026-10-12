// The reporter gates on region coverage (`--check-source-regions`, run by
// `npm run test:unit:coverage:check` in ci.yml) but, until now, never said
// where a region gap was.
//
// A region is a maximal run of offsets sharing one recorded count, so an
// unexecuted `??` fallback or ternary arm is a gap inside a line the rest of
// which did run. Line coverage marks that line covered, so the only column
// the table printed -- "uncovered lines" -- stayed empty for it. A file could
// therefore report `100.00 | 98.73 |` with nothing after the last pipe, and a
// contributor whose build had just failed on the region gate had no way to
// find the offending branch short of reimplementing summarizeRegions by hand.
//
// summarizeRegions has always collected the start line of every uncovered
// region; the value was simply discarded before it reached the table. These
// tests pin the two halves of surfacing it:
//
//   - formatRanges collapses repeats, because two uncovered regions can begin
//     on the same line (`a ?? b ?? c`) and summarizeRegions records one entry
//     per region, not per line;
//   - report() prints those start lines in a column of their own, for a file
//     whose "uncovered lines" cell is empty -- the exact case the column
//     exists to serve -- and carries region totals on the summary rows.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countsForScript,
  formatRanges,
  report,
  summarizeRegions,
} from './tools/coverage-report.mjs';

// report() writes the table with console.log. Capturing it is the only way to
// assert the rendered row, which is the artifact a contributor actually reads.
function captureReport(merged) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => {
    lines.push(args.join(' '));
  };
  try {
    const totals = report(merged);
    return { lines, totals };
  } finally {
    console.log = original;
  }
}

function ranges(...triples) {
  return {
    functions: [
      {
        ranges: triples.map(([startOffset, endOffset, count]) => ({
          startOffset,
          endOffset,
          count,
        })),
      },
    ],
  };
}

// Splits a rendered row on its pipes so a cell can be addressed by position
// without depending on the padding widths, which vary with the longest file
// name in the table.
function cells(row) {
  return row.split('|').map((cell) => cell.trim());
}

function findRow(lines, file) {
  const row = lines.find((line) => line.startsWith(file));
  assert.ok(row, `no row for ${file} in:\n${lines.join('\n')}`);
  return cells(row);
}

test('formatRanges collapses repeated lines to a single entry', () => {
  // `a ?? b ?? c` on one line: two uncovered regions, one line to name.
  assert.equal(formatRanges([7, 7, 7]), '7');
  assert.equal(formatRanges([3, 3, 9, 9]), '3 9');
});

test('formatRanges still joins consecutive lines into a range', () => {
  assert.equal(formatRanges([4, 5, 6]), '4-6');
  assert.equal(formatRanges([4, 4, 5, 6, 6]), '4-6');
});

test('formatRanges separates a repeat from a genuinely adjacent line', () => {
  // 11 repeating must not be read as a break that restarts the range, and
  // must not swallow the distinct 13 that follows.
  assert.equal(formatRanges([10, 11, 11, 13]), '10-11 13');
});

test('formatRanges renders an empty list as an empty string', () => {
  assert.equal(formatRanges([]), '');
});

test('the table names the start line of a region gap inside a covered line', () => {
  // Line 2 runs in full at line granularity -- `const x = a` executed -- but
  // the `?? fallback()` tail never did. This is the shape that left the old
  // table with nothing to show.
  const source = ['const a = 1;', 'const x = a ?? fallback();', ''].join('\n');
  const tail = source.indexOf(' ?? fallback();');
  const counts = countsForScript(
    ranges([0, source.length, 1], [tail, tail + ' ?? fallback();'.length, 0]),
    source.length,
  );

  // Precondition: the gap is invisible to line coverage, so the "uncovered
  // lines" cell is genuinely empty and only the region cell can report it.
  const regions = summarizeRegions(source, counts);
  assert.deepEqual(regions.uncovered, [2]);

  const { lines } = captureReport(
    new Map([['src/lib/fallback.mjs', { source, counts }]]),
  );

  const row = findRow(lines, 'src/lib/fallback.mjs');
  assert.equal(row[1], '100.00', 'line coverage should be complete');
  assert.notEqual(row[2], '100.00', 'region coverage should not be complete');
  assert.equal(row[3], '', 'no line is uncovered');
  assert.equal(row[4], '2', 'the region gap must be located');
});

test('the table header advertises both gap columns', () => {
  const source = 'const a = 1;\n';
  const counts = countsForScript(ranges([0, source.length, 1]), source.length);
  const { lines } = captureReport(
    new Map([['src/lib/covered.mjs', { source, counts }]]),
  );

  assert.equal(cells(lines[0])[3], 'uncovered lines');
  assert.equal(cells(lines[0])[4], 'uncovered regions');
  // A fully covered file leaves both gap cells empty rather than omitting the
  // column, so the rows stay aligned under the header.
  assert.deepEqual(findRow(lines, 'src/lib/covered.mjs').slice(3), ['', '']);
});

test('the summary rows report region totals alongside line totals', () => {
  const source = ['const a = 1;', 'const x = a ?? fallback();', ''].join('\n');
  const tail = source.indexOf(' ?? fallback();');
  const counts = countsForScript(
    ranges([0, source.length, 1], [tail, tail + ' ?? fallback();'.length, 0]),
    source.length,
  );
  const testSource = 'const t = 1;\n';
  const testCounts = countsForScript(
    ranges([0, testSource.length, 1]),
    testSource.length,
  );

  const { lines, totals } = captureReport(
    new Map([
      ['src/lib/fallback.mjs', { source, counts }],
      ['tests/fallback.test.mjs', { source: testSource, counts: testCounts }],
    ]),
  );

  const src = findRow(lines, 'src files');
  const all = findRow(lines, 'all files');

  // The src row counts the source file alone; the all row adds the test file.
  assert.match(src[4], /^(\d+)\/(\d+) regions$/);
  assert.match(all[4], /^(\d+)\/(\d+) regions$/);

  const [srcCovered, srcTotal] = src[4].match(/\d+/g).map(Number);
  const [allCovered, allTotal] = all[4].match(/\d+/g).map(Number);
  assert.ok(srcCovered < srcTotal, 'the source file has an uncovered region');
  assert.ok(allTotal > srcTotal, 'the test file adds regions to the all row');
  assert.equal(allCovered - srcCovered, allTotal - srcTotal);

  // The printed totals must agree with what the gate reads.
  assert.equal(
    Number(src[2]),
    Number(((srcCovered / srcTotal) * 100).toFixed(2)),
  );
  assert.equal(
    totals.sourceRegionPct.toFixed(2),
    ((srcCovered / srcTotal) * 100).toFixed(2),
  );
  assert.equal(totals.sourceRegions, srcTotal);
});
