#!/usr/bin/env node
// Coverage reporter that survives the fixture-sandbox indirection.
//
// tests/helpers.mjs (and the other sandbox helpers) copy a script from
// scripts/ into a fresh temp directory so it reads fixture data through its
// own import.meta.url. V8 therefore records that execution under a unique
// file:///tmp/<sandbox>/scripts/<name> URL. `node --test
// --experimental-test-coverage` only reports files under the project
// directory, so every sandboxed run is discarded and the printed numbers
// reflect only the handful of tests that execute scripts from the real repo
// path.
//
// This reporter collects raw V8 coverage instead, rewrites each sandbox URL
// back to its repo-relative origin, merges the runs, and reports line
// coverage against the real source files.
//
// The table carries two gap columns. "uncovered lines" names the lines no
// recorded range executed; "uncovered regions" names the start line of every
// uncovered region, which includes sub-line gaps the line column cannot show.
//
// Usage:
//   node tests/tools/coverage-report.mjs [--check <minLinePercent>]
//     [--check-regions <minRegionPercent>] [--check-source <minLinePercent>]
//     [--check-source-regions <minRegionPercent>]
//     [--check-source-file-regions <minRegionPercent>] [--require-source-files]
//     [--check-harness <minLinePercent>]
//     [--check-harness-regions <minRegionPercent>]
//     [--check-harness-file-regions <minRegionPercent>]
//     [-- <node --test args>]
//
// The test files are themselves part of the recorded coverage, and they
// outweigh the code they exercise several times over. An all-files threshold
// is therefore mostly a measurement of the suite covering itself: deleting a
// whole test file removes its lines from the numerator and the denominator
// together, so the all-files percentage barely moves. --check-source and
// --check-source-regions apply a threshold to the shipped sources alone
// (everything outside tests/), which is the number that actually falls when
// a test file is dropped or a source path stops being exercised.
//
// Those four thresholds are all ratios over the files the run happened to
// observe, which leaves one kind of regression invisible to every one of
// them. A file under scripts/, src/ or tests/tools/ that no test imports is
// recorded nowhere, so it never becomes a row: its lines are absent from the
// numerator and the denominator alike and `src files` does not move. Adding
// a brand-new source file with an untaken branch therefore keeps
// --check-source 100 green. --require-source-files closes that by comparing
// the files on disk against the files the run measured, and failing when any
// is missing. A ratio floor and a file-set floor are different guarantees;
// this is the second one. It also fails when a file under those trees was
// recorded but could not be mapped back onto the text on disk: such a file is
// absent from every ratio in exactly the same way, and until the gate said so
// the only trace of it was an informational notice nothing scored.
//
// --check-source-regions is also an aggregate, and an aggregate hides where
// its own slack is spent. The gate is cleared by the whole of scripts/ and
// src/ together, so the regions one file loses are paid for by every other
// file that still has them: at 2545/2547 source regions a floor of 99% leaves
// 23 regions of slack, and a single file may take all of them. The companion
// line gate does not catch that, because a lost *region* need not be a lost
// *line* -- an unexecuted `??` fallback or ternary arm sits on a line the
// surrounding statement still covers, so the file stays at 100% lines while
// its region percentage falls. --check-source-file-regions applies the floor
// to each source file on its own, so a regression concentrated in one file
// fails on that file's name instead of being averaged away.
//
// All five of those score `scripts/` and `src/` alone, because they are built
// from isSourceFile(), which drops everything under tests/. tests/tools/ is
// the third SOURCE_ROOTS entry, so --require-source-files insists every
// module in it be measured, and then no ratio gate scored it: the measuring
// apparatus was required to be present and held to no standard. The
// --check-harness family is the same three shapes over that tree, reported
// as a `harness files` row beside `src files`. It stays a separate row
// rather than widening `src files` for the reason isSourceFile() gives --
// the harness is not code this repository ships, and merging the two would
// let a harness gap be paid for out of src/'s slack.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { transpileJsx, inlineSourceMapCode } from './jsx-hooks.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// A sandboxed run mirrors the repo layout, so the portion of the path from
// the mirrored top-level directory onward matches the real source tree.
const MIRRORED_DIRS = ['scripts', 'src', 'tests'];
const SCRIPT_URL = /\.(js|jsx|mjs)$/;

