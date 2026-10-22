#!/usr/bin/env node
// Fails CI when jscpd finds more exact clones than a ceiling allows, in
// either of two scans: the code in tests/, src/ and scripts/ (.jscpd.json,
// CLONE_CEILING), and the stylesheets in src/ plus the workflow, composite
// action and other YAML under .github/ (.jscpd.css-yaml.json,
// CSS_YAML_CLONE_CEILING). The second scan has its own config because a
// copied CSS rule or workflow step is far shorter than a copied function:
// at the code scan's 50-token, 5-line minimum it sees neither.
//
// The repository's test suite grew by copying: fifteen contract tests each
// carried the same workflow loader, two gates shared a hundred lines of
// scanner, and the next bot sweep filed the same finding once per copy. A
// percentage threshold (jscpd's own --threshold) cannot hold that line,
// because adding unrelated code dilutes the ratio while the copies stay. This
// gate counts clones instead and only ever ratchets down: the ceiling is the
// number of clones on main when the gate was introduced, a change that adds
// clones fails, and a change that removes enough of them is asked to lower
// the ceiling so the headroom cannot be spent by the next copy.
//
// jscpd is driven through its CLI rather than its programmatic API: the
// package's ESM entry does not resolve on Node's strict module resolution,
// and the CLI is the surface its JSON report is specified for.
//
// Usage: node scripts/check-duplication.mjs  (CI: `npm run check:duplication`)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Exact clones jscpd reports for each scan on main at the time of the last
// adjustment. Lower them whenever the gate reports headroom; never raise
// them. A change that genuinely needs a new copy should instead extract the
// shared piece, which is what the count exists to prompt.
export const CLONE_CEILING = 245;
export const CSS_YAML_CLONE_CEILING = 35;

// How far below the ceiling the count may fall before the gate insists the
// ceiling follow it down. Without this the slack left by one clean-up would
// quietly pay for the next few copies.
export const CEILING_SLACK = 10;

// How many file pairs the failure report names, most duplicated lines first.
export const REPORTED_PAIRS = 10;

export const CONFIG_PATH = join(repoRoot, '.jscpd.json');
export const CSS_YAML_CONFIG_PATH = join(repoRoot, '.jscpd.css-yaml.json');
export const JSCPD_BIN = join(repoRoot, 'node_modules', '.bin', 'jscpd');
export const REPORT_NAME = 'jscpd-report.json';

export const SCANS = [
  { config: CONFIG_PATH, ceiling: CLONE_CEILING, name: 'CLONE_CEILING' },
  {
    config: CSS_YAML_CONFIG_PATH,
    ceiling: CSS_YAML_CLONE_CEILING,
    name: 'CSS_YAML_CLONE_CEILING',
  },
];

/**
 * Runs jscpd with one scan's config and the JSON reporter into a
 * scratch directory, returning the parsed report.
 *
 * jscpd exits non-zero only when it could not run (it is invoked without
 * --threshold or --exit-code), so any failure here is the tool's, not the
 * tree's, and is reported as such rather than as a clean scan.
 *
 * @param {object} [options]
 * @param {typeof spawnSync} [options.spawn] test seam for the jscpd process
 * @param {string} [options.config] jscpd config file to scan with
 * @returns {{ok: true, report: object} | {ok: false, message: string}}
 */
