#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import v8ToIstanbul from 'v8-to-istanbul';
import { AnyMap, encodedMap } from '@jridgewell/trace-mapping';

import { countsForScript } from './coverage-report.mjs';
import {
  COVERAGE_ARTIFACT_KIND,
  readCoverageRun,
} from './e2e-coverage-run.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const REPORT_KIND = 'endusers.e2e.coverage-report';
const ERROR_KIND = 'endusers.e2e.coverage-report-error';
const SOURCE_MAPPING_URL = /(?:\/\/[#@]\s*sourceMappingURL=)(\S+)/u;
const ELIGIBLE_SCRIPT = /(?:\.m?js$|\/assets\/js\/)/u;
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

function parseArgs(argv) {
  const options = {
    input: null,
    build: 'build',
    root: repoRoot,
    json: null,
    text: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index];
    else if (arg === '--build') options.build = argv[++index];
    else if (arg === '--root') options.root = argv[++index];
    else if (arg === '--json') options.json = argv[++index];
    else if (arg === '--text') options.text = argv[++index];
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

  value = decodeURIComponent(value).replaceAll('\\', '/');
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
    : decodeURIComponent(match[2]);
  return JSON.parse(raw);
}

async function loadSourceMap(generatedSource, scriptPath, buildDir) {
  const match = SOURCE_MAPPING_URL.exec(generatedSource);
  if (!match) {
    throw new Error(`generated script has no sourceMappingURL: ${scriptPath}`);
  }
  const reference = match[1];
  const inline = decodeDataUrl(reference);
  if (inline) return { map: inline, mapPath: scriptPath };

  const mapPath = resolve(dirname(scriptPath), reference);
  const buildRoot = await realpath(buildDir);
  const resolvedMapPath = await realpath(mapPath);
  if (!isInside(buildRoot, resolvedMapPath)) {
    throw new Error(`source map escapes build directory: ${reference}`);
  }
  const raw = await readFile(resolvedMapPath, 'utf8');
  return { map: JSON.parse(raw), mapPath: resolvedMapPath };
}

function stripSourceMapComment(source) {
  const match = SOURCE_MAPPING_URL.exec(source);
  if (!match)
    throw new Error('generated source has no sourceMappingURL comment');
  return source.slice(0, match.index).replace(/\r?\n$/u, '');
}

async function normalizeSourceMap(rawMap, mapPath, root) {
  const map = new AnyMap(rawMap, pathToFileURL(mapPath).href);
  const flattened = encodedMap(map);
  const references = map.resolvedSources ?? flattened.sources ?? [];
  const sourcesContent = [];
  const normalizedSources = [];
  const sourceFiles = [];
  const rootPath = await realpath(root);

  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    const sourceFile = sourcePathFromReference(reference, mapPath, root);
    const suppliedContent = map.sourcesContent?.[index] ?? null;
    if (!sourceFile) {
      normalizedSources.push(`e2e-external-source-${index}.js`);
      sourcesContent.push(suppliedContent ?? '');
      continue;
    }
    if (!ORIGINAL_SCRIPT.test(sourceFile.relative)) {
      normalizedSources.push(`e2e-external-source-${index}.js`);
      sourcesContent.push('');
      continue;
    }

    const resolvedSource = await realpath(sourceFile.absolute);
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

async function convertScript(scriptCoverage, root, buildDir) {
  const parsed = new URL(scriptCoverage.url);
  const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  const scriptPath = resolve(buildDir, pathname);
  const buildRoot = await realpath(buildDir);
  const resolvedScriptPath = await realpath(scriptPath);
  if (!isInside(buildRoot, resolvedScriptPath)) {
    throw new Error(
      `coverage script escapes build directory: ${scriptCoverage.url}`,
    );
  }
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

  const mappedSource = stripSourceMapComment(generatedSource);
  const { map: rawMap, mapPath } = await loadSourceMap(
    generatedSource,
    resolvedScriptPath,
    buildRoot,
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
  for (const fn of normalizedFunctions) {
    fn.ranges = fn.ranges
      .map((range) => ({
        ...range,
        endOffset: Math.min(range.endOffset, mappedSource.length),
      }))
      .filter((range) => range.startOffset < range.endOffset);
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

function isEligibleScript(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      ELIGIBLE_SCRIPT.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function emptyReport(run, status = 'ok') {
  return {
    schemaVersion: 1,
    kind: REPORT_KIND,
    status,
    runId: run.runId,
    runStatus: run.status,
    scripts: { captured: 0, converted: 0, ignored: 0 },
    sources: [],
    summary: { executableLines: 0, coveredLines: 0, linePercent: 100 },
    unmappedSources: [],
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
      const converted = await convertScript(scriptCoverage, root, buildDir);
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
        const target = sources.get(relativePath) ?? {
          lines: new Map(),
        };
        for (const [line, count] of lineCoverage) {
          target.lines.set(line, Math.max(target.lines.get(line) ?? 0, count));
        }
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
      return {
        file,
        executableLines,
        coveredLines,
        linePercent: linePercent(coveredLines, executableLines),
        uncoveredLines,
      };
    })
    .filter((row) => row.executableLines > 0)
    .sort((a, b) => a.file.localeCompare(b.file));
  report.unmappedSources = [...unmapped].sort();
  report.summary = report.sources.reduce(
    (summary, row) => ({
      executableLines: summary.executableLines + row.executableLines,
      coveredLines: summary.coveredLines + row.coveredLines,
      linePercent: 0,
    }),
    {
      executableLines: 0,
      coveredLines: 0,
      linePercent: 0,
    },
  );
  report.summary.linePercent = linePercent(
    report.summary.coveredLines,
    report.summary.executableLines,
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
    'file | line % | uncovered lines',
    '--- | ---: | ---',
  ];
  for (const row of report.sources) {
    lines.push(
      `${row.file} | ${row.linePercent.toFixed(2)} | ${row.uncoveredLines.join(' ')}`,
    );
  }
  lines.push(
    `src files | ${report.summary.linePercent.toFixed(2)} | ${report.summary.coveredLines}/${report.summary.executableLines} lines`,
  );
  if (report.unmappedSources.length > 0) {
    lines.push(
      '',
      'Unmapped sources:',
      ...report.unmappedSources.map((file) => `- ${file}`),
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
  try {
    const report = await collectE2ECoverage(options.input, {
      root: resolve(options.root),
      buildDir: resolve(options.build),
    });
    const text = await writeE2ECoverageReport(report, {
      jsonPath: options.json,
      textPath: options.text,
    });
    if (!options.text) process.stdout.write(text);
    return report;
  } catch (error) {
    const failure = {
      schemaVersion: 1,
      kind: ERROR_KIND,
      status:
        error.runStatus === 'failed' || error.runStatus === 'cancelled'
          ? error.runStatus
          : 'tooling-error',
      runId: error.runId ?? null,
      runStatus: error.runStatus ?? null,
      scripts: { captured: 0, converted: 0, ignored: 0 },
      sources: [],
      summary: {
        executableLines: 0,
        coveredLines: 0,
        linePercent: 0,
      },
      unmappedSources: [],
      diagnostics: { warnings: [], errors: [error.message ?? String(error)] },
    };
    await writeE2ECoverageReport(failure, {
      jsonPath: options.json,
      textPath: options.text,
    });
    throw error;
  }
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
