#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import v8ToIstanbul from 'v8-to-istanbul';
import { AnyMap, decodedMap, encodedMap } from '@jridgewell/trace-mapping';

import {
  countsForScript,
  enumerateSourceFiles,
  percent,
  recordedSourceLength,
} from './coverage-report.mjs';
import {
  COVERAGE_ARTIFACT_KIND,
  readCoverageRun,
} from './e2e-coverage-run.mjs';
import {
  COVERAGE_SCRIPTS_DIR,
  isEligibleScript,
  isInside,
  resolveScriptInRoot,
  scriptPathname,
  totalDecodeURIComponent,
} from './e2e-coverage-scripts.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const REPORT_KIND = 'endusers.e2e.coverage-report';
const ERROR_KIND = 'endusers.e2e.coverage-report-error';
// Residual zero-count regions ADR 0007 has triaged out of the browser lane.
// Read from the root the report is rendered against, so a fixture root with no
// registry renders exactly as it did before the registry existed.
export const ACCEPTED_REGIONS_PATH = 'tests/e2e/fixtures/accepted-regions.json';
export const ACCEPTED_REGION_CLASSES = Object.freeze([
  'data-shape-guard',
  'span-drift',
]);
const REGION_SPAN = /^[1-9]\d*:\d+-[1-9]\d*:\d+$/u;
const SOURCE_MAPPING_URL = /(?:\/\/[#@]\s*sourceMappingURL=)(\S+)/u;
const ORIGINAL_SCRIPT = /\.(?:c|m)?(?:js|jsx|ts|tsx)$/u;

// Residual uncovered regions, recorded so the file's region percentage is not
// re-investigated every cycle. The guards in the three istanbul
// readers below are reached directly by
// tests/e2e-coverage-report-readers.test.mjs, which is what the test-only
// export beneath `getRegionCoverage` exists for. What remains after that is
// unreachable from this module, and each entry is named by function and
// expression rather than by line so the note does not go stale when the file
// moves:
//
//   splitRangeAtBoundaries  `parts.length === 0 ? [range] : parts` -- the
//       function returns early when there are no cuts; otherwise the last cut
//       `c` satisfies `c < range.endOffset` by the filter above it, `start`
//       equals `c` when the loop ends, so the final `parts.push` always runs
//       and `parts` is never empty.
//   collectE2ECoverage  `if (lineCoverage.size === 0) continue`, which needs
//       an istanbul object carrying branches but no statements at all.
//   main                `error.message ?? String(error)` and `error.stack ??
//       error` -- both need `main()` to reject with a non-`Error`, and nothing
//       in its call graph throws one.
//
// Reachability was established empirically rather than by reading: probe tests
// were written against each candidate and these are the ones no probe could
// close. (The `convertScript` guards that used to sit in this list were
// removed outright once tests/e2e-coverage-attribution.test.mjs pinned the
// converter shape they defended against. `normalizeSourceMap`'s
// `?? flattened.sources ?? []` and `collectE2ECoverage`'s `converted.coverage
// ?? {}` left the list the same way: tests/e2e-coverage-nullish-guards.test.mjs
// pins `AnyMap(...).resolvedSources` as always an array and `toIstanbul()` as
// always an object, so the guards were deleted rather than carried as
// permanently-dead regions.) Together they are 4 regions, which caps this file
// at 99.16% regions; tests/coverage-gate-thresholds.test.mjs records that
// ceiling beside `--check-harness-file-regions` so the floor is never set
// above it. The denominator behind that percentage is V8's, so it drifts a
// little with the Node major -- 4/476 was measured on Node 26 while CI pins
// Node 22 -- which is why the floor sits a whole point below the ceiling
// rather than against it. Raise the floor rather than this list when a probe
// does land, and extend this list rather than lower the floor when a new
// fallback proves unreachable.
//
// The two `main` entries above rest on a premise that lives outside the arms
// -- every value in the call graph being an `Error` -- so a `throw` written in
// a later edit could make both live without either arm being touched.
// tests/e2e-coverage-error-arms.test.mjs asserts that premise directly, the
// way tests/e2e-coverage-split-range.test.mjs asserts the
// `splitRangeAtBoundaries` one, so such a change fails on a test name rather
// than quietly altering what the failure artifact reports.

class CoverageReportError extends Error {
  constructor(message, { runId = null, runStatus = null } = {}) {
    super(message);
    this.name = 'CoverageReportError';
    this.runId = runId;
    this.runStatus = runStatus;
  }
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function linePercent(covered, executable) {
  return Number(percent(covered, executable).toFixed(2));
}

function parsePercent(value, flag = '--check-source') {
  // Number('') is 0 and Number(' ') is 0, so a missing or blank value would
  // otherwise read as a satisfied gate rather than as the typo it is.
  const blank = String(value ?? '').trim() === '';
  const parsed = blank ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(
      `${flag} expects a percentage between 0 and 100, got ${value}`,
    );
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    input: null,
    build: 'build',
    root: repoRoot,
    json: null,
    text: null,
    checkSource: null,
    checkSourceRegions: null,
    checkSourceFileRegions: null,
    requireSourceFiles: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index];
    else if (arg === '--build') options.build = argv[++index];
    else if (arg === '--root') options.root = argv[++index];
    else if (arg === '--json') options.json = argv[++index];
    else if (arg === '--text') options.text = argv[++index];
    else if (arg === '--check-source')
      options.checkSource = parsePercent(argv[++index]);
    else if (arg === '--check-source-regions')
      options.checkSourceRegions = parsePercent(
        argv[++index],
        '--check-source-regions',
      );
    else if (arg === '--check-source-file-regions')
      options.checkSourceFileRegions = parsePercent(
        argv[++index],
        '--check-source-file-regions',
      );
    else if (arg === '--require-source-files')
      options.requireSourceFiles = true;
    else throw new Error(`unknown e2e coverage report option: ${arg}`);
  }
  if (!options.input) throw new Error('--input is required');
  return options;
}

function repoRelative(root, file) {
  const rel = relative(root, file).split(sep).join('/');
  return rel === '' || rel.startsWith('..') ? null : rel;
}

function sourcePathFromReference(reference, mapPath, root) {
  if (typeof reference !== 'string' || reference === '') return null;
  let value = reference.split(/[?#]/u, 1)[0];
  if (value.startsWith('file://')) {
    value = fileURLToPath(value);
  } else if (value.startsWith('webpack://')) {
    value = value.slice('webpack://'.length);
    const slash = value.indexOf('/');
    value = slash === -1 ? '' : value.slice(slash);
  }

  // Total decode: a source-map `sources` entry with a stray `%` is treated
  // as already-decoded text rather than aborting the whole report;
  // containment against the root is still checked below either way.
  value = totalDecodeURIComponent(value).replaceAll('\\', '/');
  const absoluteSpecifier = value.lastIndexOf('|/');
  if (absoluteSpecifier !== -1) {
    value = value.slice(absoluteSpecifier + 1);
  }

  if (value.startsWith('/')) {
    const absolute = resolve(value);
    if (isInside(root, absolute)) {
      const rel = repoRelative(root, absolute);
      return rel?.startsWith('src/') ? { absolute, relative: rel } : null;
    }
  }

  const srcMarker = value.lastIndexOf('/src/');
  if (srcMarker !== -1 && !value.includes('/node_modules/')) {
    value = value.slice(srcMarker + 1);
  }

  const candidate = value.startsWith('src/')
    ? resolve(root, value)
    : value.startsWith('/')
      ? resolve(value)
      : resolve(dirname(mapPath), value);
  if (!isInside(root, candidate)) return null;
  const rel = repoRelative(root, candidate);
  return rel?.startsWith('src/')
    ? { absolute: candidate, relative: rel }
    : null;
}

export { sourcePathFromReference };

function decodeDataUrl(value) {
  const match =
    /^data:application\/json(?:;charset=[^;,]+)?(;base64)?,(.*)$/u.exec(value);
  if (!match) return null;
  const raw = match[1]
    ? Buffer.from(match[2], 'base64').toString('utf8')
    : // Total decode: an inline map that was written without percent-encoding
      // contains raw `%` sequences that would make decodeURIComponent throw;
      // the undecoded text is then the JSON itself.
      totalDecodeURIComponent(match[2]);
  return JSON.parse(raw);
}

async function loadSourceMap(reference, scriptPath, buildDir) {
  const inline = decodeDataUrl(reference);
  if (inline) return { map: inline, mapPath: scriptPath };

  const mapPath = resolve(dirname(scriptPath), reference);
  const buildRoot = await realpath(buildDir);
  if (!isInside(buildRoot, mapPath)) {
    throw new Error(`source map escapes build directory: ${reference}`);
  }
  const resolvedMapPath = await realpath(mapPath);
  if (!isInside(buildRoot, resolvedMapPath)) {
    throw new Error(`source map escapes build directory: ${reference}`);
  }
  const raw = await readFile(resolvedMapPath, 'utf8');
  return { map: JSON.parse(raw), mapPath: resolvedMapPath };
}

// The generated bundle is scanned for its sourceMappingURL exactly once: the
// stripped source and the map reference both come from that single match, so
// neither caller can be reached with a source that has no comment.
function splitSourceMapComment(source) {
  const match = SOURCE_MAPPING_URL.exec(source);
  if (!match)
    throw new Error('generated source has no sourceMappingURL comment');
  return {
    mappedSource: source.slice(0, match.index).replace(/\r?\n$/u, ''),
    reference: match[1],
  };
}

async function normalizeSourceMap(rawMap, mapPath, root) {
  const map = new AnyMap(rawMap, pathToFileURL(mapPath).href);
  const flattened = encodedMap(map);
  // `AnyMap` always exposes `resolvedSources` as an array -- for an ordinary
  // map, an index map, a map with no sources at all, and a map whose entries
  // are null. The `?? flattened.sources ?? []` arms this used to carry could
  // therefore never run, and the two spellings are not interchangeable: for an
  // index map `flattened.sources` holds resolved `file://` URLs while a flat
  // map's holds the raw references, so a fallback that did fire would have
  // handed the loop below a different shape than the arm above it.
  // tests/e2e-coverage-nullish-guards.test.mjs pins the premise against the
  // installed @jridgewell/trace-mapping, the same way
  // tests/e2e-coverage-attribution.test.mjs pins the converter's.
  const references = map.resolvedSources;
  const sourcesContent = [];
  const normalizedSources = [];
  const sourceFiles = [];
  const rootPath = await realpath(root);
  const srcRoot = resolve(root, 'src');
  const srcRootPath = await realpath(srcRoot);

  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    const sourceFile = sourcePathFromReference(reference, mapPath, root);
    const suppliedContent = map.sourcesContent?.[index] ?? null;
    if (!sourceFile) {
      normalizedSources.push(`e2e-external-source-${index}.js`);
      sourcesContent.push(suppliedContent ?? '');
      continue;
    }
    // `sourcePathFromReference` only ever returns a path whose repo-relative
    // form starts with `src/`, so a lexical containment check here can never
    // fire. Containment is enforced below against the resolved path, which is
    // what catches a symlink pointing out of `src`.
    const resolvedSource = await realpath(sourceFile.absolute);
    if (!isInside(srcRootPath, resolvedSource)) {
      throw new Error(
        `source map source escapes src directory: ${sourceFile.relative}`,
      );
    }
    if (!ORIGINAL_SCRIPT.test(sourceFile.relative)) {
      normalizedSources.push(`e2e-external-source-${index}.js`);
      sourcesContent.push('');
      continue;
    }

    if (!isInside(rootPath, resolvedSource)) {
      throw new Error(
        `source map source escapes repository: ${sourceFile.relative}`,
      );
    }

    const diskContent = await readFile(resolvedSource, 'utf8');
    if (suppliedContent !== null && suppliedContent !== diskContent) {
      throw new Error(
        `source map content does not match ${sourceFile.relative}`,
      );
    }
    normalizedSources.push(resolvedSource);
    sourcesContent.push(suppliedContent ?? diskContent);
    sourceFiles.push({
      absolute: resolvedSource,
      relative: repoRelative(rootPath, resolvedSource),
    });
  }

  return {
    map: {
      ...flattened,
      sourceRoot: '',
      sources: normalizedSources,
      sourcesContent,
    },
    sourceFiles,
  };
}

// Reads the record mergedCapture builds, which always carries its ranges.
function normalizeRanges(scriptCoverage, length) {
  const recordedLength = Math.max(
    0,
    ...scriptCoverage.functions.flatMap((fn) =>
      fn.ranges.map((range) => range.endOffset),
    ),
  );
  if (recordedLength > length) {
    throw new Error(
      `coverage offsets exceed generated source length (${recordedLength} > ${length})`,
    );
  }

  const ranges = rangesFromCounts(countsForScript(scriptCoverage, length));
  return ranges.length === 0
    ? []
    : [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges,
        },
      ];
}

// One range per run of equal per-offset counts; offsets no range covered
// (count -1) produce none.
function rangesFromCounts(counts) {
  const { length } = counts;
  const ranges = [];
  let start = null;
  let current = -1;
  const flush = (end) => {
    if (start !== null && current >= 0 && end > start) {
      ranges.push({
        startOffset: start,
        endOffset: end,
        count: current,
      });
    }
    start = null;
  };

  for (let offset = 0; offset <= length; offset += 1) {
    const value = offset === length ? -1 : counts[offset];
    if (value === current) continue;
    flush(offset);
    current = value;
    if (value >= 0) start = offset;
  }
  return ranges;
}

// Every page that loads a script captures it separately, so a full run holds
// thousands of captures of about a hundred scripts. The report sums them
// offset by offset into one record per script and converts each script once.
// Summing loses nothing the report reads: it asks only whether some page ran
// each span, and a span is zero in the sum exactly when every page skipped it.
// A script is keyed by its text as well as its URL, so captures of different
// builds served at one URL never meet.
function addCapture(scripts, scriptCoverage) {
  const length = recordedSourceLength(scriptCoverage);
  const key = JSON.stringify([
    scriptCoverage.url,
    scriptCoverage.source,
    scriptCoverage.sourceLength,
    scriptCoverage.sourceSha256,
    length,
  ]);
  const counts = countsForScript(scriptCoverage, length);
  const merged = scripts.get(key);
  if (!merged) {
    scripts.set(key, {
      capture: scriptCoverage,
      counts: Float64Array.from(counts),
    });
    return;
  }
  for (let offset = 0; offset < length; offset += 1) {
    if (counts[offset] >= 0) {
      merged.counts[offset] =
        Math.max(merged.counts[offset], 0) + counts[offset];
    }
  }
}

// The merged record in the shape convertScript reads. Sums are capped to the
// Int32 range countsForScript stores them in; only zero versus positive and
// where counts change matter downstream.
function mergedCapture({ capture, counts }) {
  const { url, source, sourceLength, sourceSha256 } = capture;
  const capped = Int32Array.from(counts, (count) =>
    Math.min(count, 2 ** 31 - 1),
  );
  return {
    url,
    source,
    sourceLength,
    sourceSha256,
    functions: [
      {
        functionName: '',
        isBlockCoverage: true,
        ranges: rangesFromCounts(capped),
      },
    ],
  };
}

function getLineCoverage(coverageData) {
  const lines = new Map();
  for (const [statementId, count] of Object.entries(coverageData.s ?? {})) {
    const line = coverageData.statementMap?.[statementId]?.start?.line;
    if (!Number.isInteger(line)) continue;
    lines.set(line, Math.max(lines.get(line) ?? 0, count));
  }
  return lines;
}

// v8-to-istanbul derives every region from a *generated* block boundary and
// maps its endpoints back through the source map. In minified output those
// endpoints land on whatever mapping precedes them, so a block that never ran
// can be reported as a multi-line original span that demonstrably did run --
// `useFocusTrap`'s Shift+Tab arm reported a zero-count region over lines
// 38-40 while statement coverage put all three lines at 1. A span
// cannot be unexecuted while every line it covers executed, so those spans are
// dropped rather than counted against the file. Single-line regions are kept:
// several of them share one line and the per-line fold cannot tell them apart,
// which is the whole reason regions are measured.
function isPhantomRegion(region, lines) {
  if (region.count > 0) return false;
  if (region.endLine <= region.line) return false;
  for (let line = region.line; line <= region.endLine; line += 1) {
    const count = lines.get(line);
    // Blank lines and comments inside the span carry no statement, so they
    // neither confirm nor contradict the region.
    if (count === undefined) continue;
    if (count <= 0) return false;
  }
  return true;
}

function comparePositions(lineA, columnA, lineB, columnB) {
  if (lineA !== lineB) return lineA < lineB ? -1 : 1;
  if (columnA !== columnB) return columnA < columnB ? -1 : 1;
  return 0;
}

// Two branch spans of one source file either nest or stay disjoint. Both are
// derived from AST node extents, so one cannot begin inside another and end
// after it -- a *crossing* pair is not a shape the language can produce. When
// the union does hold one, the two halves were mapped through source maps that
// placed the same original branch at different spans, which is exactly how
// drifted twins appear: `MemberProfile.js` contributes a zero region
// at `10:40-10:48` from one artifact and a covered `10:44-15:19` from another
// artifact of the *same* chunk, and `15:19-15:80` against `15:70-38:15`
// likewise. Both pairs cross; neither contains the other, so neither the
// multi-line fold above nor an enclosure rule reaches them.
//
// Crossing is the whole test, and it is deliberately narrower than
// containment. A covered region that *encloses* a zero one is the ordinary
// shape of a branch arm inside an executed block -- GroupLinkStatus's
// `generatedAt` guard and RadarReports' empty-corpus arms are enclosed exactly
// that way -- so enclosure is never treated as drift.
function crossesRegion(zero, covered) {
  return (
    comparePositions(covered.line, covered.column, zero.line, zero.column) >
      0 &&
    comparePositions(
      covered.line,
      covered.column,
      zero.endLine,
      zero.endColumn,
    ) < 0 &&
    comparePositions(
      covered.endLine,
      covered.endColumn,
      zero.endLine,
      zero.endColumn,
    ) > 0
  );
}

function isDriftedRegion(region, regions) {
  if (region.count > 0) return false;
  for (const other of regions) {
    if (other.count <= 0) continue;
    if (crossesRegion(region, other)) return true;
  }
  return false;
}

// The span as the registry and the text report spell it, so an entry can be
// written by copying a line out of the "Uncovered regions" section.
function regionSpan(region) {
  return `${region.line}:${region.column}-${region.endLine}:${region.endColumn}`;
}

// tests/e2e/fixtures/accepted-regions.json holds the zero-count regions ADR 0007
// classifies as needing no browser coverage: `data-shape-guard` for an arm
// selected only by absent, null, empty or malformed build-time data, and
// `span-drift` for a zero that is a source-map artifact of a span some other
// chunk or build records as executed. Each entry names its file, its span
// exactly as the report prints it, its class and a one-line reason. An
// accepted region is dropped from the numerator and the denominator alike --
// it is neither covered nor uncovered -- and is listed in its own section so
// the information stays visible without being re-filed as a finding.
//
// Entries are checked against the run that renders them, not trusted: one
// whose span the run never reports, or reports with a positive count, is
// stale, and `main()` fails the lane on it so the registry cannot rot.
function parseAcceptedRegions(raw) {
  if (!Array.isArray(raw?.entries)) {
    throw new Error(
      `${ACCEPTED_REGIONS_PATH} must be an object with an "entries" array`,
    );
  }
  const seen = new Set();
  return raw.entries.map((entry, index) => {
    const reject = (what) => {
      throw new Error(
        `${ACCEPTED_REGIONS_PATH} entry ${index} ${what} (file ${JSON.stringify(entry?.file ?? null)}, span ${JSON.stringify(entry?.span ?? null)})`,
      );
    };
    if (typeof entry?.file !== 'string' || !entry.file.startsWith('src/')) {
      reject('must name a src/ file');
    }
    if (typeof entry.span !== 'string' || !REGION_SPAN.test(entry.span)) {
      reject('must give its span as startLine:startCol-endLine:endCol');
    }
    if (!ACCEPTED_REGION_CLASSES.includes(entry.class)) {
      reject(`must have class ${ACCEPTED_REGION_CLASSES.join(' or ')}`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      reject('must give a reason');
    }
    const key = `${entry.file} ${entry.span}`;
    if (seen.has(key)) reject('is listed twice');
    seen.add(key);
    return {
      file: entry.file,
      span: entry.span,
      class: entry.class,
      reason: entry.reason,
    };
  });
}

async function loadAcceptedRegions(root) {
  const path = join(root, ACCEPTED_REGIONS_PATH);
  if (!existsSync(path)) return [];
  return parseAcceptedRegions(JSON.parse(await readFile(path, 'utf8')));
}

export { parseAcceptedRegions };

// A region is one branch location from the istanbul object convertScript
// already builds -- the arm of a ternary, a short-circuit operand, a default
// parameter -- data the line map cannot see because several of them share a
// line and the per-line fold reports the line covered when any one of them
// ran. Keyed by original-source coordinates so that the same region observed
// by two scripts (the real build and the data-variant build compile the same
// file twice) unions to one entry instead of counting twice.
function getRegionCoverage(coverageData) {
  const regions = new Map();
  for (const [branchId, counts] of Object.entries(coverageData.b ?? {})) {
    const locations = coverageData.branchMap?.[branchId]?.locations ?? [];
    for (const [index, location] of locations.entries()) {
      const line = location?.start?.line;
      if (!Number.isInteger(line)) continue;
      const endLine = location.end?.line ?? line;
      const column = location.start?.column ?? 0;
      const endColumn = location.end?.column ?? 0;
      const key = [line, column, endLine, endColumn].join(':');
      const count = counts?.[index] ?? 0;
      const existing = regions.get(key);
      if (!existing || count > existing.count) {
        regions.set(key, { line, column, endLine, endColumn, count });
      }
    }
  }
  return regions;
}

// These three readers are exported for tests only. Every guard below them is a
// defence against a malformed *istanbul* object, and istanbul objects are not
// inputs to this module -- `convertScript` builds them from the V8 payload via
// `v8-to-istanbul`. Reaching a guard from the public surface would require that
// library to emit a shape it does not emit, so no capture artifact written at
// the boundary can exercise one. Exporting the readers lets the guards
// be driven directly with hand-built istanbul objects instead of being carried
// as a permanent uncovered residual.
export {
  getLineCoverage,
  getRegionCoverage,
  isPhantomRegion,
  splitRangeAtBoundaries,
};

// Captured scripts are resolved against each root in order -- the run's own
// `scripts/` copies first, then the build directory. A script missing from one
// root falls through to the next; a script missing from all of them still
// aborts the report, because rendering on partial data would let the merge gate
// pass on a number nobody can reproduce.
async function locateScript(scriptRoots, pathname, url) {
  for (const root of scriptRoots) {
    const located = await resolveScriptInRoot(root, pathname, url);
    if (located) return located;
  }
  throw new Error(
    `coverage script not found in ${scriptRoots.join(', ')}: ${url}`,
  );
}

// `normalizeRanges` rewrites a V8 record into the coarsest partition it can:
// one range per run of equal counts, however far that run reaches. In a bundle
// that carries several `src/**` modules such a run routinely starts in one
// module and ends in another, and v8-to-istanbul cannot place it. It picks the
// original source of the range's *start* and then converts the range's end --
// a position in a different source -- into that source's coordinates, which
// lands past its last line, so `sliceRange` returns no lines and the range is
// dropped without recording a branch anywhere (v8-to-istanbul applyCoverage,
// `if (!lines.length) return`). Neither the starting module nor the module the
// run actually ended in is credited, and because `attributedPaths` is built
// from the branches that were recorded, every source of the script is then
// skipped by the multi-source guard in `collectE2ECoverage`.
//
// Splitting each range at the generated offsets where the source map changes
// source keeps every sub-range inside one original file, which is the only
// shape v8-to-istanbul can attribute. A single-source map yields no boundaries
// and no splits, so 1:1 bundles are byte-identical to before.
function sourceBoundaryOffsets(map, mappedSource) {
  const lineStarts = [0];
  for (let index = 0; index < mappedSource.length; index += 1) {
    if (mappedSource[index] === '\n') lineStarts.push(index + 1);
  }
  const boundaries = new Set();
  let previousSource = null;
  for (const [line, segments] of decodedMap(
    new AnyMap(map),
  ).mappings.entries()) {
    for (const segment of segments) {
      if (segment.length < 4) continue;
      const source = segment[1];
      if (previousSource !== null && source !== previousSource) {
        const lineStart = lineStarts[line];
        if (lineStart !== undefined) {
          const offset = Math.min(lineStart + segment[0], mappedSource.length);
          if (offset > 0) boundaries.add(offset);
        }
      }
      previousSource = source;
    }
  }
  return [...boundaries].sort((a, b) => a - b);
}

function splitRangeAtBoundaries(range, boundaries) {
  const cuts = boundaries.filter(
    (offset) => offset > range.startOffset && offset < range.endOffset,
  );
  if (cuts.length === 0) return [range];
  const parts = [];
  let start = range.startOffset;
  for (const cut of cuts) {
    // The sub-range must end *inside* the source it starts in: v8-to-istanbul
    // abandons a range whose start and end map to different originals
    // (source.js `if (start.source !== end.source) return {}`), and the first
    // offset at a boundary already belongs to the next source. Ending one
    // offset short keeps the end position on the source side of the cut; that
    // offset is not lost, because it opens the following sub-range.
    const end = cut - 1;
    if (end > start) {
      parts.push({ ...range, startOffset: start, endOffset: end });
    }
    start = cut;
  }
  // The `parts.length === 0` arm below is unreachable (see the residual note
  // at the top of this file): every cut is strictly below
  // `range.endOffset`, and `start` holds the last of them, so the tail push
  // always fires. It is kept as the statement of the invariant rather than
  // deleted, and tests/e2e-coverage-split-range.test.mjs asserts the invariant
  // directly so a future edit that breaks it fails on its own name instead of
  // silently turning this arm live.
  if (range.endOffset > start) {
    parts.push({ ...range, startOffset: start, endOffset: range.endOffset });
  }
  return parts.length === 0 ? [range] : parts;
}

async function convertScript(scriptCoverage, root, scriptRoots) {
  const pathname = scriptPathname(scriptCoverage.url);
  const located = await locateScript(scriptRoots, pathname, scriptCoverage.url);
  const resolvedScriptPath = located.path;
  const generatedSource =
    scriptCoverage.source ?? (await readFile(resolvedScriptPath, 'utf8'));
  if (
    scriptCoverage.sourceLength !== undefined &&
    scriptCoverage.sourceLength !== generatedSource.length
  ) {
    throw new Error(
      `generated source length mismatch for ${scriptCoverage.url}`,
    );
  }
  if (
    scriptCoverage.sourceSha256 &&
    scriptCoverage.sourceSha256 !== sha256(generatedSource)
  ) {
    throw new Error(`generated source hash mismatch for ${scriptCoverage.url}`);
  }

  const { mappedSource, reference } = splitSourceMapComment(generatedSource);
  const { map: rawMap, mapPath } = await loadSourceMap(
    reference,
    resolvedScriptPath,
    located.root,
  );
  const { map, sourceFiles } = await normalizeSourceMap(rawMap, mapPath, root);
  const converter = v8ToIstanbul(resolvedScriptPath, 0, {
    source: mappedSource,
    sourceMap: { sourcemap: map },
  });
  await converter.load();
  const normalizedFunctions = normalizeRanges(
    scriptCoverage,
    generatedSource.length,
  );
  const boundaries = sourceBoundaryOffsets(map, mappedSource);
  for (const fn of normalizedFunctions) {
    fn.ranges = fn.ranges
      .map((range) => ({
        ...range,
        endOffset: Math.min(range.endOffset, mappedSource.length),
      }))
      .filter((range) => range.startOffset < range.endOffset)
      .flatMap((range) => splitRangeAtBoundaries(range, boundaries));
  }
  const usableFunctions = normalizedFunctions.filter(
    (fn) => fn.ranges.length > 0,
  );
  if (usableFunctions.length === 0) {
    return { sourceFiles, coverage: converter.toIstanbul(), attributed: false };
  }
  converter.applyCoverage(usableFunctions);
  const coverage = converter.toIstanbul();
  // `converter.branches` is the whole attribution signal, and the two things
  // this does not also read are not an oversight:
  //
  //   * `converter.functions` is permanently `{}` here. v8-to-istanbul writes
  //     `this.functions[path]` only under `if (block.functionName ...)`
  //     (lib/v8-to-istanbul.js:167,178), and `normalizeRanges` above rewrites
  //     every script's record into exactly one block with `functionName: ''`.
  //     A `functions` arm would therefore contribute no path that `branches`
  //     has not already contributed.
  //   * neither needs a `?? {}` guard: both are initialised to `{}` in the
  //     converter's constructor (lib/v8-to-istanbul.js:36-37) and are never
  //     reassigned.
  //
  // tests/e2e-coverage-attribution.test.mjs pins both facts against the
  // installed converter, so a release that started naming blocks or stopped
  // initialising the maps fails there rather than silently dropping a source
  // from a multi-source bundle.
  const attributedPaths = new Set(
    Object.entries(converter.branches)
      .filter(([, ranges]) => ranges.length > 0)
      .map(([path]) => path),
  );
  return {
    sourceFiles,
    coverage,
    attributed: true,
    attributedPaths,
  };
}

// Producer identity belongs to the sealed artifacts, not the process that
// happens to render them later.
function reportProvenance(run) {
  return {
    reporterRuntime: { node: process.version, v8: process.versions.v8 },
    buildRuntimes: run?.buildRuntimes ?? null,
    captureRuntimes: run?.captureRuntimes ?? null,
  };
}

function emptyReport(run, status = 'ok') {
  return {
    schemaVersion: 2,
    kind: REPORT_KIND,
    status,
    runId: run.runId,
    runStatus: run.status,
    // Provenance for the coordinates below: see resolveRevision() in
    // tests/tools/e2e-coverage-run.mjs. Null when the run could not name its
    // commit, never absent, so a consumer always has the key to check.
    revision: run.revision ?? null,
    ...reportProvenance(run),
    scripts: { captured: 0, converted: 0, ignored: 0 },
    sources: [],
    summary: {
      executableLines: 0,
      coveredLines: 0,
      linePercent: 100,
      regions: 0,
      coveredRegions: 0,
      regionPercent: 100,
    },
    unmappedSources: [],
    missingSourceFiles: [],
    acceptedRegions: [],
    staleAcceptedRegions: [],
    diagnostics: { warnings: run.provenanceWarnings ?? [], errors: [] },
  };
}

export async function collectE2ECoverage(
  runDir,
  { root = repoRoot, buildDir = join(root, 'build') } = {},
) {
  const run = await readCoverageRun(runDir);
  if (run.status === 'started') {
    throw new CoverageReportError(`coverage run is not sealed: ${runDir}`, {
      runId: run.runId,
      runStatus: run.status,
    });
  }
  if (run.status !== 'passed') {
    throw new CoverageReportError(
      `coverage run ${run.runId} is sealed as ${run.status}`,
      { runId: run.runId, runStatus: run.status },
    );
  }
  const entries = await readdir(runDir);
  if (entries.some((entry) => entry.endsWith('.tmp'))) {
    throw new Error(`coverage run contains incomplete temporary artifacts`);
  }

  // The run's own copies win over build/ so a published artifact renders the
  // same way wherever it is unpacked, including where no build exists at all.
  const scriptRoots = [join(runDir, COVERAGE_SCRIPTS_DIR), buildDir];

  const report = emptyReport(run);
  const acceptedRegions = await loadAcceptedRegions(root);
  const sources = new Map();
  const unmapped = new Set();
  const scripts = new Map();
  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry === 'manifest.json') continue;
    const payload = JSON.parse(await readFile(join(runDir, entry), 'utf8'));
    if (payload.kind === 'endusers.playwright.v8-coverage-error') {
      throw new CoverageReportError(
        `coverage capture failed for ${payload.testId ?? '<unknown test>'} page ${payload.pageIndex ?? '<unknown>'}: ${payload.error?.message ?? 'unknown error'}`,
        { runId: run.runId, runStatus: run.status },
      );
    }
    if (payload.kind !== COVERAGE_ARTIFACT_KIND) {
      throw new Error(`unexpected coverage artifact kind in ${entry}`);
    }
    if (payload.runId !== run.runId) {
      throw new Error(`coverage artifact ${entry} belongs to another run`);
    }
    report.scripts.captured += payload.result?.length ?? 0;

    for (const scriptCoverage of payload.result ?? []) {
      if (!isEligibleScript(scriptCoverage.url)) {
        report.scripts.ignored += 1;
        continue;
      }
      addCapture(scripts, scriptCoverage);
    }
  }

  for (const scriptCoverage of Array.from(scripts.values(), mergedCapture)) {
    const converted = await convertScript(scriptCoverage, root, scriptRoots);
    report.scripts.converted += 1;
    if (!converted.attributed) continue;
    for (const sourceFile of converted.sourceFiles) {
      unmapped.add(sourceFile.relative);
    }
    // `convertScript` has two returns and both set `coverage` to
    // `converter.toIstanbul()`, which v8-to-istanbul builds from its own
    // `covBranch`/`covLine` maps and returns as an object whether or not
    // `applyCoverage` ran. The `?? {}` this used to carry was therefore
    // dead, for the same reason the `?? {}` guards on `converter.branches`
    // and `converter.functions` were (see `convertScript` above).
    // tests/e2e-coverage-nullish-guards.test.mjs pins it.
    for (const [path, coverageData] of Object.entries(converted.coverage)) {
      const relativePath = repoRelative(root, path);
      if (!relativePath?.startsWith('src/')) continue;
      if (
        converted.sourceFiles.length > 1 &&
        !converted.attributedPaths.has(path)
      ) {
        continue;
      }
      const lineCoverage = getLineCoverage(coverageData);
      // An entry carrying no located statement at all. Nothing the installed
      // converter emits is that shape -- it carries a statement for every
      // line of every source it holds, including a source whose text is
      // empty -- so this arm never runs, and
      // tests/e2e-coverage-statement-map.test.mjs pins that premise against
      // the library rather than leaving it to be rediscovered.
      //
      // It is kept rather than deleted because the arm is not a formatting
      // nicety like the error-text fallbacks below: a row built from such an
      // entry would have an empty denominator, which `percent` scores as
      // fully covered, and would take the module out of
      // `missingSourceFiles` -- the file-set guarantee is computed from the
      // modules this loop admitted. A converter release that started
      // emitting statement-less entries would otherwise turn every module it
      // touched from "never measured" into "100% covered", which is the one
      // outcome the file-set gate exists to make impossible.
      if (lineCoverage.size === 0) continue;
      const regionCoverage = getRegionCoverage(coverageData);
      const target = sources.get(relativePath) ?? {
        lines: new Map(),
        regions: new Map(),
      };
      for (const [line, count] of lineCoverage) {
        target.lines.set(line, Math.max(target.lines.get(line) ?? 0, count));
      }
      // Regions union across scripts by *key*: the same
      // original span observed by the real build and a fixture build folds
      // to one entry at the higher count. That credits an arm only when
      // some build records a covered region at the arm's own span. A guard
      // arm a sibling build takes does not produce one: the build that
      // skips the arm records a zero at the arm's span, while the build
      // that takes it records its deviation at the *alternative* it
      // skipped -- a different span, hence a different key -- and nothing
      // at the arm itself. The zero therefore survives the union.
      // Lines do union across builds; regions of this shape do not. See the
      // ceiling recorded in tests/e2e-coverage-gate.test.mjs.
      for (const [key, region] of regionCoverage) {
        const existing = target.regions.get(key);
        if (!existing || region.count > existing.count) {
          target.regions.set(key, region);
        }
      }
      sources.set(relativePath, target);
      unmapped.delete(relativePath);
    }
  }

  // Registry entries are matched by file and span against the regions that
  // survive the folds above. An entry is consumed by the zero it accepts;
  // one that meets a positive count was reached by this run and one that
  // meets no region at all names a span the build no longer reports. Both are
  // stale, and `main()` fails on them so the registry tracks the lane.
  const pendingAccepted = new Map(
    acceptedRegions.map((entry) => [`${entry.file} ${entry.span}`, entry]),
  );
  const stale = [];
  report.sources = [...sources.entries()]
    .map(([file, coverage]) => {
      const uncoveredLines = [...coverage.lines]
        .filter(([, count]) => count <= 0)
        .map(([line]) => line)
        .sort((a, b) => a - b);
      const executableLines = coverage.lines.size;
      const coveredLines = [...coverage.lines.values()].filter(
        (count) => count > 0,
      ).length;
      const allRegions = [...coverage.regions.values()];
      const regionValues = allRegions
        .filter(
          (region) =>
            !isPhantomRegion(region, coverage.lines) &&
            !isDriftedRegion(region, allRegions),
        )
        .filter((region) => {
          const key = `${file} ${regionSpan(region)}`;
          const entry = pendingAccepted.get(key);
          if (!entry) return true;
          pendingAccepted.delete(key);
          if (region.count > 0) {
            stale.push({
              ...entry,
              cause: `covered by this run (count ${region.count})`,
            });
            return true;
          }
          report.acceptedRegions.push(entry);
          return false;
        });
      const regions = regionValues.length;
      const coveredRegions = regionValues.filter(
        (region) => region.count > 0,
      ).length;
      // One entry per uncovered region, not per distinct line: V8 routinely
      // splits a single line into several ranges, so a line can hold more
      // than one zero. Deduplicating by line dropped those extras from the
      // list while `regions - coveredRegions` still counted them, which left
      // the report internally inconsistent -- at main eff33b5 the summary
      // reported 18 uncovered regions across src/** while the per-file lists
      // named 17 lines, because GroupLinkStatus/index.js is 15/18 yet listed
      // only two distinct lines. A reader working the list could not see the
      // third zero at all, and the e2e gate's own prose had to annotate it
      // with the plural drift-warning ternaries' multiplicity by hand. Repeating the line keeps
      // `uncoveredRegions.length` equal to `regions - coveredRegions`, which
      // is the invariant anyone reading the two numbers together assumes.
      const uncoveredRegionValues = regionValues
        .filter((region) => region.count <= 0)
        .sort((a, b) =>
          a.line === b.line ? a.column - b.column : a.line - b.line,
        );
      const uncoveredRegions = uncoveredRegionValues.map(
        (region) => region.line,
      );
      return {
        file,
        executableLines,
        coveredLines,
        linePercent: linePercent(coveredLines, executableLines),
        uncoveredLines,
        regions,
        coveredRegions,
        regionPercent: linePercent(coveredRegions, regions),
        uncoveredRegions,
        // The spans behind `uncoveredRegions`, spelled the way an
        // accepted-regions entry is written.
        uncoveredRegionSpans: uncoveredRegionValues.map(regionSpan),
      };
    })
    .filter((row) => row.executableLines > 0)
    .sort((a, b) => a.file.localeCompare(b.file));
  for (const entry of pendingAccepted.values()) {
    stale.push({ ...entry, cause: 'not a region this run reports' });
  }
  // Spans order by position, not text, so `21:7` lists before `21:24`.
  const spanStart = (span) => span.split('-', 1)[0].split(':').map(Number);
  const byFileAndSpan = (a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    const [lineA, columnA] = spanStart(a.span);
    const [lineB, columnB] = spanStart(b.span);
    return lineA === lineB ? columnA - columnB : lineA - lineB;
  };
  report.acceptedRegions.sort(byFileAndSpan);
  report.staleAcceptedRegions = stale.sort(byFileAndSpan);
  report.unmappedSources = [...unmapped].sort();
  // The summary below is a ratio over the files the run *observed*. A src
  // module the bundle dropped (or that attribution lost) contributes neither
  // numerator nor denominator, so the percentage cannot see it. The
  // file-set comparison is the second, different guarantee: every module on
  // disk under src/ must have been measured. Enumerated with the unit
  // reporter's walker so the two gates share one definition of "a source
  // file"; restricted to src/ because that is the only tree this reporter
  // admits coverage for.
  report.missingSourceFiles = enumerateSourceFiles(root)
    .filter((file) => file.startsWith('src/') && !sources.has(file))
    .sort();
  report.summary = report.sources.reduce(
    (summary, row) => ({
      executableLines: summary.executableLines + row.executableLines,
      coveredLines: summary.coveredLines + row.coveredLines,
      linePercent: 0,
      regions: summary.regions + row.regions,
      coveredRegions: summary.coveredRegions + row.coveredRegions,
      regionPercent: 0,
    }),
    {
      executableLines: 0,
      coveredLines: 0,
      linePercent: 0,
      regions: 0,
      coveredRegions: 0,
      regionPercent: 0,
    },
  );
  report.summary.linePercent = linePercent(
    report.summary.coveredLines,
    report.summary.executableLines,
  );
  report.summary.regionPercent = linePercent(
    report.summary.coveredRegions,
    report.summary.regions,
  );
  if (report.summary.executableLines === 0) {
    throw new Error('No src/** coverage was attributable');
  }
  return report;
}

