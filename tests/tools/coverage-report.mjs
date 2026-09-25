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
// Usage:
//   node tests/tools/coverage-report.mjs [--check <minLinePercent>] [-- <node --test args>]

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// A sandboxed run mirrors the repo layout, so the portion of the path from
// the mirrored top-level directory onward matches the real source tree.
const MIRRORED_DIRS = ['scripts', 'src', 'tests'];

function parseArgs(argv) {
  const options = { check: null, testArgs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value)) {
        throw new Error('--check requires a numeric percentage');
      }
      options.check = value;
      i += 1;
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

function formatRanges(lines) {
  const out = [];
  let start = null;
  let previous = null;
  for (const line of lines) {
    if (start === null) {
      start = line;
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

// Merges every recorded run into one per-file coverage map, discarding any
// record whose offsets were taken against text other than the file on disk.
// Returns the merged map plus the files that were discarded outright.
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
      // this file. Reporting them anyway paints the whole file as executed,
      // because the outermost range alone then covers every byte on disk.
      if (recordedSourceLength(scriptCoverage) !== source.length) {
        unmapped.add(relPath);
        continue;
      }
      const counts = countsForScript(scriptCoverage, source.length);
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

function report(merged) {
  const rows = [...merged.entries()]
    .map(([file, { source, counts }]) => ({
      file,
      ...summarizeLines(source, counts),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  const width = Math.max(4, ...rows.map((row) => row.file.length));
  const header = `${'file'.padEnd(width)} | line % | uncovered lines`;
  console.log(header);
  console.log('-'.repeat(header.length));

  let executable = 0;
  let covered = 0;
  for (const row of rows) {
    executable += row.executable;
    covered += row.covered;
    const pct = percent(row.covered, row.executable).toFixed(2).padStart(6);
    console.log(
      `${row.file.padEnd(width)} | ${pct} | ${formatRanges(row.uncovered)}`,
    );
  }
  console.log('-'.repeat(header.length));
  const totalPct = percent(covered, executable);
  console.log(
    `${'all files'.padEnd(width)} | ${totalPct.toFixed(2).padStart(6)} |`,
  );
  return totalPct;
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
    const totalPct = report(merged);
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
    if (options.check !== null && totalPct + 1e-9 < options.check) {
      console.error(
        `\nLine coverage ${totalPct.toFixed(2)}% is below the required ${options.check}%.`,
      );
      process.exit(1);
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
