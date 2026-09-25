// tests/tools/jsx-hooks.mjs transpiles every JSX component in memory before
// Node ever sees it, so V8 records coverage against generated text that is
// longer, and laid out differently, than the file on disk. Before #628 the
// reporter simply withheld every such record: 17 components and
// src/theme/Footer/index.js were silently absent from the report no matter
// how much of them ran.
//
// These tests pin the remap that recovers them: decodeMappings() reads the
// source map swc emits, remapJsxLineCoverage() uses it to carry each
// generated line's executable/covered verdict back onto the original line it
// came from, and countsFromLineVerdict() turns that verdict into the same
// counts-array shape countsForScript() produces, so summarizeLines() and
// summarizeRegions() need no changes to score it.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countsForScript,
  countsFromLineVerdict,
  decodeMappings,
  isJsxSource,
  remapJsxLineCoverage,
} from './tools/coverage-report.mjs';

// A minimal, spec-compliant base64-VLQ encoder, kept independent of
// @swc/core's actual output so these tests do not depend on the exact code a
// given compiler version emits -- only on the source map format itself.
const BASE64_VLQ_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeVlq(value) {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = vlq & 0b011111;
    vlq >>>= 5;
    if (vlq > 0) digit |= 0b100000;
    out += BASE64_VLQ_CHARS[digit];
  } while (vlq > 0);
  return out;
}

/**
 * Builds a `mappings` string from per-generated-line lists of
 * [genColumn, sourceLine, sourceColumn] absolute positions, encoding them as
 * the deltas the source map v3 format requires (source file index is always
 * 0, since every fixture here has exactly one source).
 *
 * @param {Array<Array<[number, number, number]>>} lines per-line segment lists
 * @returns {string} an encoded `mappings` field
 */
function mappings(lines) {
  let prevSourceLine = 0;
  let prevSourceCol = 0;
  return lines
    .map((segments) => {
      let prevGenCol = 0;
      return segments
        .map(([genCol, sourceLine, sourceCol]) => {
          const parts = [
            encodeVlq(genCol - prevGenCol),
            encodeVlq(0),
            encodeVlq(sourceLine - prevSourceLine),
            encodeVlq(sourceCol - prevSourceCol),
          ];
          prevGenCol = genCol;
          prevSourceLine = sourceLine;
          prevSourceCol = sourceCol;
          return parts.join('');
        })
        .join(',');
    })
    .join(';');
}

test('decodeMappings decodes one segment per generated line', () => {
  const encoded = mappings([[[0, 0, 0]], [[2, 1, 0]]]);
  assert.deepEqual(decodeMappings(encoded), [
    [{ genColumn: 0, sourceLine: 0, sourceColumn: 0 }],
    [{ genColumn: 2, sourceLine: 1, sourceColumn: 0 }],
  ]);
});

test('decodeMappings decodes several segments on the same generated line', () => {
  const encoded = mappings([
    [
      [0, 0, 0],
      [4, 0, 4],
      [9, 1, 0],
    ],
  ]);
  assert.deepEqual(decodeMappings(encoded), [
    [
      { genColumn: 0, sourceLine: 0, sourceColumn: 0 },
      { genColumn: 4, sourceLine: 0, sourceColumn: 4 },
      { genColumn: 9, sourceLine: 1, sourceColumn: 0 },
    ],
  ]);
});

test('decodeMappings gives an empty segment list for a line with none', () => {
  const encoded = mappings([[[0, 0, 0]], [], [[0, 1, 0]]]);
  assert.deepEqual(decodeMappings(encoded)[1], []);
});

test('decodeMappings decodes negative deltas', () => {
  // A generated line can map back to an earlier source line than the one
  // before it -- swc does this for JSX children reordered around a fragment.
  const encoded = mappings([[[0, 3, 0]], [[0, 1, 0]]]);
  assert.deepEqual(decodeMappings(encoded), [
    [{ genColumn: 0, sourceLine: 3, sourceColumn: 0 }],
    [{ genColumn: 0, sourceLine: 1, sourceColumn: 0 }],
  ]);
});

