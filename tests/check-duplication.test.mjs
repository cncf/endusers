// scripts/check-duplication.mjs is the CI gate that fails the build when
// either of its jscpd scans (code, and CSS plus .github/ YAML) counts more
// exact clones than that scan's ceiling allows, and that asks for a ceiling
// to come down once a clean-up leaves it slack. These tests drive the script's parts in-process
// with the jscpd process replaced by a seam, then run the real CLI entry once
// against a stubbed jscpd binary so the entry block is exercised as well.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CEILING_SLACK,
  CLONE_CEILING,
  CONFIG_PATH,
  JSCPD_BIN,
  REPORTED_PAIRS,
  REPORT_NAME,
  SCANS,
  judge,
  main,
  repoRoot as scriptRepoRoot,
  runJscpd,
  summarizeReport,
} from '../scripts/check-duplication.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function clone(first, second, lines) {
  return {
    format: 'javascript',
    lines,
    tokens: lines * 8,
    firstFile: { name: join(repoRoot, first), start: 1, end: lines },
    secondFile: { name: join(repoRoot, second), start: 1, end: lines },
  };
}

function report(duplicates, total = {}) {
  return {
    statistics: {
      total: {
        clones: duplicates.length,
        duplicatedLines: duplicates.reduce((sum, d) => sum + d.lines, 0),
        percentage: 1.2345,
        sources: 3,
        ...total,
      },
    },
    duplicates,
  };
}

/**
 * A spawnSync stand-in that behaves like jscpd's JSON reporter: it writes
 * `body` to the --output directory the script chose, then returns the given
 * process result. Records the invocation for assertions on the arguments.
 */
function fakeJscpd({ body, status = 0, stdout = '', stderr = '', error } = {}) {
  const calls = [];
  const spawn = (bin, args, options) => {
    calls.push({ bin, args, options });
    if (error) return { error, status: null, stdout: '', stderr: '' };
    if (body !== undefined) {
      const outputDir = args[args.indexOf('--output') + 1];
      writeFileSync(join(outputDir, REPORT_NAME), body);
    }
    return { status, stdout, stderr };
  };
  return { spawn, calls };
}

function collect() {
  const lines = [];
  return { lines, write: (line) => lines.push(line) };
}

// --- constants and module location ---

test('the script locates the repository root, config and binary from its own path', () => {
  assert.equal(scriptRepoRoot + '/', repoRoot);
  assert.equal(CONFIG_PATH, join(scriptRepoRoot, '.jscpd.json'));
  assert.equal(
    JSCPD_BIN,
    join(scriptRepoRoot, 'node_modules', '.bin', 'jscpd'),
  );
});

test('the ceiling and slack are positive integers with room for the slack', () => {
  assert.equal(SCANS[0].ceiling, CLONE_CEILING);
  for (const { ceiling } of SCANS) {
    assert.ok(Number.isInteger(ceiling) && CEILING_SLACK < ceiling);
  }
  assert.ok(Number.isInteger(CEILING_SLACK) && CEILING_SLACK > 0);
  assert.ok(Number.isInteger(REPORTED_PAIRS) && REPORTED_PAIRS > 0);
});

// --- runJscpd ---

test('runJscpd invokes the local binary with the repo config and a scratch JSON report', () => {
  const body = JSON.stringify(report([]));
  const jscpd = fakeJscpd({ body });
  const result = runJscpd({ spawn: jscpd.spawn });
  assert.equal(result.ok, true);
  assert.deepEqual(result.report, report([]));
  assert.equal(jscpd.calls.length, 1);
  const [{ bin, args, options }] = jscpd.calls;
  assert.equal(bin, JSCPD_BIN);
  assert.equal(args[args.indexOf('--config') + 1], CONFIG_PATH);
  assert.equal(args[args.indexOf('--reporters') + 1], 'json');
  assert.ok(args.includes('--output'));
  assert.ok(
    !args.includes('--threshold') && !args.includes('--exit-code'),
    'jscpd must not be asked to judge; the script owns the verdict',
  );
  assert.equal(options.cwd, scriptRepoRoot);

  const other = fakeJscpd({ body });
  runJscpd({ spawn: other.spawn, config: SCANS[1].config });
  const [{ args: otherArgs }] = other.calls;
  assert.equal(otherArgs[otherArgs.indexOf('--config') + 1], SCANS[1].config);
});

