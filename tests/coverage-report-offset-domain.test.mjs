// The reporter in tests/tools/coverage-report.mjs projects raw V8 byte
// offsets onto the source files on disk. That projection is only valid when
// the text V8 measured *is* the text on disk, and in this repository it often
// is not: tests/tools/jsx-hooks.mjs transpiles every JSX component in memory
// and re-emits every imported JSON file as `export default <data>;`, so V8
// records those modules against generated text several times longer than the
// file they came from.
//
// The resulting failure is silent and points the wrong way. V8's outermost
// range spans the whole generated script, so clipping it to the shorter
// on-disk file marks every byte as executed and the file is reported at 100%
// however little of it ran -- and the padded JSON modules, which are covered
// by construction, inflate the repository total on top of that.
//
// These tests pin the guard that keeps a record out of the report unless its
// offsets actually address the file being scored.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { collect, recordedSourceLength } from './tools/coverage-report.mjs';
import { inlineSourceMapCode, transpileJsx } from './tools/jsx-hooks.mjs';

function scriptCoverage(...triples) {
  return {
    functions: triples.map(([startOffset, endOffset, count]) => ({
      ranges: [{ startOffset, endOffset, count }],
    })),
  };
}

/**
 * Builds a throwaway repository plus a coverage directory holding one V8
 * payload, and hands both to collect().
 *
 * @param {Record<string, string>} files repo-relative path -> source text
 * @param {(root: string) => object[]} makeResult V8 `result` entries to record
 * @returns {{ merged: Map<string, any>, unmapped: Set<string> }} collect output
 */
