// Guards the thresholds the `e2e-coverage` job in .github/workflows/ci.yml
// hands to tests/tools/e2e-coverage-report.mjs.
//
// This is the end-to-end counterpart of tests/coverage-gate-thresholds.test.mjs,
// and it exists for the same reason that file gives: nothing proves the
// repository hands its reporter a threshold worth clearing, and the edit that
// lowers one is a one-token change to a string no test reads. The unit lane's
// thresholds at least live in package.json; the e2e lane's live inside a YAML
// `run:` block, which is harder to notice still.
//
// tests/ci-gating-jobs.test.mjs already proves the job is required and does not
// swallow its own failure, but it never reads the arguments. Without this file
// `--check-source 100` could become `--check-source 50`, or disappear, and
// every check in the repository would stay green while browser coverage of
// src/** silently halved.
//
// The assertions below are floors, not an exact argument list. Tightening the
// gate -- raising a percentage, adding a threshold -- keeps this test green.
// Loosening it fails, which is the point: the loosening has to be argued for
// rather than slipped in. When e2e coverage climbs and the workflow is
// ratcheted up with it, raise these floors in the same change.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const REPORT_SCRIPT = 'report:e2e:coverage';
const COVERAGE_JOB = 'e2e-coverage';

// Measured on the suite this commit ships: the e2e-coverage job renders with
// `--check-source 100 --check-source-regions 95` and the run clears both; the
// full suite measured 100.00% source lines and 81.43% source regions when the
// region gate landed (#1026, #1031), 91.63% source regions when the floor was
// ratcheted to 91 (#1105), and 95.22% (438/460) when it was ratcheted to 95
// after #1163 folded the crossing-region source-map drift and #1060 covered
// the member-directory toolbar arms (#1079).
const FLOORS = {
  '--check-source': 100,
  '--check-source-regions': 95,
};

// Present-or-absent guarantees, which carry no percentage. --require-source-files
// is the second, different guarantee the reporter documents: the percentage is a
// ratio over the files the run observed, so a src module the bundle dropped
// contributes to neither side of it and only the file-set comparison can see it.
const REQUIRED_SWITCHES = ['--require-source-files'];

const manifest = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);
// Parsing is a pure function of the workflow text so the fixtures below can
// prove the guard actually fails on a weakened gate. A ratchet nobody has seen
// go red is indistinguishable from one that always passes.
function reporterFlags(workflowText) {
  const job = parse(workflowText).jobs?.[COVERAGE_JOB];
  // Every `run:` in the job, joined: the reporter invocation is a line
  // continuation inside one of them, and which step carries it is not the
  // contract.
  const commands = (job?.steps ?? [])
    .map((step) => step.run)
    .filter((run) => typeof run === 'string')
    .join('\n');
  const start = commands.indexOf(`npm run ${REPORT_SCRIPT}`);
  if (start === -1) return null;
  // The argument list is wrapped over several lines by backslash
  // continuations. Dropping those and splitting on whitespace reads the flags
  // without caring how the lines happen to be wrapped.
  const tokens = commands
    .slice(start)
    .replace(/\\\n/g, ' ')
    .split('\n')[0]
    .trim()
    .split(/\s+/);
  const flags = new Map();
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].startsWith('--check') || tokens[i].startsWith('--require')) {
      flags.set(tokens[i], tokens[i + 1]);
    }
  }
  return flags;
}

const workflowText = readFileSync(
  join(repoRoot, '.github', 'workflows', 'ci.yml'),
  'utf8',
);

function check(flags) {
  assert.ok(
    flags,
    `${COVERAGE_JOB} must run "npm run ${REPORT_SCRIPT}"; a reporter no workflow invokes gates nothing`,
  );
  for (const [flag, floor] of Object.entries(FLOORS)) {
    assert.ok(
      flags.has(flag),
      `${COVERAGE_JOB} must pass ${flag}; without it that dimension of e2e coverage has no gate`,
    );
    const value = Number(flags.get(flag));
    assert.ok(
      Number.isFinite(value),
      `${flag} must be given a numeric percentage, got ${flags.get(flag)}`,
    );
    assert.ok(
      value >= floor,
      `${flag} is ${value}, below the ${floor} the e2e suite already achieves; ` +
        'lowering the gate lets browser coverage regress silently',
    );
  }
  for (const switchName of REQUIRED_SWITCHES) {
    assert.ok(
      flags.has(switchName),
      `${COVERAGE_JOB} must pass ${switchName}; the coverage percentage is a ratio ` +
        'over the files the run observed, so only this switch notices a src module ' +
        'that dropped out of the bundle entirely',
    );
  }
}

test(`package.json defines the ${REPORT_SCRIPT} script`, () => {
  const command = manifest.scripts?.[REPORT_SCRIPT];
  assert.equal(
    typeof command,
    'string',
    `package.json must keep a ${REPORT_SCRIPT} script; ci.yml runs it as the e2e coverage gate`,
  );
  assert.match(command, /tests\/tools\/e2e-coverage-report\.mjs/);
});

test('the e2e coverage gate in ci.yml clears every floor', () => {
  check(reporterFlags(workflowText));
});

// The fixtures below are the proof that the assertions above can fail. Each is
// the real workflow with one edit a reviewer could plausibly wave through.
function weakened(replacement) {
  const original = '            --check-source 100 \\\n';
  assert.ok(
    workflowText.includes(original),
    'fixture is stale: ci.yml no longer renders with --check-source 100',
  );
  return workflowText.replace(original, replacement);
}

test('a lowered --check-source fails the guard', () => {
  assert.throws(
    () => check(reporterFlags(weakened('            --check-source 50 \\\n'))),
    /--check-source is 50, below the 100/,
  );
});

test('a deleted --check-source fails the guard', () => {
  assert.throws(
    () => check(reporterFlags(weakened(''))),
    /must pass --check-source/,
  );
});

test('a non-numeric --check-source fails the guard', () => {
  assert.throws(
    () => check(reporterFlags(weakened('            --check-source all \\\n'))),
    /--check-source must be given a numeric percentage, got all/,
  );
});

test('a deleted --require-source-files fails the guard', () => {
  const stripped = workflowText.replace(
    '            --require-source-files \\\n',
    '',
  );
  assert.notEqual(stripped, workflowText, 'fixture is stale');
  assert.throws(
    () => check(reporterFlags(stripped)),
    /must pass --require-source-files/,
  );
});

test('a job that never invokes the reporter fails the guard', () => {
  const stripped = workflowText.replace(
    `npm run ${REPORT_SCRIPT}`,
    'echo skipped',
  );
  assert.throws(() => check(reporterFlags(stripped)), /a reporter no workflow/);
});

// The region floor shares check()'s mechanism with --check-source, but the
// fixture text it edits is its own line, so it gets its own staleness guard
// and its own proof the floor can go red.
function weakenedRegions(replacement) {
  const original = '            --check-source-regions 95 \\\n';
  assert.ok(
    workflowText.includes(original),
    'fixture is stale: ci.yml no longer renders with --check-source-regions 95',
  );
  return workflowText.replace(original, replacement);
}

test('a lowered --check-source-regions fails the guard', () => {
  assert.throws(
    () =>
      check(
        reporterFlags(
          weakenedRegions('            --check-source-regions 50 \\\n'),
        ),
      ),
    /--check-source-regions is 50, below the 95/,
  );
});

test('a deleted --check-source-regions fails the guard', () => {
  assert.throws(
    () => check(reporterFlags(weakenedRegions(''))),
    /must pass --check-source-regions/,
  );
});
