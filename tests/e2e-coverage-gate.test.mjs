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
import { parse, stringify } from 'yaml';
import {
  findNodeSetupStep,
  loadLocalActions,
  nodeMajor,
  pinnedNodeVersion,
} from './helpers-node-setup.mjs';
import { readWorkflow } from './helpers-workflows.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const REPORT_SCRIPT = 'report:e2e:coverage';
const COVERAGE_JOB = 'e2e-coverage';
const localActions = loadLocalActions(repoRoot);

// Floors, not measurements. The live numbers -- aggregate, per file, and the
// regions the union cannot credit -- are in the `e2e-coverage` artifact the
// job publishes on every run, and CONTRIBUTING.md gives the recipe for a
// local render. They are deliberately not copied here: an earlier revision of
// this file carried a per-line record of one run's ceiling, and every src/**
// edit or added spec stranded it, so it was re-measured by hand roughly once
// a day (#1444, #1447, #1468, #1471, #1497, #1535, #1563) while guarding
// nothing the gate itself did not already enforce.
//
// The aggregate region floor sits a few regions under what the job records.
// That margin is the same-major runtime wobble described at
// MEASURED_ON_NODE_MAJOR, not room to ratchet on. The per-file floor is bound
// by the lowest file, whose uncovered regions are a documented reporting
// residual (#1066, #1469): it is a floor against a file falling, not a target.
// Raise either only after reading the job's own artifact on the pinned major.
const FLOORS = {
  '--check-source': 100,
  '--check-source-regions': 96,
  '--check-source-file-regions': 66,
};

// The Node major the floors above were measured on.
//
// The e2e *region* counts are a V8 artifact that moves with the runtime: the
// same commit, suite and fixture builds split into a different number of
// ranges on a different Node, so the denominator shifts while the covered
// count barely does. A contributor who renders locally on a newer Node reads
// headroom the gate does not have, ratchets a floor to match, and turns the
// required job red on the next denominator wobble. The counts also move
// between patch releases of the same major, so a small same-major difference
// from the artifact is runtime drift, not a code change.
//
// That makes the pinned major part of the floors' meaning. tests/dev-environment
// proves every workflow agrees on *a* major; this asserts the value, so a
// coordinated bump fails here and names the re-measurement it requires.
// When the job's Node major is bumped: re-measure from the job's artifact,
// update the floors if they moved, and set this constant in the same change.
const MEASURED_ON_NODE_MAJOR = '22';

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

const workflowText = readWorkflow('ci.yml').source;

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

/**
 * The Node major the `e2e-coverage` job runs its measurement on.
 *
 * Read from the job rather than from the workflow as a whole because it is
 * that job's runtime, and only that one, that produces the region counts the
 * floors are set against. The job installs Node through the
 * `setup-node-deps` composite action, so the version is resolved by
 * helpers-node-setup.mjs: a `with.node-version` on the step (literal or
 * `${{ env.* }}`) wins, otherwise the action's input default is the pin.
 *
 * @param {string} text contents of ci.yml
 * @returns {string|null} the major, or null when the job pins none
 */
function setupNodeStep(document) {
  return findNodeSetupStep(document.jobs[COVERAGE_JOB].steps, localActions);
}