// The directories --require-source-files enumerates. Deliberately narrower
// than isSourceFile()'s "outside tests/": that predicate classifies a path
// that was already recorded, whereas this list is walked on disk and so has
// to name exactly the trees whose every module is expected to be exercised.
// Root-level configuration (docusaurus.config.js, playwright.config.js,
// sidebars.js) is measured today but is not enumerated here -- it is not a
// tree, and a guess about which root files "ought to" be covered would be a
// rule this reporter cannot state.
//
// tests/tools/ is enumerated for the same reason scripts/ and src/ are: it is
// a tree, not a scattering of root-level configuration, and every module in
// it is part of the harness the suite runs on. A tool nobody imports is the
// measuring apparatus going unmeasured, which is the failure this flag exists
// to name. It is the one subtree of tests/ that is enumerated; isSourceFile()
// still classifies everything under tests/ as non-source, so a harness module
// counts toward the file-set floor without entering the `src files` ratios.
const SOURCE_ROOTS = ['scripts', 'src', join('tests', 'tools')];
const SOURCE_FILE = /\.(c|m)?jsx?$/;

// The SOURCE_ROOTS entries that --require-source-files walks but
// isSourceFile() classifies as non-source: the harness tree. Derived from
// SOURCE_ROOTS rather than restated so the row below and the file-set floor
// can never come to name different directories.
//
// Without a row of its own the harness is required to be measured and then
// scored by nothing: --check-source and its companions are built from
// isSourceFile(), which drops everything under tests/, and the only floor
// left over it is --check-regions, an all-files aggregate the suite's own
// test files dominate. The harness is where the coverage reporters, the
// Playwright coverage fixture, the data-overlay loader and the JSX/DOM
// harness live, so a gap there is a gap in the instrument every other gate
// reads. It is still summarised separately rather than folded into
// `src files`, for the reason isSourceFile() gives: it is not code this
// repository ships, and its ratios answer a different question.
const HARNESS_ROOTS = SOURCE_ROOTS.map((root) =>
  root.split(sep).join('/'),
).filter((root) => !isSourceFile(`${root}/`));

// A flag takes one numeric percentage argument; the option key it sets on
// the parsed options object.
const PERCENT_FLAGS = {
  '--check': 'check',
  '--check-regions': 'checkRegions',
  '--check-source': 'checkSource',
  '--check-source-regions': 'checkSourceRegions',
  '--check-source-file-regions': 'checkSourceFileRegions',
  '--check-harness': 'checkHarness',
  '--check-harness-regions': 'checkHarnessRegions',
  '--check-harness-file-regions': 'checkHarnessFileRegions',
};

function parseArgs(argv) {
  const options = {
    check: null,
    checkRegions: null,
    checkSource: null,
    checkSourceRegions: null,
    checkSourceFileRegions: null,
    checkHarness: null,
    checkHarnessRegions: null,
    checkHarnessFileRegions: null,
    requireSourceFiles: false,
    testArgs: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = PERCENT_FLAGS[arg];
    if (key) {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value)) {
        throw new Error(`${arg} requires a numeric percentage`);
      }
      options[key] = value;
      i += 1;
    } else if (arg === '--require-source-files') {
      options.requireSourceFiles = true;
    } else if (arg === '--') {
      options.testArgs.push(...argv.slice(i + 1));
      break;
    } else {
      options.testArgs.push(arg);
    }
  }
  return options;
}

// Maps a recorded coverage URL onto a repo-relative source path, collapsing
// sandbox copies onto the original file. Returns null for anything that is
// not part of this repository (node internals, dependencies, fixtures).
export function toRepoRelativePath(url, root = repoRoot) {
  if (!url.startsWith('file://')) return null;
  let filePath;
  try {
    filePath = fileURLToPath(url);
  } catch {
    return null;
  }
  if (filePath.includes(`${sep}node_modules${sep}`)) return null;

  const withinRepo = relative(root, filePath);
  if (!withinRepo.startsWith('..') && !withinRepo.startsWith(sep)) {
    return withinRepo.split(sep).join('/');
  }

  // Sandbox copy: keep the tail starting at the mirrored top-level directory.
  const segments = filePath.split(sep);
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    if (MIRRORED_DIRS.includes(segments[i])) {
      return segments.slice(i).join('/');
    }
  }
  return null;
}

// Applies V8's nested range semantics: ranges arrive outermost-first, and an
// inner range overrides the count of the region it covers.
export function countsForScript(scriptCoverage, length) {
  const counts = new Int32Array(length).fill(-1);
  const ranges = [];
  for (const fn of scriptCoverage.functions ?? []) {
    for (const range of fn.ranges ?? []) ranges.push(range);
  }
  ranges.sort((a, b) => {
    if (a.startOffset !== b.startOffset) return a.startOffset - b.startOffset;
    return b.endOffset - a.endOffset;
  });
  for (const range of ranges) {
    const start = Math.max(0, range.startOffset);
    const end = Math.min(length, range.endOffset);
    for (let i = start; i < end; i += 1) counts[i] = range.count;
  }
  return counts;
}