test('runJscpd reports a spawn error rather than a clean scan', () => {
  const jscpd = fakeJscpd({ error: new Error('spawnSync jscpd ENOENT') });
  const result = runJscpd({ spawn: jscpd.spawn });
  assert.equal(result.ok, false);
  assert.match(result.message, /failed to run jscpd/);
  assert.match(result.message, /ENOENT/);
});

test('runJscpd reports a non-zero exit, preferring stderr and falling back to stdout', () => {
  const withStderr = runJscpd({
    spawn: fakeJscpd({ status: 2, stderr: 'bad config', stdout: 'noise' })
      .spawn,
  });
  assert.equal(withStderr.ok, false);
  assert.match(withStderr.message, /exited with code 2/);
  assert.match(withStderr.message, /bad config/);
  assert.doesNotMatch(withStderr.message, /noise/);

  const withStdout = runJscpd({
    spawn: fakeJscpd({ status: 1, stderr: '', stdout: 'only stdout' }).spawn,
  });
  assert.equal(withStdout.ok, false);
  assert.match(withStdout.message, /only stdout/);
});

test('runJscpd reports a missing or malformed report file', () => {
  const missing = runJscpd({ spawn: fakeJscpd({ status: 0 }).spawn });
  assert.equal(missing.ok, false);
  assert.match(missing.message, new RegExp(`parseable ${REPORT_NAME}`));

  const malformed = runJscpd({ spawn: fakeJscpd({ body: '{not json' }).spawn });
  assert.equal(malformed.ok, false);
  assert.match(malformed.message, /parseable/);
});

test('runJscpd removes its scratch directory on every path', () => {
  const seen = [];
  const spawn = (bin, args) => {
    seen.push(args[args.indexOf('--output') + 1]);
    return { status: 0, stdout: '', stderr: '' };
  };
  runJscpd({ spawn });
  const [outputDir] = seen;
  assert.ok(outputDir.startsWith(tmpdir()));
  assert.throws(() => rmSync(outputDir, { recursive: true }), /ENOENT/);
});

// --- summarizeReport ---

test('summarizeReport reads the totals and aggregates clones per file pair', () => {
  const duplicates = [
    clone('tests/a.test.mjs', 'tests/b.test.mjs', 10),
    clone('tests/b.test.mjs', 'tests/a.test.mjs', 5),
    clone('src/x.js', 'src/x.js', 40),
    clone('scripts/one.mjs', 'scripts/two.mjs', 7),
  ];
  const summary = summarizeReport(report(duplicates), repoRoot);
  assert.equal(summary.clones, 4);
  assert.equal(summary.duplicatedLines, 62);
  assert.equal(summary.percentage, 1.2345);
  assert.equal(summary.sources, 3);
  assert.deepEqual(summary.pairs, [
    { files: ['src/x.js', 'src/x.js'], clones: 1, lines: 40 },
    { files: ['tests/a.test.mjs', 'tests/b.test.mjs'], clones: 2, lines: 15 },
    { files: ['scripts/one.mjs', 'scripts/two.mjs'], clones: 1, lines: 7 },
  ]);
});

test('summarizeReport orders equal line totals by clone count, then by path', () => {
  const duplicates = [
    clone('tests/m.mjs', 'tests/n.mjs', 6),
    clone('tests/m.mjs', 'tests/n.mjs', 6),
    clone('tests/c.mjs', 'tests/d.mjs', 12),
    clone('tests/a.mjs', 'tests/b.mjs', 12),
  ];
  const { pairs } = summarizeReport(report(duplicates), repoRoot);
  assert.deepEqual(
    pairs.map((p) => `${p.files.join('|')}:${p.clones}`),
    [
      'tests/m.mjs|tests/n.mjs:2',
      'tests/a.mjs|tests/b.mjs:1',
      'tests/c.mjs|tests/d.mjs:1',
    ],
  );
});

