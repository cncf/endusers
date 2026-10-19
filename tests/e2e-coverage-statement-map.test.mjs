// The premise behind `collectE2ECoverage`'s empty-line-map skip in
// tests/tools/e2e-coverage-report.mjs:
//
//   const lineCoverage = getLineCoverage(coverageData);
//   if (lineCoverage.size === 0) continue;
//
// `getLineCoverage` reads the istanbul `s`/`statementMap` pair v8-to-istanbul
// emits for one original source, so an empty result means the converter handed
// the reporter an entry for a `src/` module carrying no statement at all. No
// run can produce that today, which is why the arm is the only region of the
// e2e reporter that nothing executes and that carried no premise beside it:
// the three others each name the test that pins theirs
// (tests/e2e-coverage-split-range.test.mjs for the tail-push invariant,
// tests/e2e-coverage-error-arms.test.mjs for the two error-text fallbacks).
//
// Unlike those three, this one is not a formatting nicety. It decides whether
// a module is measured, and the two things that follow from dropping it are
// both silent:
//
//   * a source row with no executable lines scores 100% lines and 100%
//     regions, because an empty denominator counts as fully covered, so the
//     module is credited rather than reported; and
//   * `missingSourceFiles` is the set difference between the modules on disk
//     and the modules the report has a row for, so the same empty row takes
//     the module out of that set and `--require-source-files` stops naming it.
//
// Between them that is the whole of what the reporter promises about a module
// it could not measure -- the file-set guarantee the aggregate percentages
// cannot provide -- waved through by an entry that looks like coverage and
// contains none.
//
// So the arm is kept, and what it rests on is stated here rather than left to
// be rediscovered: the converter emits a statement for every line of every
// source it carries, including a source whose text is empty, and it carries a
// source whether or not any coverage was applied to it. These tests drive the
// installed converter directly rather than a report, because a report can only
// show the consequence and this is the premise. A release that started
// emitting statement-less entries has to fail here, by name, rather than
// quietly turning an unmeasured module into a covered one.
import assert from 'node:assert/strict';
import test from 'node:test';

import v8ToIstanbul from 'v8-to-istanbul';

import { percent } from './tools/coverage-report.mjs';

const SOURCE_PATH = '/virtual/src/alpha.js';
const SCRIPT_PATH = '/virtual/build/assets/js/app.js';
const MAP_URL = 'file:///virtual/build/assets/js/app.js.map';

// Both ends of the range the premise has to hold over: ordinary module text,
// and the degenerate source a bundler emits for a module that compiled to
// nothing. The empty one is the case that would reach the arm if any could.
const SOURCES = [
  ['an ordinary source', 'const alpha = 1;\n'],
  ['a source whose text is empty', ''],
];

const mapFor = (source) => ({
  version: 3,
  file: 'app.js',
  sources: [SOURCE_PATH],
  sourcesContent: [source],
  names: [],
  mappings: 'AAAA',
});

async function convert(source, { apply }) {
  const scriptText = `${source}\n`;
  const converter = v8ToIstanbul(SCRIPT_PATH, 0, {
    source: scriptText,
    sourceMap: { sourcemap: mapFor(source), url: MAP_URL },
  });
  await converter.load();
  if (apply) {
    converter.applyCoverage([
      {
        functionName: '',
        isBlockCoverage: true,
        ranges: [{ startOffset: 0, endOffset: scriptText.length, count: 1 }],
      },
    ]);
  }
  return converter.toIstanbul();
}

// The reporter's own reader, restated rather than imported: `getLineCoverage`
// is module-private, and a copy that drifted from it would make these tests
// pass about something the reporter does not do. It is four lines, and the
// assertions below pin the one property they share -- a statement is counted
// only when its entry carries an integer line. The reporter's nullish guards
// over `s` and `statementMap` are not restated: these tests assert the entry
// exists first, and the tests above are the premise that it is populated.
const lineCount = (coverageData) =>
  new Set(
    Object.keys(coverageData.s)
      .map((id) => coverageData.statementMap[id].start.line)
      .filter((line) => Number.isInteger(line)),
  ).size;

for (const [label, source] of SOURCES) {
  for (const apply of [false, true]) {
    const when = apply ? 'after applyCoverage' : 'before applyCoverage';
    test(`${label} carries at least one located statement ${when}`, async () => {
      const coverage = await convert(source, { apply });

      // The entry exists at all: a converter that stopped carrying the source
      // would take the module out of the report by a different route, which
      // tests/e2e-coverage-attribution.test.mjs is the premise test for.
      const entries = Object.values(coverage);
      assert.equal(entries.length, 1);

      // And it is not statement-less, which is the premise the skip rests on.
      assert.ok(
        lineCount(entries[0]) > 0,
        `expected ${label} to carry a located statement ${when}`,
      );
    });
  }
}

// What the arm is worth if the premise above ever stops holding. A row built
// from a statement-less entry has an empty denominator, and an empty
// denominator is full coverage by the shared `percent` both reporters score
// with -- so the module would be published as covered rather than as the
// module nothing measured.
test('an empty denominator scores as fully covered', () => {
  assert.equal(percent(0, 0), 100);
});