function coverageJobNodeMajor(text) {
  const document = parse(text);
  const step = setupNodeStep(document);
  if (!step) return null;
  return nodeMajor(pinnedNodeVersion(step, document, localActions));
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

/**
 * Asserts the measurement the floors rest on still describes the job.
 *
 * Split out of the test so the fixtures below can drive it with a mutated
 * workflow: a guard nobody has seen go red is indistinguishable from one that
 * always passes.
 *
 * @param {string} text contents of ci.yml
 */
function checkRuntime(text) {
  const pinned = coverageJobNodeMajor(text);
  assert.ok(
    pinned,
    `${COVERAGE_JOB} must pin a Node major on its setup-node step; the floors above ` +
      'are region counts, and V8 splits the same expression into a different number ' +
      'of ranges on a different runtime, so an unpinned job measures nothing stable',
  );
  assert.equal(
    pinned,
    MEASURED_ON_NODE_MAJOR,
    `${COVERAGE_JOB} now runs on Node ${pinned}, but the floors in this file were ` +
      `measured on Node ${MEASURED_ON_NODE_MAJOR}. e2e region counts move with the ` +
      'runtime, so the bump has invalidated them: re-measure from the e2e-coverage ' +
      'artifact on the new major, update any floor that moved, and set ' +
      'MEASURED_ON_NODE_MAJOR in the same change',
  );
}

test(`the ${COVERAGE_JOB} job still runs on the Node major the floors were measured on`, () => {
  checkRuntime(workflowText);
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
  const original = '            --check-source-regions 96 \\\n';
  assert.ok(
    workflowText.includes(original),
    'fixture is stale: ci.yml no longer renders with --check-source-regions 96',
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
    /--check-source-regions is 50, below the 96/,
  );
});

test('a deleted --check-source-regions fails the guard', () => {
  assert.throws(
    () => check(reporterFlags(weakenedRegions(''))),
    /must pass --check-source-regions/,
  );
});

// The per-file floor is the one a reviewer is most likely to wave through a
// drop in, because it reads as low already; the fixture proves 66 is a floor
// the guard holds, not a default it tolerates moving.
function weakenedFileRegions(replacement) {
  const original = '            --check-source-file-regions 66 \\\n';
  assert.ok(
    workflowText.includes(original),
    'fixture is stale: ci.yml no longer renders with --check-source-file-regions 66',
  );
  return workflowText.replace(original, replacement);
}

test('a lowered --check-source-file-regions fails the guard', () => {
  assert.throws(
    () =>
      check(
        reporterFlags(
          weakenedFileRegions(
            '            --check-source-file-regions 50 \\\n',
          ),
        ),
      ),
    /--check-source-file-regions is 50, below the 66/,
  );
});

test('a deleted --check-source-file-regions fails the guard', () => {
  assert.throws(
    () => check(reporterFlags(weakenedFileRegions(''))),
    /must pass --check-source-file-regions/,
  );
});

// The same proof for the runtime guard. These fixtures edit the parsed
// document and re-serialise it rather than patching the YAML text: several
// jobs pin the same `node-version: 22`, so a textual replace rewrites
// whichever one happens to come first in the file instead of the one
// e2e-coverage uses, and would pass while proving nothing.
function withCoverageJobNode(mutate) {
  const document = parse(workflowText);
  const step = setupNodeStep(document);
  assert.ok(step, `fixture is stale: ${COVERAGE_JOB} has no Node setup step`);
  step.with ??= {};
  mutate(document, step);
  return stringify(document);
}

test('bumping the job Node major fails the runtime guard', () => {
  const bumped = withCoverageJobNode((_document, step) => {
    step.with['node-version'] = 24;
  });
  assert.equal(coverageJobNodeMajor(bumped), '24', 'fixture is stale');
  assert.throws(
    () => checkRuntime(bumped),
    /now runs on Node 24, but the floors in this file were measured on Node 22/,
  );
});

test('an unpinned job Node major fails the runtime guard', () => {
  // Through the composite action an absent `with.node-version` falls back to
  // the action's default, so "unpinned" means calling setup-node directly
  // with no version at all.
  const unpinned = withCoverageJobNode((_document, step) => {
    step.uses = 'actions/setup-node@' + 'f'.repeat(40);
    delete step.with['node-version'];
  });
  assert.throws(() => checkRuntime(unpinned), /must pin a Node major/);
});

test('the composite action default is what pins the job when the step passes nothing', () => {
  const defaulted = withCoverageJobNode((_document, step) => {
    assert.ok(
      String(step.uses).startsWith('./.github/actions/'),
      'fixture is stale: the coverage job no longer installs Node through a local action',
    );
    delete step.with['node-version'];
  });
  assert.equal(coverageJobNodeMajor(defaulted), MEASURED_ON_NODE_MAJOR);
  assert.doesNotThrow(() => checkRuntime(defaulted));
});

test('a NODE_VERSION indirection is resolved against the workflow env', () => {
  const matching = withCoverageJobNode((document, step) => {
    document.env = {
      ...(document.env ?? {}),
      NODE_VERSION: MEASURED_ON_NODE_MAJOR,
    };
    step.with['node-version'] = '${{ env.NODE_VERSION }}';
  });
  assert.doesNotThrow(() => checkRuntime(matching));

  const bumped = withCoverageJobNode((document, step) => {
    document.env = { ...(document.env ?? {}), NODE_VERSION: 24 };
    step.with['node-version'] = '${{ env.NODE_VERSION }}';
  });
  assert.throws(() => checkRuntime(bumped), /now runs on Node 24/);
});

test('a NODE_VERSION indirection the workflow never defines fails the runtime guard', () => {
  const dangling = withCoverageJobNode((document, step) => {
    assert.equal(
      document.env,
      undefined,
      'fixture is stale: ci.yml now declares a top-level env, so this fixture ' +
        'must clear NODE_VERSION from it rather than rely on there being none',
    );
    step.with['node-version'] = '${{ env.NODE_VERSION }}';
  });
  assert.throws(() => checkRuntime(dangling), /must pin a Node major/);
});