export function runJscpd({ spawn = spawnSync, config = CONFIG_PATH } = {}) {
  const outputDir = mkdtempSync(join(tmpdir(), 'endusers-jscpd-'));
  try {
    const result = spawn(
      JSCPD_BIN,
      [
        '--config',
        config,
        '--reporters',
        'json',
        '--output',
        outputDir,
        '--silent',
      ],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.error) {
      return {
        ok: false,
        message: `failed to run jscpd (${JSCPD_BIN}): ${result.error}`,
      };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        message:
          `jscpd exited with code ${result.status}:\n` +
          `${result.stderr || result.stdout}`,
      };
    }
    let report;
    try {
      report = JSON.parse(readFileSync(join(outputDir, REPORT_NAME), 'utf8'));
    } catch (error) {
      return {
        ok: false,
        message: `jscpd did not leave a parseable ${REPORT_NAME}: ${error}`,
      };
    }
    return { ok: true, report };
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

/**
 * Reduces a jscpd JSON report to the totals the gate judges and the file
 * pairs worth naming when it fails. Paths are made repository-relative; the
 * config asks jscpd for absolute paths because its relative ones are taken
 * from each scanned root, which loses the root.
 *
 * @param {object} report parsed jscpd-report.json
 * @param {string} [root] directory paths are expressed relative to
 * @returns {{clones: number, duplicatedLines: number, percentage: number,
 *   sources: number, pairs: Array<{files: string[], clones: number,
 *   lines: number}>}}
 */
export function summarizeReport(report, root = repoRoot) {
  const total = report?.statistics?.total ?? {};
  const pairs = new Map();
  for (const clone of report?.duplicates ?? []) {
    const files = [clone.firstFile?.name, clone.secondFile?.name]
      .map((name) => relative(root, String(name ?? '')))
      .sort();
    const key = files.join('\0');
    const pair = pairs.get(key) ?? { files, clones: 0, lines: 0 };
    pair.clones += 1;
    pair.lines += Number(clone.lines ?? 0);
    pairs.set(key, pair);
  }
  return {
    clones: Number(total.clones ?? 0),
    duplicatedLines: Number(total.duplicatedLines ?? 0),
    percentage: Number(total.percentage ?? 0),
    sources: Number(total.sources ?? 0),
    pairs: [...pairs.values()].sort(
      (a, b) =>
        b.lines - a.lines ||
        b.clones - a.clones ||
        a.files.join().localeCompare(b.files.join()),
    ),
  };
}

/**
 * Judges a summary against the ceiling.
 *
 * `empty`: jscpd scanned nothing, which a misconfigured path or ignore list
 * would otherwise present as a perfectly clean tree.
 * `over`: more clones than the ceiling allows.
 * `slack`: enough fewer that the ceiling must be lowered.
 * `ok`: within the band.
 *
 * @param {{clones: number, sources: number}} summary
 * @param {object} [options]
 * @param {number} [options.ceiling]
 * @param {number} [options.slack]
 * @returns {'empty' | 'over' | 'slack' | 'ok'}
 */
export function judge(
  summary,
  { ceiling = CLONE_CEILING, slack = CEILING_SLACK } = {},
) {
  if (summary.sources === 0) return 'empty';
  if (summary.clones > ceiling) return 'over';
  if (summary.clones <= ceiling - slack) return 'slack';
  return 'ok';
}

function describePair(pair) {
  const [first, second] = pair.files;
  const where =
    first === second ? `${first} (within file)` : `${first} <> ${second}`;
  return `  ${String(pair.lines).padStart(5)} lines in ${pair.clones} clone(s): ${where}`;
}

/**
 * Runs one scan and reports its verdict, returning its exit code.
 *
 * @param {{config: string, ceiling: number, name: string}} scan
 * @param {object} options
 * @returns {number}
 */
function checkScan({ config, ceiling, name }, { spawn, slack, log, error }) {
  const configName = basename(config);
  const run = runJscpd({ spawn, config });
  if (!run.ok) {
    error(`check-duplication: ${run.message}`);
    return 1;
  }
  const summary = summarizeReport(run.report);
  const verdict = judge(summary, { ceiling, slack });
  const counts =
    `${summary.clones} exact clone(s), ${summary.duplicatedLines} ` +
    `duplicated line(s) (${summary.percentage.toFixed(2)}%) across ` +
    `${summary.sources} file(s); ceiling ${ceiling} (${name}, ${configName})`;

  if (verdict === 'empty') {
    error(
      'check-duplication: jscpd scanned no files; check the path and ignore ' +
        `settings in ${configName} rather than treating this as a clean tree.`,
    );
    return 1;
  }
  if (verdict === 'over') {
    error(`check-duplication: ${counts}`);
    error('Most duplicated file pairs:');
    for (const pair of summary.pairs.slice(0, REPORTED_PAIRS)) {
      error(describePair(pair));
    }
    error(
      'Extract the repeated piece into a shared helper instead of adding ' +
        `another copy. Run \`npx jscpd --config ${configName}\` for every ` +
        `clone with its lines. ${name} in scripts/check-duplication.mjs is ` +
        'only ever lowered.',
    );
    return 1;
  }
  if (verdict === 'slack') {
    error(`check-duplication: ${counts}`);
    error(
      `The tree is at least ${slack} clone(s) under the ceiling. Lower ` +
        `${name} in scripts/check-duplication.mjs to ${summary.clones} ` +
        'so the headroom this clean-up earned cannot be spent on new copies.',
    );
    return 1;
  }
  log(`check-duplication: ok - ${counts}`);
  return 0;
}

/**
 * Entry point. Runs every scan, so one failure does not hide another, and
 * returns the process exit code rather than calling process.exit so the
 * unit tests can drive every arm in-process.
 *
 * @param {object} [options]
 * @param {typeof spawnSync} [options.spawn]
 * @param {Array<{config: string, ceiling: number, name: string}>} [options.scans]
 * @param {number} [options.slack]
 * @param {(line: string) => void} [options.log]
 * @param {(line: string) => void} [options.error]
 * @returns {number}
 */
export function main({
  spawn = spawnSync,
  scans = SCANS,
  slack = CEILING_SLACK,
  log = console.log,
  error = console.error,
} = {}) {
  let code = 0;
  for (const scan of scans) {
    code = Math.max(code, checkScan(scan, { spawn, slack, log, error }));
  }
  return code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