function collectWith(files, makeResult) {
  const root = mkdtempSync(join(tmpdir(), 'endusers-offset-repo-'));
  const coverageDir = mkdtempSync(join(tmpdir(), 'endusers-offset-cov-'));
  try {
    for (const [relPath, source] of Object.entries(files)) {
      const absolute = join(root, relPath);
      mkdirSync(join(absolute, '..'), { recursive: true });
      writeFileSync(absolute, source);
    }
    writeFileSync(
      join(coverageDir, 'coverage-1.json'),
      JSON.stringify({ result: makeResult(root) }),
    );
    return collect(coverageDir, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(coverageDir, { recursive: true, force: true });
  }
}

function urlFor(root, relPath) {
  return pathToFileURL(join(root, relPath)).href;
}

test('recordedSourceLength returns the span of the outermost range', () => {
  // V8 emits the top-level range first and nests the rest inside it, so the
  // widest endOffset is the length of the text the offsets belong to.
  assert.equal(
    recordedSourceLength(scriptCoverage([0, 512, 1], [40, 90, 0])),
    512,
  );
});

test('recordedSourceLength is 0 for a record that carries no ranges', () => {
  assert.equal(recordedSourceLength({}), 0);
  assert.equal(recordedSourceLength({ functions: [] }), 0);
  assert.equal(recordedSourceLength({ functions: [{}] }), 0);
});

test('a record measured against the file on disk is scored as before', () => {
  const source = 'export const a = 1;\nexport const b = 2;\n';
  const { merged, unmapped } = collectWith(
    { 'scripts/plain.mjs': source },
    (root) => [
      {
        url: urlFor(root, 'scripts/plain.mjs'),
        ...scriptCoverage([0, source.length, 1]),
      },
    ],
  );

  assert.deepEqual([...unmapped], []);
  assert.deepEqual([...merged.keys()], ['scripts/plain.mjs']);
  assert.equal(merged.get('scripts/plain.mjs').source, source);
});

test('a record measured against generated text is withheld, not scored at 100%', () => {
  // The shape a transpiled JSX component arrives in: the recorded script is
  // far longer than the source file, and its outermost range would otherwise
  // paint every byte on disk as executed.
  const source = '<p>{value}</p>;\n';
  const { merged, unmapped } = collectWith(
    { 'src/components/Widget/index.js': source },
    (root) => [
      {
        url: urlFor(root, 'src/components/Widget/index.js'),
        ...scriptCoverage([0, source.length * 4, 1]),
      },
    ],
  );

  assert.equal(merged.size, 0);
  assert.deepEqual([...unmapped], ['src/components/Widget/index.js']);
});

test('a JSON module wrapped by the loader is withheld rather than padding the total', () => {
  // jsx-hooks re-emits `data/x.json` as `export default <data>;`. Those extra
  // bytes make the record longer than the file, and every line of a data file
  // is "covered" by construction, so scoring it inflates the repository total.
  const source = '{"a":1}\n';
  const { merged, unmapped } = collectWith(
    { 'data/x.json': source },
    (root) => [
      {
        url: urlFor(root, 'data/x.json'),
        ...scriptCoverage([0, `export default ${source};`.length, 1]),
      },
    ],
  );

  assert.equal(merged.size, 0);
  assert.deepEqual([...unmapped], ['data/x.json']);
});

test('a JSX record is remapped onto the source file it was transpiled from (#628)', () => {
  const relPath = 'src/components/Widget/index.js';
  const source =
    'export default function Widget() {\n  return <div>{value}</div>;\n}\n';
  const { merged, unmapped } = collectWith({ [relPath]: source }, (root) => {
    // Reproduces exactly what tests/tools/jsx-hooks.mjs's loader would have
    // handed V8 for this file, so the record's offsets line up with the
    // remap collect() attempts.
    const { code, map } = transpileJsx(source, join(root, relPath));
    const generated = inlineSourceMapCode(code, map);
    return [
      {
        url: urlFor(root, relPath),
        ...scriptCoverage([0, generated.length, 1]),
      },
    ];
  });

  assert.deepEqual([...unmapped], []);
  assert.deepEqual([...merged.keys()], [relPath]);
  const { source: mergedSource, counts } = merged.get(relPath);
  assert.equal(mergedSource, source);
  // Every generated line ran, so every executable original line must score
  // covered rather than being silently dropped as it was before #628.
  assert.equal(counts[0], 1);
  assert.equal(counts[source.indexOf('<div>')], 1);
});

test('a JSX record credits an unreached line as uncovered rather than withholding the file', () => {
  const relPath = 'src/components/Widget/index.js';
  const source =
    'export default function Widget() {\n' +
    '  if (false) {\n' +
    '    return <p>never</p>;\n' +
    '  }\n' +
    '  return <div>{value}</div>;\n' +
    '}\n';
  const { merged } = collectWith({ [relPath]: source }, (root) => {
    const { code, map } = transpileJsx(source, join(root, relPath));
    const generated = inlineSourceMapCode(code, map);
    // The whole never-executed `return <p>never</p>;` statement spans three
    // generated lines (the _jsx("p", { call, its "never" child, and the
    // closing "});"); a real V8 record marks a statement's whole range with
    // one count, so all three must be zeroed together rather than just the
    // "never" line in isolation.
    const blockAt = generated.indexOf('_jsx("p"');
    const lineStart = generated.lastIndexOf('\n', blockAt) + 1;
    const blockEnd = generated.indexOf('});', blockAt) + '});'.length;
    return [
      {
        url: urlFor(root, relPath),
        ...scriptCoverage([0, generated.length, 1], [lineStart, blockEnd, 0]),
      },
    ];
  });

  const { counts } = merged.get(relPath);
  assert.equal(counts[source.indexOf('never')], 0);
  assert.equal(counts[source.indexOf('if (false)')], 1);
  assert.equal(counts[source.indexOf('<div>')], 1);
});

test('a file with one usable record is scored despite a mismatched sibling record', () => {
  // The same module can be recorded twice -- once from the repository and
  // once from a fixture sandbox. One unusable record must not suppress the
  // file, and one usable record must not launder the unusable one.
  const source = 'export const a = 1;\nexport const b = 2;\n';
  const { merged, unmapped } = collectWith(
    { 'scripts/dual.mjs': source },
    (root) => [
      {
        url: urlFor(root, 'scripts/dual.mjs'),
        ...scriptCoverage([0, source.length + 99, 1]),
      },
      {
        url: urlFor(root, 'scripts/dual.mjs'),
        ...scriptCoverage([0, source.length, 1], [0, 20, 0]),
      },
    ],
  );

  assert.deepEqual([...unmapped], []);
  assert.deepEqual([...merged.keys()], ['scripts/dual.mjs']);
  // Only the usable record contributed, so the first line stayed unexecuted.
  assert.equal(merged.get('scripts/dual.mjs').counts[0], 0);
  assert.equal(merged.get('scripts/dual.mjs').counts[source.length - 1], 1);
});

test('a record with no ranges at all is withheld instead of reported as fully covered', () => {
  // Zero ranges used to yield zero executable lines, which the reporter
  // divides into a flat 100.00% row -- a file that never ran presented as the
  // best-covered file in the table.
  const source = 'export const a = 1;\n';
  const { merged, unmapped } = collectWith(
    { 'scripts/empty.mjs': source },
    (root) => [{ url: urlFor(root, 'scripts/empty.mjs'), functions: [] }],
  );

  assert.equal(merged.size, 0);
  assert.deepEqual([...unmapped], ['scripts/empty.mjs']);
});
