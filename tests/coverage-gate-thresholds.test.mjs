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
//   all files   99.42% lines / 95.07% regions  (48197/48476 lines, 8060/8478 regions)
//   src files  100.00% lines / 99.96% regions  (8721/8721 lines, 2475/2476 regions)
//
// Only `--check-regions` has cleared a whole percent since the floors were
// last set; the other three sit under their next whole percent (99.42, 99.96)
// or are already at 100, so flooring leaves them where they are.
const FLOORS = {
  '--check': 99,
  '--check-source': 100,
  '--check-regions': 95,
  '--check-source-regions': 99,
  // Per-file rather than aggregate, so its floor is set by the worst source
  // file rather than by the whole of scripts/ and src/ together. Measured on
  // the suite this commit ships, the lowest is
  // scripts/lib/architecture-content.mjs at 97.78%, floored to 97.
  '--check-source-file-regions': 97,
  // The harness tree (tests/tools/) is walked by --require-source-files and
  // entered none of the ratios above, which are all built from
  // isSourceFile(). These are the same three shapes over its own row.
  // Measured on the suite this commit ships: harness files 100.00% lines /
  // 97.95% regions (3522/3522 lines, 1384/1413 regions), and the lowest
  // harness file is tests/tools/e2e-coverage-report.mjs at 93.65%, floored
  // to 93.
  '--check-harness': 100,
  '--check-harness-regions': 97,
  '--check-harness-file-regions': 93,
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