function nodeRuntime(runtime) {
  return `node ${runtime?.node ?? 'unknown'} (v8 ${runtime?.v8 ?? 'unknown'})`;
}

export function renderE2ECoverageReport(report) {
  const lines = [
    `E2E coverage: ${report.status} (run ${report.runId}; status ${report.runStatus ?? 'unknown'})`,
    // On its own line rather than appended to the header above: the header is
    // matched anchored by tests/e2e-coverage-report.test.mjs, and a reader
    // scanning the artifact for which commit these line numbers address should
    // not have to parse a parenthetical to find it.
    `Revision: ${report.revision ?? 'unknown'}`,
    `Build runtimes: ${report.buildRuntimes?.map(({ build, runtime }) => `${build}: ${nodeRuntime(runtime)}`).join('; ') || 'unknown'}`,
    `Capture runtimes: ${report.captureRuntimes?.map((runtime) => `${nodeRuntime(runtime)}, Playwright ${runtime?.playwright ?? 'unknown'}, browser ${runtime?.browser ?? 'unknown'} (v8 ${runtime?.browserV8 ?? 'unknown'})`).join('; ') || 'unknown'}`,
    `Reporter runtime: ${nodeRuntime(report.reporterRuntime)}`,
    '',
    // The region column is what makes a --check-source-regions failure
    // diagnosable from the text artifact alone, mirroring the unit reporter.
    'file | line % | region % | uncovered lines | uncovered regions',
    '--- | ---: | ---: | --- | ---',
  ];
  for (const row of report.sources) {
    lines.push(
      `${row.file} | ${row.linePercent.toFixed(2)} | ${row.regionPercent.toFixed(2)} | ${row.uncoveredLines.join(' ')} | ${row.uncoveredRegions.join(' ')}`,
    );
  }
  lines.push(
    `src files | ${report.summary.linePercent.toFixed(2)} | ${report.summary.regionPercent.toFixed(2)} | ${report.summary.coveredLines}/${report.summary.executableLines} lines | ${report.summary.coveredRegions}/${report.summary.regions} regions`,
  );
  if (report.unmappedSources.length > 0) {
    lines.push(
      '',
      'Unmapped sources:',
      ...report.unmappedSources.map((file) => `- ${file}`),
    );
  }
  if (report.missingSourceFiles.length > 0) {
    lines.push(
      '',
      'Source files never measured by this run:',
      ...report.missingSourceFiles.map((file) => `- ${file}`),
    );
  }
  // Spans, not lines: the table's region column folds to lines, and an
  // accepted-regions entry has to quote the span exactly.
  const uncoveredSpans = report.sources.flatMap((row) =>
    (row.uncoveredRegionSpans ?? []).map((span) => `- ${row.file} ${span}`),
  );
  if (uncoveredSpans.length > 0) {
    lines.push('', 'Uncovered regions:', ...uncoveredSpans);
  }
  const accepted = report.acceptedRegions ?? [];
  if (accepted.length > 0) {
    lines.push(
      '',
      `Accepted regions (ADR 0007, ${ACCEPTED_REGIONS_PATH}; counted as neither covered nor uncovered):`,
      ...accepted.map(
        (entry) =>
          `- ${entry.file} ${entry.span} [${entry.class}] ${entry.reason}`,
      ),
    );
  }
  const stale = report.staleAcceptedRegions ?? [];
  if (stale.length > 0) {
    lines.push(
      '',
      `Stale accepted regions (remove from ${ACCEPTED_REGIONS_PATH}):`,
      ...stale.map(
        (entry) =>
          `- ${entry.file} ${entry.span} [${entry.class}] ${entry.cause}`,
      ),
    );
  }
  if (report.diagnostics.errors.length > 0) {
    lines.push(
      '',
      'Errors:',
      ...report.diagnostics.errors.map((error) => `- ${error}`),
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function writeE2ECoverageReport(report, { jsonPath, textPath }) {
  const text = renderE2ECoverageReport(report);
  if (jsonPath)
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  if (textPath) await writeFile(textPath, text);
  return text;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let report;
  try {
    report = await collectE2ECoverage(options.input, {
      root: resolve(options.root),
      buildDir: resolve(options.build),
    });
    const text = await writeE2ECoverageReport(report, {
      jsonPath: options.json,
      textPath: options.text,
    });
    if (!options.text) process.stdout.write(text);
  } catch (error) {
    // Only the run-status guards raise CoverageReportError; every later failure
    // is a plain Error, so re-read the manifest rather than publish a report
    // that cannot say whether the run passed or the tooling broke.
    const run = await readCoverageRun(resolve(options.input)).catch(() => null);
    const failure = {
      schemaVersion: 2,
      kind: ERROR_KIND,
      status:
        error.runStatus === 'failed' || error.runStatus === 'cancelled'
          ? error.runStatus
          : 'tooling-error',
      runId: error.runId ?? run?.runId ?? null,
      runStatus: error.runStatus ?? run?.status ?? null,
      revision: run?.revision ?? null,
      ...reportProvenance(run),
      scripts: { captured: 0, converted: 0, ignored: 0 },
      sources: [],
      summary: {
        executableLines: 0,
        coveredLines: 0,
        linePercent: 0,
        regions: 0,
        coveredRegions: 0,
        regionPercent: 0,
      },
      unmappedSources: [],
      missingSourceFiles: [],
      acceptedRegions: [],
      staleAcceptedRegions: [],
      // `?? String(error)` is unreachable today: everything the `try` above
      // can raise is an Error, whose `message` is a string even when empty.
      // Kept rather than deleted because the artifact is the only record a CI
      // reader gets of why the gate failed, and publishing `null` there would
      // be worse than publishing the coerced text.
      // tests/e2e-coverage-error-arms.test.mjs pins the premise.
      diagnostics: {
        warnings: run?.provenanceWarnings ?? [],
        errors: [error.message ?? String(error)],
      },
    };
    await writeE2ECoverageReport(failure, {
      jsonPath: options.json,
      textPath: options.text,
    });
    throw error;
  }

  // Evaluated after the report is on disk: a threshold failure must still leave
  // the summary and artifact behind for the CI step that publishes them.
  //
  // A stale registry entry fails the lane whether or not any floor is being
  // checked: an entry that no longer names a zero this run reports is either
  // a region the suite now reaches or a span the build no longer emits, and
  // in both cases the fix is to delete it, not to keep rendering around it.
  if (report.staleAcceptedRegions.length > 0) {
    throw new Error(
      `${report.staleAcceptedRegions.length} accepted region(s) in ${ACCEPTED_REGIONS_PATH} are stale; remove them:\n` +
        report.staleAcceptedRegions
          .map((entry) => `  ${entry.file} ${entry.span}: ${entry.cause}`)
          .join('\n'),
    );
  }
  const { linePercent: sourcePercent, regionPercent: sourceRegionPercent } =
    report.summary;
  if (
    options.checkSource !== null &&
    sourcePercent + 1e-9 < options.checkSource
  ) {
    throw new Error(
      `Source line coverage ${sourcePercent.toFixed(2)}% is below the required ${options.checkSource}%.`,
    );
  }
  if (
    options.checkSourceRegions !== null &&
    sourceRegionPercent + 1e-9 < options.checkSourceRegions
  ) {
    throw new Error(
      `Source region coverage ${sourceRegionPercent.toFixed(2)}% is below the required ${options.checkSourceRegions}%.`,
    );
  }
  // --check-source-regions is an aggregate, and an aggregate hides where its
  // own slack is spent: the gate is cleared by the whole of src/ together, so
  // the regions one file loses are paid for by every other file that still has
  // them. At the 95% the CI job asks for, a single small component may sit at
  // nothing and the job stays green. The companion line gate does not catch
  // that either, because a lost *region* need not be a lost *line* -- an
  // unexecuted ternary arm or `??` fallback sits on a line the surrounding
  // statement still covers. This applies the floor to each source file on its
  // own, so a regression concentrated in one file fails on that file's name
  // instead of being averaged away. tests/tools/coverage-report.mjs already
  // gates the unit run this way; this is the same guarantee for the browser
  // run.
  if (options.checkSourceFileRegions !== null) {
    // No vacuous-pass guard is needed here, unlike the unit reporter's
    // equivalent: collectE2ECoverage above already refuses a run that
    // attributed nothing to src/**, so this list can never be empty for the
    // reason that guard exists to catch.
    const below = report.sources.filter(
      (row) =>
        row.regions > 0 &&
        row.regionPercent + 1e-9 < options.checkSourceFileRegions,
    );
    if (below.length > 0) {
      throw new Error(
        `${below.length} source file(s) fall below the required ` +
          `${options.checkSourceFileRegions}% region coverage per file:\n` +
          below
            .map(
              (row) =>
                `  ${row.file} ${row.regionPercent.toFixed(2)}% ` +
                `(${row.coveredRegions}/${row.regions} regions; uncovered at ${row.uncoveredRegions.join(' ')})`,
            )
            .join('\n'),
      );
    }
  }
  if (options.requireSourceFiles && report.missingSourceFiles.length > 0) {
    throw new Error(
      '--require-source-files was requested, but the run never measured:\n' +
        report.missingSourceFiles.map((file) => `  ${file}`).join('\n'),
    );
  }
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    // `?? error` shares its premise with the `?? String(error)` fallback in
    // main()'s catch: a thrown Error always carries a stack, so the bare
    // value is printed only for a non-Error, which nothing here can throw.
    // tests/e2e-coverage-error-arms.test.mjs pins it.
    console.error(error.stack ?? error);
    process.exitCode = 1;
  });
}
