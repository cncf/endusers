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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const REPORT_SCRIPT = 'report:e2e:coverage';
const COVERAGE_JOB = 'e2e-coverage';

// Measured on the suite this commit ships: the e2e-coverage job renders with
// `--check-source 100 --check-source-regions 96 --check-source-file-regions 66`
// and the run clears all three; the full suite measured 100.00% source lines
// and 81.43% source regions when the region gate landed (#1026, #1031),
// 91.63% source regions when the floor was ratcheted to 91 (#1105), 95.22%
// (438/460) when it was ratcheted to 95 after #1163 folded the
// crossing-region source-map drift and #1060 covered the member-directory
// toolbar arms (#1079), and 97.26% (639/657) when it was ratcheted to 96 and
// the per-file floor was added (#1232).
//
// Ceiling, as of the 651/671 run in the table below: 20 regions at zero.
// Eleven are defensive fallbacks of the #1253 class -- two fewer than the
// thirteen recorded before #1439, because CaseStudies' and RadarReports'
// separate `!generatedAt` guards collapsed into the one shared
// src/components/shared/MirrorSyncStatus.js:20 that replaced them. Five are
// guard arms that a sibling fixture build (data-no-revision, data-variant)
// demonstrably executes, yet the union never credits (#1256, #1236): the
// build that takes the arm records no deviation at the arm's own span, and
// isContradictedRegion only admits witnesses from the script that produced
// the zero. That restriction is deliberate (#1066: a different bundle maps
// the same skipped arm to a different span), so those five are a documented
// reporting residual, not a coverage gap. They are
// src/components/ReferenceArchitectures/index.js:14 and :35,
// src/components/PeopleFreshness/index.js:13, and
// src/components/GroupLinkStatus/index.js:24 (x2).
//
// Citations here are written path-qualified so that
// tests/source-line-citations.test.mjs pins them. It is the guard that exists
// for exactly the drift this paragraph kept acquiring: the five above were
// last written as bare `ReferenceArchitectures:13 and :34` and
// `GroupLinkStatus:33 (x2)`, which the scanner cannot resolve to a file and so
// never checked, and #1439 then moved every one of them -- the two
// ReferenceArchitectures guards down by one line, and GroupLinkStatus:33 to
// :24 in a file that is now 30 lines long. A residual list is the argument for
// not ratcheting the floors; an entry pointing at nothing is an argument
// nobody can check.
//
// That accounts for sixteen. The remaining four are the two the shared module
// now carries and the two this lane lost without anything going red:
//
//   * src/components/shared/MirrorSyncStatus.js:20 is residual of the #1066
//     class, as above: tests/e2e/case-studies-variant.spec.js and
//     tests/e2e/radar-reports-variant.spec.js both clear `generatedAt` to null
//     and drive it.
//   * src/components/shared/MirrorSyncStatus.js:22 is not residual. It is the
//     `!syncDate` guard, reachable only with a `generatedAt` that is truthy
//     *and* unparseable, and both overlays set the field to null, which
//     returns at :20 before :22 is evaluated. No fixture build produces that
//     shape, so no browser has ever taken it. It is unit-covered
//     (tests/case-studies-sync-status.test.mjs, "an unparseable generatedAt
//     renders no banner") and e2e-uncovered.
//   * src/lib/profile-links.mjs:68 (x2) is the whole of the 18-to-20 increase.
//     The file measured 16/16 regions -- 100% -- in the last recorded run
//     before the URL-safety refactors #1414 and #1420 rewrote websiteUrl() to
//     delegate to isSafeUrl(); it now measures 13/15 with both arms of the
//     closing `url ? url.href : null` at zero. Nothing went red: the per-file
//     floor is 66, so a file may fall from 100% to 86.67% in silence. Why the
//     two arms stopped being credited is undiagnosed -- it may be another
//     #1066 attribution artifact rather than lost browser coverage -- so it
//     is recorded here rather than classified, and tracked in #1469. The next
//     reader should know it is an open question, not a fallback somebody
//     decided was defensible.
//
// Do not set --check-source-regions above 97 or --check-source-file-regions
// above 66 (src/components/PeopleFreshness/index.js, 2/3, whose one zero is in
// that residual) without first changing the union. The aggregate stops at 96
// rather than 97 because 97 would leave one region between the floor and the
// ceiling.
//
// The per-file floor is the unit lane's --check-source-file-regions argument
// one level down: the aggregate lets roughly one region in twenty-five go
// uncovered anywhere in src/**, and nothing else stops a single file from
// holding all of that slack. At 66 it is bound by the lowest file, so it is
// a floor against a file falling, not a target.
const FLOORS = {
  '--check-source': 100,
  '--check-source-regions': 96,
  '--check-source-file-regions': 66,
};