// The length of the source text a coverage record's offsets belong to.
//
// V8 always emits one outermost range spanning the whole script, so the
// largest endOffset in a record is the length of the text the module loader
// handed to V8 -- which is not always the text on disk. tests/tools/jsx-hooks.mjs
// transpiles JSX in memory and wraps imported JSON in an `export default`,
// so those offsets index a generated file longer than its source file.
export function recordedSourceLength(scriptCoverage) {
  let length = 0;
  for (const fn of scriptCoverage.functions ?? []) {
    for (const range of fn.ranges ?? []) {
      if (range.endOffset > length) length = range.endOffset;
    }
  }
  return length;
}

// A file is worth attempting to remap when tests/tools/jsx-hooks.mjs would
// have transpiled it: only that loader's own gate -- a .js/.jsx/.mjs file
// whose source contains a `<` -- ever produces the generated-text mismatch
// this exists to undo.
export function isJsxSource(relPath, source) {
  return SCRIPT_URL.test(relPath) && source.includes('<');
}

const BASE64_VLQ_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VLQ_VALUES = new Map(
  [...BASE64_VLQ_CHARS].map((char, value) => [char, value]),
);
const VLQ_CONTINUATION_BIT = 0b100000;
const VLQ_DATA_MASK = 0b011111;

// Decodes one base64-VLQ number starting at `pos` in `segment`, per the
// source map v3 spec: 5 data bits per char, continuation in the 6th bit, and
// the least-significant decoded bit is the sign.
function decodeVlqValue(segment, pos) {
  let result = 0;
  let shift = 0;
  let value;
  do {
    value = BASE64_VLQ_VALUES.get(segment[pos]);
    pos += 1;
    result += (value & VLQ_DATA_MASK) << shift;
    shift += 5;
  } while (value & VLQ_CONTINUATION_BIT);
  return { value: result & 1 ? -(result >> 1) : result >> 1, pos };
}

// Decodes a source map's `mappings` field into one array of segments per
// generated line. Each segment is { genColumn, sourceLine, sourceColumn },
// 0-based; the name-index field, present only on some segments, is skipped
// since nothing here needs it.
export function decodeMappings(mappings) {
  let sourceLine = 0;
  let sourceColumn = 0;
  return mappings.split(';').map((lineMappings) => {
    let genColumn = 0;
    const segments = [];
    if (!lineMappings) return segments;
    for (const field of lineMappings.split(',')) {
      if (!field) continue;
      let pos = 0;
      let decoded = decodeVlqValue(field, pos);
      genColumn += decoded.value;
      pos = decoded.pos;
      if (pos >= field.length) continue; // a generated-only segment carries no source position
      decoded = decodeVlqValue(field, pos); // source file index; always 0 here
      pos = decoded.pos;
      decoded = decodeVlqValue(field, pos);
      sourceLine += decoded.value;
      pos = decoded.pos;
      decoded = decodeVlqValue(field, pos);
      sourceColumn += decoded.value;
      segments.push({ genColumn, sourceLine, sourceColumn });
    }
    return segments;
  });
}