test('isJsxSource accepts a .js file containing JSX', () => {
  assert.equal(isJsxSource('src/components/X/index.js', '<div/>'), true);
});

test('isJsxSource rejects a .js file with no JSX', () => {
  assert.equal(isJsxSource('scripts/plain.mjs', 'export const a = 1;'), false);
});

test('isJsxSource rejects a non-script file even if it contains "<"', () => {
  assert.equal(isJsxSource('data/x.json', '<div/>'), false);
});

test('remapJsxLineCoverage credits a generated line to its first mapping segment', () => {
  // Two generated lines, both executed, mapping to original lines 0 and 2.
  const generatedCode = 'const a = 1;\nconst b = 2;\n';
  const counts = countsForScript(
    {
      functions: [
        {
          ranges: [
            { startOffset: 0, endOffset: generatedCode.length, count: 1 },
          ],
        },
      ],
    },
    generatedCode.length,
  );
  const map = { mappings: mappings([[[0, 0, 0]], [[0, 2, 0]]]) };
  const verdict = remapJsxLineCoverage(generatedCode, counts, map);
  assert.equal(verdict.executable[0], true);
  assert.equal(verdict.covered[0], true);
  assert.equal(verdict.executable[2], true);
  assert.equal(verdict.covered[2], true);
});

test('remapJsxLineCoverage marks an original line uncovered when its generated line never ran', () => {
  const generatedCode = 'const a = 1;\nconst b = 2;\n';
  const counts = countsForScript(
    {
      functions: [
        {
          ranges: [
            { startOffset: 0, endOffset: generatedCode.length, count: 1 },
            { startOffset: 13, endOffset: 26, count: 0 },
          ],
        },
      ],
    },
    generatedCode.length,
  );
  const map = { mappings: mappings([[[0, 0, 0]], [[0, 1, 0]]]) };
  const verdict = remapJsxLineCoverage(generatedCode, counts, map);
  assert.equal(verdict.covered[0], true);
  assert.equal(verdict.executable[1], true);
  assert.equal(verdict.covered[1], false);
});

test('remapJsxLineCoverage skips a generated line with no mapping segment', () => {
  // A line the compiler emitted with no source position (a bare closing
  // brace, for instance) must not be attributed to whichever original line
  // happens to occupy that array index.
  const generatedCode = 'a;\nb;\nc;\n';
  const counts = countsForScript(
    {
      functions: [
        {
          ranges: [
            { startOffset: 0, endOffset: generatedCode.length, count: 1 },
          ],
        },
      ],
    },
    generatedCode.length,
  );
  const map = { mappings: mappings([[[0, 0, 0]], [], [[0, 1, 0]]]) };
  const verdict = remapJsxLineCoverage(generatedCode, counts, map);
  assert.deepEqual(verdict.executable, [true, true]);
});

test('remapJsxLineCoverage ignores whitespace when deciding a generated line is executable', () => {
  const generatedCode = 'a;\n   \n';
  const counts = countsForScript(
    {
      functions: [
        {
          ranges: [
            { startOffset: 0, endOffset: generatedCode.length, count: 1 },
          ],
        },
      ],
    },
    generatedCode.length,
  );
  const map = { mappings: mappings([[[0, 0, 0]], [[0, 1, 0]]]) };
  const verdict = remapJsxLineCoverage(generatedCode, counts, map);
  assert.equal(verdict.executable[0], true);
  assert.equal(verdict.executable[1], false);
});

test('countsFromLineVerdict fills a covered line with a positive count and an uncovered one with zero', () => {
  const source = 'a\nb\nc';
  const counts = countsFromLineVerdict(source, {
    executable: [true, false, true],
    covered: [true, false, false],
  });
  assert.deepEqual([...counts], [1, 1, -1, -1, 0]);
});

test('countsFromLineVerdict leaves a non-executable line unattributed', () => {
  const source = 'a\nb';
  const counts = countsFromLineVerdict(source, {
    executable: [false, false],
    covered: [false, false],
  });
  assert.deepEqual([...counts], [-1, -1, -1]);
});