// The Node major the floors above were measured on.
//
// Unlike the unit lane's line counts, the e2e *region* counts are a V8
// artifact that moves with the runtime, and the e2e lane never recorded which
// runtime its floors came from. The same commit, the same suite (the 40 spec
// files MEASURED_AT_SPEC_COUNT records, 356 tests under E2E_COVERAGE=1) and
// the same two fixture builds measure differently on the major ci.yml pins
// and on a newer one:
//
//   file                                      node 22.21.1   node 26.10.0
//   src/components/MemberDirectory/
//     DirectoryFreshness.js                     11/15 73.33% 11/12 91.67%
//   src/components/PeopleFreshness/index.js     2/3  66.67%    2/3  66.67%
//   src/components/CNCFProjectCard/index.js   26/26 100.00%  26/26 100.00%
//   src files (aggregate)                    651/671 97.02% 650/667 97.45%
//
// The recorded column is patch-sensitive, not just major-sensitive: ci.yml pins
// `node-version: 22`, so the job resolves the newest 22.x on the day of the
// run. MEASURED_ON_NODE_MAJOR cannot detect that, so a same-major difference
// from this table is runtime drift, not a code change.
//
// The covered counts barely move; the *denominator* does, because V8 splits
// the same expression into a different number of ranges. So the lane's
// headroom is a property of the runtime: on node 22 the aggregate is 651/671,
// which is the 97.02% that leaves --check-source-regions 96 its only workable
// value -- 97 would demand 651 of 671 exactly, a gate with no slack at all.
// The same suite on node 26 reports 97.45%, which reads like three regions of
// room. A contributor who follows CONTRIBUTING.md's local recipe on a newer
// Node reads the second column, concludes the aggregate floor can be
// ratcheted, and turns the required job red on the next denominator wobble.
//
// That makes the pinned major part of the floors' meaning, and this constant
// is what says so. `tests/dev-environment.test.mjs` already proves every
// workflow and the devcontainer agree on *a* major, but it checks agreement
// rather than value: a coordinated bump stays green there while silently
// invalidating the measurement these floors rest on. Asserting the recorded
// major against the one the e2e-coverage job actually pins turns that bump
// into a failure that names the re-measurement it requires.
//
// When the job's Node major is bumped: re-measure, update the table above and
// the floors if they moved, and set this constant in the same change.
const MEASURED_ON_NODE_MAJOR = '22';

// The number of tests/e2e/*.spec.js files the table above was measured against.
//
// MEASURED_ON_NODE_MAJOR covers one of the two inputs that move those numbers.
// The other is the suite itself: every region in the table is credited by some
// spec executing it, so adding or deleting a spec re-measures the lane whether
// or not anyone re-runs the recipe. Nothing noticed that. The table this
// constant was introduced alongside still described a 344-test suite after the
// suite had grown to 356, and so reported a node-22 aggregate of 645/663
// against an actual 651/671 -- stale in the direction that matters, because a
// contributor re-deriving the lane's headroom from it is reading numbers no
// run produces any more.
//
// A spec count is the cheapest hermetic proxy for that: it needs no browser,
// no build and no coverage run, and it moves exactly when the suite does.
// It is deliberately a proxy and not a test count -- enumerating tests means
// running Playwright's loader, which this file cannot do. Editing a spec's
// body without adding a file slips past it; adding or removing one does not.
//
// When this goes red the suite has changed shape since the table was written.
// Re-measure with the recipe in CONTRIBUTING.md on Node MEASURED_ON_NODE_MAJOR,
// update the table and any floor that moved, and set this constant in the same
// change.
const MEASURED_AT_SPEC_COUNT = 40;

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