// The character offset each line of `text` starts at, indexed by 0-based
// line number.
function lineStartOffsets(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

// Remaps line coverage recorded against swc-generated text back onto the
// original source. Node's ESM coverage indexes generated text by character
// offset, and this reporter otherwise has no way to attribute it to the file
// on disk; going only to line granularity keeps the remap simple and robust
// against a JSX transform that changes column positions and inserted tokens
// on every line, while still restoring exactly what was lost (#628): a real
// per-file line percentage, and an unreachable line showing as uncovered.
//
// A generated line is credited to the source line of the first mapping
// segment on it; a source line is executable if any contributing generated
// line was, and covered if any contributing generated line was.
//
// `code` must be the bare transform output the map's line numbers describe --
// tests/tools/jsx-hooks.mjs's inlineSourceMapCode() appends a trailing
// `//# sourceMappingURL=` comment that the map itself has no entry for, so
// passing that instead would shift every line index by one. `generatedCounts`
// may safely be sized to the longer, comment-inclusive text: only offsets
// below code.length are ever read.
export function remapJsxLineCoverage(code, generatedCounts, map) {
  const genLineStarts = lineStartOffsets(code);
  const genLines = decodeMappings(map.mappings);
  const originalLineCount = Math.max(
    1,
    ...genLines.flatMap((segments) =>
      segments.map((segment) => segment.sourceLine + 1),
    ),
  );
  const executable = new Array(originalLineCount).fill(false);
  const covered = new Array(originalLineCount).fill(false);

  for (let genLine = 0; genLine < genLineStarts.length; genLine += 1) {
    const segments = genLines[genLine];
    if (!segments || segments.length === 0) continue;
    const start = genLineStarts[genLine];
    const end = genLineStarts[genLine + 1] ?? code.length;
    let lineExecutable = false;
    let lineCovered = false;
    for (let offset = start; offset < end; offset += 1) {
      const char = code[offset];
      if (char === '\r' || char === ' ' || char === '\t' || char === '\n') {
        continue;
      }
      const count = generatedCounts[offset];
      if (count < 0) continue;
      lineExecutable = true;
      if (count > 0) lineCovered = true;
    }
    if (!lineExecutable) continue;
    const { sourceLine } = segments[0];
    executable[sourceLine] = true;
    if (lineCovered) covered[sourceLine] = true;
  }

  return { executable, covered };
}

// Builds a counts array over the original source, indexed like
// countsForScript()'s output, from the per-original-line executable/covered
// verdict remapJsxLineCoverage() computed. Every character on a line is given
// the same synthetic count so summarizeLines() and summarizeRegions() need no
// changes to read it; the tradeoff is that a remapped file scores regions at
// line granularity rather than true sub-line granularity.
export function countsFromLineVerdict(source, { executable, covered }) {
  const counts = new Int32Array(source.length).fill(-1);
  const lineStarts = lineStartOffsets(source);
  for (let line = 0; line < lineStarts.length; line += 1) {
    if (!executable[line]) continue;
    const start = lineStarts[line];
    const end = lineStarts[line + 1] ?? source.length;
    const value = covered[line] ? 1 : 0;
    for (let offset = start; offset < end; offset += 1) counts[offset] = value;
  }
  return counts;
}

// A line counts as executable when it carries non-whitespace source inside a
// recorded range; it counts as covered when any such character ran.
export function summarizeLines(source, counts) {
  const total = { executable: 0, covered: 0, uncovered: [] };
  let line = 1;
  let lineExecutable = false;
  let lineCovered = false;

  const flush = () => {
    if (lineExecutable) {
      total.executable += 1;
      if (lineCovered) total.covered += 1;
      else total.uncovered.push(line);
    }
    lineExecutable = false;
    lineCovered = false;
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\n') {
      flush();
      line += 1;
      continue;
    }
    if (char === '\r' || char === ' ' || char === '\t') continue;
    const count = counts[i];
    if (count < 0) continue;
    lineExecutable = true;
    if (count > 0) lineCovered = true;
  }
  flush();
  return total;
}

// A region is a maximal run of offsets sharing the same recorded count (a
// single V8 range, or several adjacent ranges that happen to agree after the
// merge in collect()). Line coverage marks a line covered when any character
// on it ran, so a `||` default, a `??` fallback, or a ternary arm that never
// executed is invisible there whenever the rest of its line did run; scoring
// at region granularity instead surfaces exactly those sub-line gaps (#640).
// A region counts as executable only when it contains non-whitespace source,
// so padding between two same-count ranges is not scored as its own gap.
export function summarizeRegions(source, counts) {
  const total = { regions: 0, covered: 0, uncovered: [] };
  const length = counts.length;
  let i = 0;
  let line = 1;
  while (i < length) {
    const count = counts[i];
    const startLine = line;
    let hasNonBlank = false;
    let j = i;
    while (j < length && counts[j] === count) {
      const char = source[j];
      if (char === '\n') line += 1;
      else if (char !== '\r' && char !== ' ' && char !== '\t') {
        hasNonBlank = true;
      }
      j += 1;
    }
    if (count >= 0 && hasNonBlank) {
      total.regions += 1;
      if (count > 0) total.covered += 1;
      else total.uncovered.push(startLine);
    }
    i = j;
  }
  return total;
}

// `lines` must be ascending. Repeats are collapsed: two uncovered regions can
// start on the same line (`a ?? b ?? c`), and summarizeRegions records one
// entry for each, but the reader only needs the line named once.
export function formatRanges(lines) {
  const out = [];
  let start = null;
  let previous = null;
  for (const line of lines) {
    if (start === null) {
      start = line;
    } else if (line === previous) {
      continue;
    } else if (line !== previous + 1) {
      out.push(start === previous ? `${start}` : `${start}-${previous}`);
      start = line;
    }
    previous = line;
  }
  if (start !== null) {
    out.push(start === previous ? `${start}` : `${start}-${previous}`);
  }
  return out.join(' ');
}

function percent(covered, total) {
  return total === 0 ? 100 : (covered / total) * 100;
}

// `src files` and `harness files` are the same arithmetic over two disjoint
// sets of rows, and the gates that read them are the same three shapes. They
// share an accumulator so a change to one row cannot quietly stop applying to
// the other.
function newTotals() {
  return {
    executable: 0,
    covered: 0,
    regions: 0,
    regionsCovered: 0,
    fileRegions: [],
  };
}

