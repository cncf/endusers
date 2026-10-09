#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import v8ToIstanbul from 'v8-to-istanbul';
import { AnyMap, decodedMap, encodedMap } from '@jridgewell/trace-mapping';

import { countsForScript, enumerateSourceFiles } from './coverage-report.mjs';
import {
  COVERAGE_ARTIFACT_KIND,
  readCoverageRun,
} from './e2e-coverage-run.mjs';
import {
  COVERAGE_SCRIPTS_DIR,
  isEligibleScript,
  resolveScriptInRoot,
  scriptPathname,
  totalDecodeURIComponent,
} from './e2e-coverage-scripts.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const REPORT_KIND = 'endusers.e2e.coverage-report';
const ERROR_KIND = 'endusers.e2e.coverage-report-error';
const SOURCE_MAPPING_URL = /(?:\/\/[#@]\s*sourceMappingURL=)(\S+)/u;
const ORIGINAL_SCRIPT = /\.(?:c|m)?(?:js|jsx|ts|tsx)$/u;

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

function percent(covered, total) {
  return total === 0 ? 100 : (covered / total) * 100;
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
    else if (arg === '--require-source-files')
      options.requireSourceFiles = true;
    else throw new Error(`unknown e2e coverage report option: ${arg}`);
  }
  if (!options.input) throw new Error('--input is required');
  return options;
}

function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep));
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
  // as already-decoded text rather than aborting the whole report (#1150);
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
      // the undecoded text is then the JSON itself (#1150).
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
  const references = map.resolvedSources ?? flattened.sources ?? [];
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

function normalizeRanges(scriptCoverage, length) {
  const recordedLength = Math.max(
    0,
    ...(scriptCoverage.functions ?? []).flatMap((fn) =>
      (fn.ranges ?? []).map((range) => range.endOffset),
    ),
  );
  if (recordedLength > length) {
    throw new Error(
      `coverage offsets exceed generated source length (${recordedLength} > ${length})`,
    );
  }

  const counts = countsForScript(scriptCoverage, length);
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
// 38-40 while statement coverage put all three lines at 1 (#1035). A span
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
// #1079's drifted twins appear: `MemberProfile.js` contributes a zero region
// at `10:40-10:48` from one artifact and a covered `10:44-15:19` from another
// artifact of the *same* chunk, and `15:19-15:80` against `15:70-38:15`
// likewise. Both pairs cross; neither contains the other, so neither #1051's
// multi-line fold nor an enclosure rule reaches them.
//
// Crossing is the whole test, and it is deliberately narrower than
// containment. A covered region that *encloses* a zero one is the ordinary
// shape of a branch arm inside an executed block -- GroupLinkStatus's
// `checkedAt` guard and RadarReports' empty-corpus arms are enclosed exactly
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

// The crossing fold above needs the drifted twin to be *recorded*. One shape
// leaves no twin at all (#1202): when an artifact executes a span at the same
// count as its enclosing code, V8 emits no deviation range over it, so the
// artifact carries no region -- covered or zero -- for the span.
// `useFocusTrap`'s cleanup runs once with the trigger unmounted and the
// `previousFocus` arm executes uniformly with the arrow around it; that
// artifact records lines 49-51 covered and no range in the cleanup at all,
// while every truthy-path artifact of the same chunk records `51:25-51:41`
// at zero. The zero survives the union because no covered region ever shares
// (or crosses) its key.
//
// Absence only proves execution inside one script: V8 emits a zero range
// wherever text inside executed code did not run, and one script has one
// source map, so the same unexecuted text always lands on the same original
// span. If some artifact of a script records a zero region and another
// artifact of the *same script* covers the region's lines while recording no
// zero on any of them, the second artifact executed that text -- had it been
// skipped there too, the identical zero mapping would reappear. Across
// scripts the inference fails: a different bundle maps the same skipped arm
// to a different original span (#1066's drift), so a chunk that never
// records the zero at these coordinates says nothing about them. The witness
// is therefore required to come from a script that produced the zero itself.
// The exclusion test is by line rather than exact span, the conservative
// direction: a zero whose flattened range grew past the arm (adjacent
// unexecuted text merges into one range) still disqualifies the witness.
function zeroTouchesLines(zero, region) {
  return zero.line <= region.endLine && zero.endLine >= region.line;
}

function regionKey(region) {
  return [region.line, region.column, region.endLine, region.endColumn].join(
    ':',
  );
}

function isContradictedRegion(region, witnesses) {
  if (region.count > 0) return false;
  const key = regionKey(region);
  const scripts = new Set();
  for (const witness of witnesses) {
    if (witness.zeroKeys.has(key)) scripts.add(witness.script);
  }
  if (scripts.size === 0) return false;
  for (const witness of witnesses) {
    if (!scripts.has(witness.script)) continue;
    let sawExecutableLine = false;
    let linesCovered = true;
    for (let line = region.line; line <= region.endLine; line += 1) {
      const count = witness.lines.get(line);
      // Blank lines and comments carry no statement; they neither confirm
      // nor contradict, exactly as in isPhantomRegion.
      if (count === undefined) continue;
      sawExecutableLine = true;
      if (count <= 0) {
        linesCovered = false;
        break;
      }
    }
    if (!sawExecutableLine || !linesCovered) continue;
    if (witness.zeros.some((zero) => zeroTouchesLines(zero, region))) continue;
    return true;
  }
  return false;
}

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
  const attributedPaths = new Set([
    ...Object.entries(converter.branches ?? {})
      .filter(([, ranges]) => ranges.length > 0)
      .map(([path]) => path),
    ...Object.entries(converter.functions ?? {})
      .filter(([, ranges]) => ranges.length > 0)
      .map(([path]) => path),
  ]);
  return {
    sourceFiles,
    coverage,
    attributed: true,
    attributedPaths,
  };
}