/**
 * The Node major the `e2e-coverage` job runs its measurement on.
 *
 * Read from the job rather than from the workflow as a whole because it is
 * that job's runtime, and only that one, that produces the region counts the
 * floors are set against. A `${{ env.NODE_VERSION }}` indirection is resolved
 * against the workflow's top-level `env` so the contract survives the
 * refactor that hoists the version into one place.
 *
 * @param {string} text contents of ci.yml
 * @returns {string|null} the major, or null when the job pins none
 */
function setupNodeStep(document) {
  const steps = document.jobs[COVERAGE_JOB].steps;
  // `uses` is absent on the job's `run:` steps; stringifying undefined yields
  // a value that simply does not match, so the find needs no guard of its own.
  return steps.find((candidate) =>
    String(candidate.uses).startsWith('actions/setup-node@'),
  );
}

function coverageJobNodeMajor(text) {
  const document = parse(text);
  const declared = setupNodeStep(document)?.with?.['node-version'];
  if (declared === undefined) return null;
  const literal = String(declared);
  const fromEnv = literal.match(
    /^\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/,
  );
  if (!fromEnv) return literal.split('.')[0];
  const resolved = document.env?.[fromEnv[1]];
  if (resolved === undefined) return null;
  return String(resolved).split('.')[0];
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
      'runtime (DirectoryFreshness is 11/15 on 22.23.3 and 9/10 on 26), so the bump has ' +
      'invalidated them: re-measure with the recipe in CONTRIBUTING.md on the new ' +
      'major, update the table above and any floor that moved, and set ' +
      'MEASURED_ON_NODE_MAJOR in the same change',
  );
}

test(`the ${COVERAGE_JOB} job still runs on the Node major the floors were measured on`, () => {
  checkRuntime(workflowText);
});

/**
 * Asserts the suite the table above was measured against is the suite on disk.
 *
 * Takes the spec list as an argument rather than reading the directory itself
 * so the fixture below can drive it with a count the repository does not have:
 * a guard nobody has seen go red is indistinguishable from one that always
 * passes.
 *
 * @param {string[]} specs tests/e2e spec file names
 */
function checkSuiteShape(specs) {
  assert.equal(
    specs.length,
    MEASURED_AT_SPEC_COUNT,
    `tests/e2e now holds ${specs.length} spec files, but the measurement table in ` +
      `this file was taken against ${MEASURED_AT_SPEC_COUNT}. Every region count it ` +
      'records is credited by some spec running, so the suite changing shape ' +
      're-measures the lane: re-run the recipe in CONTRIBUTING.md on Node ' +
      `${MEASURED_ON_NODE_MAJOR}, update the table and any floor that moved, and set ` +
      'MEASURED_AT_SPEC_COUNT in the same change',
  );
}

const e2eSpecs = readdirSync(join(repoRoot, 'tests', 'e2e')).filter((name) =>
  name.endsWith('.spec.js'),
);

test('the measurement table still describes the suite on disk', () => {
  assert.ok(
    e2eSpecs.length > 0,
    'no tests/e2e spec files found; the suite-shape guard is asserting nothing',
  );
  checkSuiteShape(e2eSpecs);
});

test('the suite-shape guard fails when a spec is added or removed', () => {
  assert.throws(
    () => checkSuiteShape([...e2eSpecs, 'invented.spec.js']),
    /measurement table in this file was taken against/,
  );
  assert.throws(
    () => checkSuiteShape(e2eSpecs.slice(1)),
    /measurement table in this file was taken against/,
  );
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
  assert.ok(
    step,
    `fixture is stale: ${COVERAGE_JOB} has no actions/setup-node step`,
  );
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
  const unpinned = withCoverageJobNode((_document, step) => {
    delete step.with['node-version'];
  });
  assert.throws(() => checkRuntime(unpinned), /must pin a Node major/);
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