function addRow(totals, row) {
  totals.executable += row.lines.executable;
  totals.covered += row.lines.covered;
  totals.regions += row.regions.regions;
  totals.regionsCovered += row.regions.covered;
  // Files with no regions at all are left out: percent() reports 100%
  // for a 0/0 fraction, so including them would add rows that can never
  // fail the per-file floor and never say anything either.
  if (row.regions.regions > 0) {
    totals.fileRegions.push({
      file: row.file,
      percent: percent(row.regions.covered, row.regions.regions),
      covered: row.regions.covered,
      regions: row.regions.regions,
      uncovered: row.regions.uncovered,
    });
  }
}

function summaryRow(label, totals, width) {
  const linePct = percent(totals.covered, totals.executable);
  const regionPct = percent(totals.regionsCovered, totals.regions);
  console.log(
    `${label.padEnd(width)} | ${linePct.toFixed(2).padStart(6)} | ${regionPct.toFixed(2).padStart(8)} | ${totals.covered}/${totals.executable} lines | ${totals.regionsCovered}/${totals.regions} regions`,
  );
  return { linePct, regionPct };
}

// Coverage records exist for the test files too. They are not the code this
// repository ships, so they are summarised separately rather than folded
// into totals the suite's own near-complete self-coverage would dominate.
export function isSourceFile(file) {
  return !file.startsWith('tests/');
}

// The harness modules under SOURCE_ROOTS: measured like source, summarised
// like neither. isSourceFile() keeps them out of the `src files` ratios, and
// this keeps them out of nothing -- it is what gives them the row and the
// floors of their own.
export function isHarnessFile(file) {
  return HARNESS_ROOTS.some((root) => file.startsWith(`${root}/`));
}