test('summarizeReport tolerates a report with missing sections', () => {
  assert.deepEqual(summarizeReport(undefined, repoRoot), {
    clones: 0,
    duplicatedLines: 0,
    percentage: 0,
    sources: 0,
    pairs: [],
  });
  const sparse = summarizeReport(
    { duplicates: [{ firstFile: {}, secondFile: {} }, {}] },
    repoRoot,
  );
  assert.equal(sparse.clones, 0);
  assert.deepEqual(sparse.pairs, [{ files: ['', ''], clones: 2, lines: 0 }]);
});

test('summarizeReport defaults to the repository root for relative paths', () => {
  const { pairs } = summarizeReport(
    report([clone('tests/a.mjs', 'tests/b.mjs', 5)]),
  );
  assert.deepEqual(pairs[0].files, ['tests/a.mjs', 'tests/b.mjs']);
});

// --- judge ---

test('judge separates empty scans, excess, slack and the acceptable band', () => {
  const options = { ceiling: 100, slack: 10 };
  assert.equal(judge({ clones: 0, sources: 0 }, options), 'empty');
  assert.equal(judge({ clones: 101, sources: 5 }, options), 'over');
  assert.equal(judge({ clones: 100, sources: 5 }, options), 'ok');
  assert.equal(judge({ clones: 91, sources: 5 }, options), 'ok');
  assert.equal(judge({ clones: 90, sources: 5 }, options), 'slack');
  assert.equal(judge({ clones: 0, sources: 5 }, options), 'slack');
});

test('judge defaults to the exported ceiling and slack', () => {
  assert.equal(judge({ clones: CLONE_CEILING, sources: 1 }), 'ok');
  assert.equal(judge({ clones: CLONE_CEILING + 1, sources: 1 }), 'over');
  assert.equal(
    judge({ clones: CLONE_CEILING - CEILING_SLACK, sources: 1 }),
    'slack',
  );
});

// --- main ---

function runMain(reportBody, { ceiling, ...options } = {}) {
  const out = collect();
  const err = collect();
  const jscpd = fakeJscpd({ body: JSON.stringify(reportBody) });
  const code = main({
    spawn: jscpd.spawn,
    scans: [{ ...SCANS[0], ceiling }],
    log: out.write,
    error: err.write,
    ...options,
  });
  return { code, stdout: out.lines.join('\n'), stderr: err.lines.join('\n') };
}

test('main exits 0 and prints the counts when the tree is within the band', () => {
  const duplicates = [clone('tests/a.mjs', 'tests/b.mjs', 5)];
  const result = runMain(report(duplicates), { ceiling: 1, slack: 1 });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /check-duplication: ok - 1 exact clone\(s\)/);
  assert.match(result.stdout, /ceiling 1/);
  assert.equal(result.stderr, '');
});

test('main exits 1 and names the worst pairs when the ceiling is exceeded', () => {
  const duplicates = [];
  for (let i = 0; i < REPORTED_PAIRS + 2; i += 1) {
    duplicates.push(clone(`tests/p${i}.mjs`, `tests/q${i}.mjs`, 100 - i));
  }
  duplicates.push(clone('src/self.js', 'src/self.js', 500));
  const result = runMain(report(duplicates), { ceiling: 1, slack: 1 });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Most duplicated file pairs:/);
  assert.match(
    result.stderr,
    /500 lines in 1 clone\(s\): src\/self.js \(within file\)/,
  );
  assert.match(result.stderr, /tests\/p0.mjs <> tests\/q0.mjs/);
  const listed = result.stderr
    .split('\n')
    .filter((l) => / lines in \d+ clone/.test(l));
  assert.equal(listed.length, REPORTED_PAIRS);
  assert.doesNotMatch(
    result.stderr,
    new RegExp(`tests/p${REPORTED_PAIRS}\\.mjs`),
  );
  assert.match(result.stderr, /CLONE_CEILING .* only ever lowered/);
});

