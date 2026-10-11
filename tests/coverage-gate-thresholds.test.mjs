// Guards the thresholds passed to tests/tools/coverage-report.mjs by the
// `test:unit:coverage:check` script, which is the gate ci.yml runs.
//
// tests/coverage-report.test.mjs proves the reporter honours whatever
// `--check`, `--check-source`, `--check-regions` and `--check-source-regions`
// it is handed; nothing proves the repository actually hands it a threshold
// worth clearing. A gate set below the coverage the suite already achieves
// spends CI time without protecting anything: coverage can fall by the whole
// slack before a single run turns red, and the edit that lowers it is a
// one-token change to a string in package.json that no test reads.
//
// The floors below are therefore minimums, not targets. Raising a threshold in
// package.json keeps this test green; lowering one past its floor fails it and
// forces the loosening to be argued for rather than slipped in. When coverage
// climbs and the package.json thresholds are ratcheted up with it, raise these
// floors in the same change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

const GATE_SCRIPT = 'test:unit:coverage:check';

// Measured on the suite this commit ships, floored to a whole percent so a
// rounding difference between runs cannot fail the build:
//   all files    99.65% lines / 96.12% regions  (57649/57853 lines, 9305/9681 regions)
//   src files   100.00% lines / 100.00% regions (9135/9135 lines, 2753/2753 regions)
//
// Both figures were taken twice, on node v22.21.1 -- the major ci.yml pins --
// and on node v26.10.0, and the two runs agree to the region. Region counts
// are a V8 artifact, so a floor set at exactly 100 is only safe once it has
// been shown not to move with the runtime; these did not.
//
// `--check` sits under its next whole percent (99.65) and `--check-source` is
// already at 100, so flooring leaves both where they are. The three region
// floors below have all cleared a whole percent since they were last set.
const FLOORS = {
  '--check': 99,
  '--check-source': 100,
  '--check-regions': 96,
  // scripts/ and src/ are at 2753/2753: every region executed, with no
  // uncreditable residual of the kind that keeps the browser gate (#1256) and
  // the harness per-file gate below their own ceilings. 100 is therefore the
  // measured floor here rather than an aspiration. A new defensive fallback in
  // either tree now has to be reached by a test or argued for by lowering this
  // deliberately -- which is the point: at 99 the gate let 27 source regions
  // go dark before it noticed.
  '--check-source-regions': 100,
  // Per-file rather than aggregate, so its floor is set by the worst source
  // file rather than by the whole of scripts/ and src/ together. Measured on
  // the suite this commit ships, every file under both trees is at 100.00%,
  // so the worst is 100. Kept alongside the aggregate even though an aggregate
  // of 100 implies it: the per-file check is what names the offending file and
  // its uncovered regions in the failure message.
  '--check-source-file-regions': 100,
  // The harness tree (tests/tools/) is walked by --require-source-files and
  // entered none of the ratios above, which are all built from
  // isSourceFile(). These are the same three shapes over its own row.
  // Measured on the suite this commit ships: harness files 100.00% lines /
  // 99.53% regions (3925/3925 lines, 1467/1474 regions), and the lowest
  // harness file is tests/tools/e2e-coverage-report.mjs at 98.57%, floored
  // to 97. Every other harness file is at 100.00%.
  //
  // 98.57% is also that file's ceiling, not a backlog: its 7 uncovered
  // regions are the defensive fallbacks the note at the top of the file lists
  // as unreachable (#1253; three more were deleted rather than listed in
  // #1304), so no test can lift it. The per-file floor must stay at or below
  // 98 until that list shrinks; a probe that lands one of them should raise
  // the floor and shorten the list in the same change.
  '--check-harness': 100,
  '--check-harness-regions': 97,
  '--check-harness-file-regions': 97,
};

function parseGate(command) {
  const tokens = command.split(/\s+/);
  const flags = new Map();
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].startsWith('--check')) flags.set(tokens[i], tokens[i + 1]);
  }
  return flags;
}

const gateCommand = manifest.scripts?.[GATE_SCRIPT];

test(`package.json defines the ${GATE_SCRIPT} gate`, () => {
  assert.equal(
    typeof gateCommand,
    'string',
    `package.json must keep a ${GATE_SCRIPT} script; ci.yml runs it as the coverage gate`,
  );
  assert.match(gateCommand, /tests\/tools\/coverage-report\.mjs/);
});

test('the gate is the command ci.yml runs for coverage', () => {
  const workflow = readFileSync(`${repoRoot}.github/workflows/ci.yml`, 'utf8');
  assert.match(
    workflow,
    new RegExp(`npm run ${GATE_SCRIPT}\\b`),
    `ci.yml must run "npm run ${GATE_SCRIPT}"; a gate no workflow invokes protects nothing`,
  );
});

for (const [flag, floor] of Object.entries(FLOORS)) {
  test(`${GATE_SCRIPT} passes ${flag} at or above ${floor}`, () => {
    const flags = parseGate(gateCommand);
    assert.ok(
      flags.has(flag),
      `${GATE_SCRIPT} must pass ${flag}; without it that dimension of coverage has no gate`,
    );
    const value = Number(flags.get(flag));
    assert.ok(
      Number.isFinite(value),
      `${flag} must be given a numeric percentage, got ${flags.get(flag)}`,
    );
    assert.ok(
      value >= floor,
      `${flag} is ${value}, below the ${floor} the suite already achieves; ` +
        'lowering the gate lets coverage regress silently',
    );
  });
}

test('every threshold the reporter supports is actually gated', () => {
  const reporter = readFileSync(
    `${repoRoot}tests/tools/coverage-report.mjs`,
    'utf8',
  );
  const supported = new Set(
    [...reporter.matchAll(/'(--check[a-z-]*)':/g)].map((match) => match[1]),
  );
  const gated = new Set(parseGate(gateCommand).keys());
  for (const flag of supported) {
    assert.ok(
      gated.has(flag),
      `the reporter supports ${flag} but ${GATE_SCRIPT} never passes it, ` +
        'so that dimension of coverage is measured and then discarded',
    );
  }
});