// Every module on disk under SOURCE_ROOTS, as repo-relative '/'-joined paths.
// Walked rather than globbed so the traversal order is the sort order and a
// directory that does not exist is simply absent instead of throwing -- the
// caller is asking "what should have been measured", and a repository that
// has dropped scripts/ entirely has nothing to answer with.
export function enumerateSourceFiles(root = repoRoot) {
  const found = [];
  const walk = (relDir) => {
    let entries;
    try {
      entries = readdirSync(join(root, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = `${relDir}/${entry.name}`;
      // Symlinked trees would report the same module under two paths, and
      // only one of them can match a coverage record.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(relPath);
      else if (entry.isFile() && SOURCE_FILE.test(entry.name))
        found.push(relPath);
    }
  };
  for (const dir of SOURCE_ROOTS) walk(dir);
  return found.sort();
}

// Source files that exist but that this run never recorded.
//
// `unmapped` counts as measured: those files were executed, and the reporter
// could only not attribute the offsets back to the text on disk. Folding them
// into the missing set would turn every JSX component into a permanent
// failure of a check that is about files nothing ran at all.
export function missingSourceFiles(measured, root = repoRoot) {
  const seen = new Set(measured);
  return enumerateSourceFiles(root).filter((file) => !seen.has(file));
}

// Source files that were recorded but whose records could not be attributed
// back to the text on disk.
//
// These are not "missing" -- something ran them -- but they are not measured
// either: report() builds every ratio from the merged map alone, so an
// unmapped file leaves the numerator and the denominator together and every
// percentage gate passes over it in silence. The distinction matters because
// the two states have different cures: a missing file needs a test, whereas
// an unmapped one means the loader and the reporter have drifted apart and
// the measurement is unavailable.
export function unmappedSourceFiles(unmapped, root = repoRoot) {
  const recorded = new Set(unmapped);
  return enumerateSourceFiles(root).filter((file) => recorded.has(file));
}

// Reproduces the exact transform tests/tools/jsx-hooks.mjs applied when it
// loaded this file, so the generated text V8 recorded coverage against can be
// rebuilt outside the test run. Returns null when the file was not JSX, or
// when the reproduced text does not match what was recorded (a different
// swc version, or a loader change) -- callers must fall back to leaving the
// record unmapped rather than attributing counts to the wrong offsets.
function tryRemapJsx(scriptCoverage, relPath, source, root) {
  if (!isJsxSource(relPath, source)) return null;
  let transformed;
  try {
    transformed = transpileJsx(source, join(root, relPath));
  } catch {
    return null;
  }
  const generatedCode = inlineSourceMapCode(transformed.code, transformed.map);
  if (generatedCode.length !== recordedSourceLength(scriptCoverage)) {
    return null;
  }
  const generatedCounts = countsForScript(scriptCoverage, generatedCode.length);
  const map = JSON.parse(transformed.map);
  const verdict = remapJsxLineCoverage(transformed.code, generatedCounts, map);
  return countsFromLineVerdict(source, verdict);
}

// Merges every recorded run into one per-file coverage map, discarding any
// record whose offsets were taken against text other than the file on disk
// and could not be remapped either. Returns the merged map plus the files
// that were discarded outright.
export function collect(coverageDir, root = repoRoot) {
  // Highest observed count per offset across every process and sandbox run.
  const merged = new Map();
  // Files whose every record was recorded against text other than the file on
  // disk, so no offset in them can be attributed to a source line.
  const unmapped = new Set();
  for (const entry of readdirSync(coverageDir)) {
    if (!entry.endsWith('.json')) continue;
    let payload;
    try {
      payload = JSON.parse(readFileSync(join(coverageDir, entry), 'utf8'));
    } catch {
      continue;
    }
    for (const scriptCoverage of payload.result ?? []) {
      const relPath = toRepoRelativePath(scriptCoverage.url, root);
      if (!relPath) continue;
      let source = merged.get(relPath)?.source;
      if (source === undefined) {
        try {
          source = readFileSync(join(root, relPath), 'utf8');
        } catch {
          continue;
        }
      }
      // Offsets recorded against a different text cannot be projected onto
      // this file directly. A JSX component transpiles to exactly the text
      // tests/tools/jsx-hooks.mjs recorded coverage against, so try to
      // reconstruct that text and remap its offsets back onto the source
      // before giving up on the record (#628).
      let counts;
      if (recordedSourceLength(scriptCoverage) !== source.length) {
        counts = tryRemapJsx(scriptCoverage, relPath, source, root);
        if (!counts) {
          unmapped.add(relPath);
          continue;
        }
      } else {
        counts = countsForScript(scriptCoverage, source.length);
      }
      const existing = merged.get(relPath);
      if (!existing) {
        merged.set(relPath, { source, counts });
        continue;
      }
      for (let i = 0; i < counts.length; i += 1) {
        if (counts[i] > existing.counts[i]) existing.counts[i] = counts[i];
      }
    }
  }
  for (const relPath of merged.keys()) unmapped.delete(relPath);
  return { merged, unmapped };
}

export function report(merged) {
  const rows = [...merged.entries()]
    .map(([file, { source, counts }]) => ({
      file,
      lines: summarizeLines(source, counts),
      regions: summarizeRegions(source, counts),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  const width = Math.max(4, ...rows.map((row) => row.file.length));
  // The region column is what makes a `--check-source-regions` failure
  // actionable. A sub-line gap -- an unexecuted `??` fallback or ternary arm --
  // leaves its line fully covered, so a file can sit at 100% lines with a
  // region percentage below the gate and nothing in the "uncovered lines"
  // column to point at. Naming the start line of each uncovered region is the
  // only thing in this report that locates such a gap.
  const header = `${'file'.padEnd(width)} | line % | region % | uncovered lines | uncovered regions`;
  console.log(header);
  console.log('-'.repeat(header.length));

  let executable = 0;
  let covered = 0;
  let regions = 0;
  let regionsCovered = 0;
  const source = newTotals();
  const harness = newTotals();
  for (const row of rows) {
    executable += row.lines.executable;
    covered += row.lines.covered;
    regions += row.regions.regions;
    regionsCovered += row.regions.covered;
    if (isSourceFile(row.file)) addRow(source, row);
    else if (isHarnessFile(row.file)) addRow(harness, row);
    const linePct = percent(row.lines.covered, row.lines.executable)
      .toFixed(2)
      .padStart(6);
    const regionPct = percent(row.regions.covered, row.regions.regions)
      .toFixed(2)
      .padStart(8);
    console.log(
      `${row.file.padEnd(width)} | ${linePct} | ${regionPct} | ${formatRanges(row.lines.uncovered)} | ${formatRanges(row.regions.uncovered)}`,
    );
  }
  console.log('-'.repeat(header.length));
  const { linePct: sourceLinePct, regionPct: sourceRegionPct } = summaryRow(
    'src files',
    source,
    width,
  );
  const { linePct: harnessLinePct, regionPct: harnessRegionPct } = summaryRow(
    'harness files',
    harness,
    width,
  );
  const totalLinePct = percent(covered, executable);
  const totalRegionPct = percent(regionsCovered, regions);
  console.log(
    `${'all files'.padEnd(width)} | ${totalLinePct.toFixed(2).padStart(6)} | ${totalRegionPct.toFixed(2).padStart(8)} | ${covered}/${executable} lines | ${regionsCovered}/${regions} regions`,
  );
  return {
    totalLinePct,
    totalRegionPct,
    sourceLinePct,
    sourceRegionPct,
    sourceExecutable: source.executable,
    sourceRegions: source.regions,
    sourceFileRegions: source.fileRegions,
    harnessLinePct,
    harnessRegionPct,
    harnessExecutable: harness.executable,
    harnessRegions: harness.regions,
    harnessFileRegions: harness.fileRegions,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const coverageDir = mkdtempSync(join(tmpdir(), 'endusers-coverage-'));
  try {
    const result = spawnSync(
      process.execPath,
      ['--test', ...options.testArgs],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, NODE_V8_COVERAGE: coverageDir },
      },
    );
    const { merged, unmapped } = collect(coverageDir);
    if (merged.size === 0) {
      console.error('No coverage data was recorded.');
      process.exit(1);
    }
    console.log('');
    const {
      totalLinePct,
      totalRegionPct,
      sourceLinePct,
      sourceRegionPct,
      sourceExecutable,
      sourceRegions,
      sourceFileRegions,
      harnessLinePct,
      harnessRegionPct,
      harnessExecutable,
      harnessRegions,
      harnessFileRegions,
    } = report(merged);
    const missing = options.requireSourceFiles
      ? missingSourceFiles([...merged.keys(), ...unmapped])
      : [];
    // Printed before the "Not reported" notice so that notice stays the last
    // thing on stdout, which is where tests/coverage-report-cli.test.mjs
    // reads it from. Computed only under the flag: an ad-hoc run over a
    // single test file leaves almost every source file unmeasured by
    // construction, and listing all of them would bury the table.
    if (missing.length > 0) {
      console.log(
        `\nNever measured (${missing.length}): these files exist under ` +
          `${SOURCE_ROOTS.join('/ or ')}/ but no\n` +
          'coverage record named them, so they are absent from the "src files"\n' +
          'numerator and denominator alike and the percentage gates below pass\n' +
          'over them in silence.',
      );
      for (const file of missing) console.log(`  ${file}`);
    }
    if (unmapped.size > 0) {
      console.log(
        `\nNot reported (${unmapped.size}): every coverage record for these\n` +
          'files was made against text the loader generated (transpiled JSX,\n' +
          'or a JSON module wrapper), so their offsets do not address the\n' +
          'source on disk.',
      );
      for (const file of [...unmapped].sort()) console.log(`  ${file}`);
    }

    if (result.status !== 0) {
      console.error('\nTests failed; coverage above is reported for context.');
      process.exit(result.status ?? 1);
    }
    // Checked ahead of the percentage gates because it is the more specific
    // diagnosis: when a source file was never loaded, every ratio below is
    // computed over a denominator that silently excludes it, so whatever
    // those gates report about it is not an answer.
    //
    // The two diagnoses are reported together rather than one short-circuiting
    // the other: they are different faults with different cures, and a run
    // that has both should say so once instead of surfacing the second only
    // after the first is fixed.
    let fileSetFailed = false;
    if (missing.length > 0) {
      console.error(
        `\n${missing.length} source file(s) were never measured; ` +
          '--require-source-files requires every file under ' +
          `${SOURCE_ROOTS.join('/ and ')}/ to be exercised.`,
      );
      fileSetFailed = true;
    }
    // The companion to the check above, for the other way a source file can
    // leave every ratio: recorded, but with offsets the reporter could not
    // attribute back to the file on disk. report() is built from `merged`
    // alone, so such a file is absent from the "src files" numerator and
    // denominator alike -- exactly the silence --require-source-files exists
    // to break -- while still counting as measured for the missing-file check,
    // which is about files nothing ran at all. Data modules go on being
    // listed in the notice above without failing anything: only the trees
    // --require-source-files walks are gated.
    const unmeasurable = options.requireSourceFiles
      ? unmappedSourceFiles(unmapped)
      : [];
    if (unmeasurable.length > 0) {
      console.error(
        `\n${unmeasurable.length} source file(s) were recorded but could not ` +
          'be mapped onto the text on disk, so they enter no ratio below; ' +
          '--require-source-files requires every file under ' +
          `${SOURCE_ROOTS.join('/ and ')}/ to be measurable.`,
      );
      for (const file of unmeasurable) console.error(`  ${file}`);
      fileSetFailed = true;
    }
    if (fileSetFailed) process.exit(1);
    if (options.check !== null && totalLinePct + 1e-9 < options.check) {
      console.error(
        `\nLine coverage ${totalLinePct.toFixed(2)}% is below the required ${options.check}%.`,
      );
      process.exit(1);
    }
    if (
      options.checkRegions !== null &&
      totalRegionPct + 1e-9 < options.checkRegions
    ) {
      console.error(
        `\nRegion coverage ${totalRegionPct.toFixed(2)}% is below the required ${options.checkRegions}%.`,
      );
      process.exit(1);
    }
    // A zero-line source measurement means the gate below would otherwise
    // pass vacuously (percent() reports 100% for a 0/0 fraction) without
    // having actually verified any shipped source code.
    if (options.checkSource !== null && sourceExecutable === 0) {
      console.error(
        '\n--check-source was requested, but no source lines outside tests/ were recorded.',
      );
      process.exit(1);
    }
    if (
      options.checkSource !== null &&
      sourceLinePct + 1e-9 < options.checkSource
    ) {
      console.error(
        `\nSource line coverage ${sourceLinePct.toFixed(2)}% is below the required ${options.checkSource}%.`,
      );
      process.exit(1);
    }
    if (options.checkSourceRegions !== null && sourceRegions === 0) {
      console.error(
        '\n--check-source-regions was requested, but no source regions outside tests/ were recorded.',
      );
      process.exit(1);
    }
    if (
      options.checkSourceRegions !== null &&
      sourceRegionPct + 1e-9 < options.checkSourceRegions
    ) {
      console.error(
        `\nSource region coverage ${sourceRegionPct.toFixed(2)}% is below the required ${options.checkSourceRegions}%.`,
      );
      process.exit(1);
    }
    if (options.checkSourceFileRegions !== null) {
      // Same vacuous-pass guard as --check-source-regions: with no source
      // rows carrying regions there is nothing for a per-file floor to
      // measure, and an empty list of offenders is not a pass.
      if (sourceFileRegions.length === 0) {
        console.error(
          '\n--check-source-file-regions was requested, but no source file outside tests/ recorded any region.',
        );
        process.exit(1);
      }
      const below = sourceFileRegions.filter(
        (entry) => entry.percent + 1e-9 < options.checkSourceFileRegions,
      );
      if (below.length > 0) {
        console.error(
          `\n${below.length} source file(s) fall below the required ` +
            `${options.checkSourceFileRegions}% region coverage per file:`,
        );
        for (const entry of below) {
          console.error(
            `  ${entry.file} ${entry.percent.toFixed(2)}% ` +
              `(${entry.covered}/${entry.regions} regions; uncovered at ${formatRanges(entry.uncovered)})`,
          );
        }
        process.exit(1);
      }
    }
    // The harness gates are the source gates applied to the other half of
    // SOURCE_ROOTS. They are separate thresholds rather than a widened
    // `src files` because the two trees answer different questions and sit
    // at different percentages: folding tests/tools/ into the shipped-source
    // ratios would let a harness gap be paid for out of src/'s slack, which
    // is the averaging --check-source-file-regions already exists to stop.
    if (options.checkHarness !== null && harnessExecutable === 0) {
      console.error(
        `\n--check-harness was requested, but no harness lines under ${HARNESS_ROOTS.join('/ or ')}/ were recorded.`,
      );
      process.exit(1);
    }
    if (
      options.checkHarness !== null &&
      harnessLinePct + 1e-9 < options.checkHarness
    ) {
      console.error(
        `\nHarness line coverage ${harnessLinePct.toFixed(2)}% is below the required ${options.checkHarness}%.`,
      );
      process.exit(1);
    }
    if (options.checkHarnessRegions !== null && harnessRegions === 0) {
      console.error(
        `\n--check-harness-regions was requested, but no harness regions under ${HARNESS_ROOTS.join('/ or ')}/ were recorded.`,
      );
      process.exit(1);
    }
    if (
      options.checkHarnessRegions !== null &&
      harnessRegionPct + 1e-9 < options.checkHarnessRegions
    ) {
      console.error(
        `\nHarness region coverage ${harnessRegionPct.toFixed(2)}% is below the required ${options.checkHarnessRegions}%.`,
      );
      process.exit(1);
    }
    if (options.checkHarnessFileRegions !== null) {
      if (harnessFileRegions.length === 0) {
        console.error(
          `\n--check-harness-file-regions was requested, but no harness file under ${HARNESS_ROOTS.join('/ or ')}/ recorded any region.`,
        );
        process.exit(1);
      }
      const below = harnessFileRegions.filter(
        (entry) => entry.percent + 1e-9 < options.checkHarnessFileRegions,
      );
      if (below.length > 0) {
        console.error(
          `\n${below.length} harness file(s) fall below the required ` +
            `${options.checkHarnessFileRegions}% region coverage per file:`,
        );
        for (const entry of below) {
          console.error(
            `  ${entry.file} ${entry.percent.toFixed(2)}% ` +
              `(${entry.covered}/${entry.regions} regions; uncovered at ${formatRanges(entry.uncovered)})`,
          );
        }
        process.exit(1);
      }
    }
  } finally {
    rmSync(coverageDir, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