test('main exits 1 and asks for the ceiling to come down when the tree is slack', () => {
  const duplicates = [clone('tests/a.mjs', 'tests/b.mjs', 5)];
  const result = runMain(report(duplicates), { ceiling: 20, slack: 10 });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /at least 10 clone\(s\) under the ceiling/);
  assert.match(result.stderr, /Lower CLONE_CEILING .* to 1 /);
});

test('main exits 1 when jscpd scanned nothing', () => {
  const result = runMain(report([], { sources: 0 }), { ceiling: 1, slack: 1 });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /scanned no files/);
  assert.match(result.stderr, /\.jscpd\.json/);
});

test('main runs every scan against its own ceiling and fails if any fails', () => {
  const duplicates = [clone('src/a.css', 'src/b.css', 5)];
  const result = runMain(report(duplicates), {
    slack: 5,
    scans: [
      { config: CONFIG_PATH, ceiling: 1, name: 'FIRST' },
      { config: '/repo/.second.json', ceiling: 0, name: 'SECOND' },
    ],
  });
  assert.equal(result.code, 1);
  assert.match(
    result.stdout,
    /ok - 1 exact .* ceiling 1 \(FIRST, \.jscpd\.json\)/,
  );
  assert.match(result.stderr, /ceiling 0 \(SECOND, \.second\.json\)/);
  assert.match(result.stderr, /--config \.second\.json.*SECOND in /);
});

test('main exits 1 and relays the message when jscpd could not run', () => {
  const err = collect();
  const code = main({
    spawn: fakeJscpd({ error: new Error('ENOENT') }).spawn,
    error: err.write,
    log: () => assert.fail('nothing is logged on failure'),
  });
  assert.equal(code, 1);
  assert.match(err.lines.join('\n'), /check-duplication: failed to run jscpd/);
});

// --- CLI entry, with jscpd stubbed ---

// Stub installed at node_modules/.bin/jscpd in a sandbox that mirrors the
// repo layout (so coverage maps back to the real source). It writes a canned
// report to the --output directory the script chose, mirroring
// tests/audit-gate.test.mjs's npm stub.
const JSCPD_STUB = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const args = process.argv.slice(2);
const outputDir = args[args.indexOf('--output') + 1];
const config = basename(args[args.indexOf('--config') + 1]);
writeFileSync(join(outputDir, ${JSON.stringify(REPORT_NAME)}), JSON.stringify(JSON.parse(process.env.JSCPD_STUB_REPORTS)[config]));
`;

// Takes one report per scan, in SCANS order.
function runCli(reportBodies) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-dup-'));
  try {
    const script = join(work, 'scripts', 'check-duplication.mjs');
    mkdirSync(dirname(script), { recursive: true });
    cpSync(join(repoRoot, 'scripts', 'check-duplication.mjs'), script);
    // The stub is ESM; its package scope must say so.
    writeFileSync(join(work, 'package.json'), '{"type":"module"}');

    const binDir = join(work, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'jscpd'), JSCPD_STUB);
    chmodSync(join(binDir, 'jscpd'), 0o755);
    const pathDir = join(work, '.path');
    mkdirSync(pathDir);
    symlinkSync(process.execPath, join(pathDir, 'node'));

    return spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: pathDir,
        JSCPD_STUB_REPORTS: JSON.stringify(
          Object.fromEntries(
            SCANS.map(({ config }, i) => [basename(config), reportBodies[i]]),
          ),
        ),
      },
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test('cli: exits through main() with the verdict as the process status', () => {
  // Exactly at each ceiling: the one count that is neither over nor slack.
  const reports = SCANS.map(({ ceiling }) =>
    report(
      Array.from({ length: ceiling }, (_, i) =>
        clone(`tests/a${i}.mjs`, `tests/b${i}.mjs`, 5),
      ),
    ),
  );
  const ok = runCli(reports);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /check-duplication: ok/);

  const over = runCli([
    ...reports.slice(0, -1),
    report([...reports.at(-1).duplicates, clone('src/x.css', 'src/y.css', 9)]),
  ]);
  assert.equal(over.status, 1);
  assert.match(over.stderr, /Most duplicated file pairs/);
});
