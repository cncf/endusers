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

import { readWorkflow } from './helpers-workflows.mjs';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

const GATE_SCRIPT = 'test:unit:coverage:check';

// Measured on the suite this commit ships, floored to a whole percent so a
// rounding difference between runs cannot fail the build:
//   all files    99.67% lines / 96.14% regions  (65688/65903 lines, 10511/10933 regions)
//   src files   100.00% lines / 100.00% regions (9650/9650 lines, 2792/2792 regions)
//
// Both figures were taken twice, on node v22.23.3 -- the major ci.yml pins --
// and on node v26.10.0, and the two runs agree to the region. Region counts
// are a V8 artifact, so a floor set at exactly 100 is only safe once it has
// been shown not to move with the runtime; these did not.
//
// `--check` sits under its next whole percent (99.67) and `--check-source` is
// already at 100, so flooring leaves both where they are. The three region
// floors below have all cleared a whole percent since they were last set.
const FLOORS = {
  '--check': 99,
  '--check-source': 100,
  '--check-regions': 96,
  // scripts/ and src/ are at 2777/2777: every region executed, with no
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
  // 99.79% regions (5742/5742 lines, 1938/1942 regions), taken twice -- on
  // node v22.23.3, the major ci.yml pins, and on node v26.10.0 -- with the two
  // runs agreeing to the region. tests/tools/e2e-coverage-report.mjs is the
  // only harness file below 100.00%; every other one is at 100.00%.
  //
  // That file's percentage is its ceiling, not a backlog: its uncovered
  // regions are the defensive fallbacks the note at the top of the file lists
  // as unreachable (#1253; three more were deleted rather than listed in
  // #1304), so no test can lift it. The per-file floor must stay at or below
  // that ceiling until the list shrinks; a probe that lands one of them should
  // raise the floor and shorten the list in the same change.
  //
  // The ceiling itself is deliberately not written out here. It is asserted
  // below against the note instead, because every attempt to restate it in
  // this comment has gone stale while the note moved on: the comment said "6
  // uncovered regions" where the note said 7, and it later said the file was
  // capped at 98.57% -- the 7-region figure -- after #1304 had deleted three
  // of them and the note had been rewritten to 4 regions. A second test below
  // now fails on that shape directly, so the next restatement cannot drift
  // silently either.
  //
  // Both harness floors moved up with this commit. They were previously held
  // at 97 by tests/helpers-script-sandbox.mjs, whose single uncovered region
  // was realGitPath's `?? ''` arm: spawnSync only reports `stdout: null` for a
  // process that never started, and that call passes `shell: true`, so no test
  // could reach it while the expression stayed inline. Splitting the
  // normalisation out as gitPathFromLookup made it a function of the one value
  // spawnSync varies, and that file is now at 100.00%. The aggregate was
  // deliberately left at 97 against a measured 99.57 only "until that file has
  // been lifted"; it has been, so it follows the measurement up to 99.
  '--check-harness': 100,
  '--check-harness-regions': 99,
  '--check-harness-file-regions': 98,
};

function parseGate(command) {
  const tokens = command.split(/\s+/);
  const flags = new Map();
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].startsWith('--check')) flags.set(tokens[i], tokens[i + 1]);
  }
  return flags;
}

// The `--check-harness-file-regions` floor is the only one in this file that
// is not set by the suite's measurement but by another file's *claim*: the
// residual note at the top of tests/tools/e2e-coverage-report.mjs enumerates
// the fallbacks no probe could close, totals them, and states the percentage
// they cap that file at. The comment above read that total back by hand and
// went stale -- it said 6 while the note said 7 -- which is the same
// drift-by-omission tests/docs-threshold-parity.test.mjs closes between the
// gate and the contributor docs. Reading it instead of restating it is what
// keeps the two in step.
// Matched across the comment's own line wrapping: the note is prose in a `//`
// block, so any word boundary in it may carry a newline and a `// ` prefix.
const RESIDUAL_NOTE = new RegExp(
  [
    'Together',
    'they',
    'are',
    '(\\d+)',
    'regions,',
    'which',
    'caps',
    'this',
    'file',
    'at',
    '(\\d+(?:\\.\\d+)?)%',
    'regions',
  ].join('(?:\\s*\\n\\s*//)?\\s+'),
  'u',
);
const RESIDUAL_FILE = 'tests/tools/e2e-coverage-report.mjs';

function residualCeiling() {
  const source = readFileSync(`${repoRoot}${RESIDUAL_FILE}`, 'utf8');
  const match = RESIDUAL_NOTE.exec(source);
  assert.ok(
    match,
    `${RESIDUAL_FILE} must keep its residual note in the form "Together they are ` +
      'N regions, which caps this file at P% regions"; the --check-harness-file-regions ' +
      'floor below is argued from that sentence, so a rewrite that drops it leaves the ' +
      'floor with nothing behind it',
  );
  return { regions: Number(match[1]), ceiling: Number(match[2]) };
}

test(`${RESIDUAL_FILE} still caps the harness per-file floor where this file says`, () => {
  const { regions, ceiling } = residualCeiling();
  assert.ok(
    regions > 0,
    `${RESIDUAL_FILE} now lists no residual regions, so it is no longer the lowest ` +
      'harness file; re-measure the harness row and raise --check-harness-file-regions',
  );
  const floor = FLOORS['--check-harness-file-regions'];
  assert.ok(
    floor <= Math.floor(ceiling),
    `--check-harness-file-regions is floored at ${floor}, above the ${ceiling}% ceiling ` +
      `${RESIDUAL_FILE} documents for its ${regions} unreachable regions; the gate can ` +
      'only be raised past that by closing one of them and shortening the note in the ' +
      'same change',
  );
});

// Any percentage this file attributes to the residual file by hand, with the
// `//` wrapping removed so a figure split across two comment lines is still
// read as one number. The assertion above pins the *floor* against the note;
// this pattern is what pins the *prose* against it, which is the half that
// kept drifting: an out-of-date ceiling restated here reads as the measured
// truth, and the argument for the floor is then made from a number no longer
// in evidence anywhere.
const RESTATED_CEILING =
  /e2e-coverage-report\.mjs(?:\s+is)?[^.%]{0,120}?at\s+(\d+(?:\.\d+)?)%/gu;

test(`this file never restates a ${RESIDUAL_FILE} ceiling the note disagrees with`, () => {
  const { ceiling } = residualCeiling();
  const unwrapped = readFileSync(
    fileURLToPath(import.meta.url),
    'utf8',
  ).replace(/\n\s*\/\/\s*/gu, ' ');
  for (const match of unwrapped.matchAll(RESTATED_CEILING)) {
    assert.equal(
      Number(match[1]),
      ceiling,
      `this file says ${RESIDUAL_FILE} is capped at ${match[1]}%, but that file's own ` +
        `residual note says ${ceiling}%; restate the note or, better, cite it rather ` +
        'than copying the figure, which is how the previous two restatements went stale',
    );
  }
});

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
  const workflow = readWorkflow('ci.yml').source;
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