function emptyReport(run, status = 'ok') {
  return {
    schemaVersion: 2,
    kind: REPORT_KIND,
    status,
    runId: run.runId,
    runStatus: run.status,
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
    diagnostics: { warnings: [], errors: [] },
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
  const sources = new Map();
  const unmapped = new Set();
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
      const converted = await convertScript(scriptCoverage, root, scriptRoots);
      report.scripts.converted += 1;
      if (!converted.attributed) continue;
      for (const sourceFile of converted.sourceFiles) {
        unmapped.add(sourceFile.relative);
      }
      for (const [path, coverageData] of Object.entries(
        converted.coverage ?? {},
      )) {
        const relativePath = repoRelative(root, path);
        if (!relativePath?.startsWith('src/')) continue;
        if (
          converted.sourceFiles.length > 1 &&
          !converted.attributedPaths.has(path)
        ) {
          continue;
        }
        const lineCoverage = getLineCoverage(coverageData);
        if (lineCoverage.size === 0) continue;
        const regionCoverage = getRegionCoverage(coverageData);
        const target = sources.get(relativePath) ?? {
          lines: new Map(),
          regions: new Map(),
          witnesses: [],
        };
        for (const [line, count] of lineCoverage) {
          target.lines.set(line, Math.max(target.lines.get(line) ?? 0, count));
        }
        // Regions union across scripts and artifacts exactly as lines do: the
        // real build and the data-variant build each exercise one arm of a
        // branch, and only the union sees both arms covered.
        for (const [key, region] of regionCoverage) {
          const existing = target.regions.get(key);
          if (!existing || region.count > existing.count) {
            target.regions.set(key, region);
          }
        }
        // Each conversion is one artifact's view of one script: a complete
        // partition of that text into executed and zero spans. Kept whole,
        // with the script's identity, so isContradictedRegion can ask whether
        // an artifact of the same script executed a region's lines without
        // recording any zero on them.
        const zeros = [...regionCoverage.values()].filter(
          (region) => region.count <= 0,
        );
        target.witnesses.push({
          script: scriptCoverage.url,
          lines: lineCoverage,
          zeros,
          zeroKeys: new Set(zeros.map(regionKey)),
        });
        sources.set(relativePath, target);
        unmapped.delete(relativePath);
      }
    }
  }

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
      const regionValues = allRegions.filter(
        (region) =>
          !isPhantomRegion(region, coverage.lines) &&
          !isDriftedRegion(region, allRegions) &&
          !isContradictedRegion(region, coverage.witnesses),
      );
      const regions = regionValues.length;
      const coveredRegions = regionValues.filter(
        (region) => region.count > 0,
      ).length;
      const uncoveredRegions = [
        ...new Set(
          regionValues
            .filter((region) => region.count <= 0)
            .map((region) => region.line),
        ),
      ].sort((a, b) => a - b);
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
      };
    })
    .filter((row) => row.executableLines > 0)
    .sort((a, b) => a.file.localeCompare(b.file));
  report.unmappedSources = [...unmapped].sort();
  // The summary below is a ratio over the files the run *observed*. A src
  // module the bundle dropped (or that attribution lost) contributes neither
  // numerator nor denominator, so the percentage cannot see it (#992). The
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

export function renderE2ECoverageReport(report) {
  const lines = [
    `E2E coverage: ${report.status} (run ${report.runId}; status ${report.runStatus ?? 'unknown'})`,
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
      diagnostics: { warnings: [], errors: [error.message ?? String(error)] },
    };
    await writeE2ECoverageReport(failure, {
      jsonPath: options.json,
      textPath: options.text,
    });
    throw error;
  }

  // Evaluated after the report is on disk: a threshold failure must still leave
  // the summary and artifact behind for the CI step that publishes them.
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
    console.error(error.stack ?? error);
    process.exitCode = 1;
  });
}
