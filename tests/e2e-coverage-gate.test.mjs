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
import { enumerateSourceFiles } from './tools/coverage-report.mjs';

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
// Ceiling, measured on the current tree (645/661, 97.58%): 16 regions at
// zero. Measured by the e2e-coverage job itself rather than a local run:
// actions/runs/38788348099, job 116606094620, artifact `e2e-coverage`,
// report.json runId 38788348099-1, head 5265cb8586e180d8dc7d347b444fdf43bbd22e04.
// Eight are defensive fallbacks of the #1253 class:
// src/components/CaseStudies/index.js:48,
// src/components/CommunityPeople/index.js:134,
// src/components/GroupLinkStatus/index.js:14,
// src/components/MemberDirectory/DirectoryFreshness.js:19,
// src/components/MetricsDashboard/index.js:65,
// src/components/MetricsDashboard/index.js:85,
// src/components/RadarReports/index.js:8 and
// src/components/hooks/useFocusTrap.js:35. Three are guard arms that a
// sibling fixture build (data-no-revision, data-variant) demonstrably
// executes, yet the union never credits (#1256, #1236):
// src/components/PeopleFreshness/index.js:13 and
// src/components/GroupLinkStatus/index.js:24 (x2). (ReferenceArchitectures'
// two SyncStatus arms used to sit in this list; the cncf/architecture sync
// and the provenance line it fed were removed, so they are gone rather than
// credited. DirectoryFreshness.js:30, :44 and :49 used to sit in the
// fallback list above and are credited in this run: the data-no-revision
// build now exists for DirectoryFreshness alone, and the run records its
// plain-text `cncf/architecture` arm and the two guards beside it as
// taken.) The build that takes the
// arm records no deviation at the arm's own span, and isContradictedRegion
// only admits witnesses from the script that produced the zero. That
// restriction is deliberate (#1066: a different bundle maps the same skipped
// arm to a different span), so the three are a documented reporting residual,
// not a coverage gap. Every citation above is path-qualified so
// tests/source-line-citations.test.mjs can see it; the previous revision of
// this note cited bare `GroupLinkStatus:33`-style lines, which that guard
// deliberately cannot resolve, and #1439 moved every one of them with
// nothing going red.
//
// The remaining five zeros are:
//
//   src/components/shared/MirrorSyncStatus.js:20 -- the same residual
//     class. #1439 folded CaseStudies' and RadarReports' separate
//     !generatedAt guards into this shared one, which is one reason the
//     fallback count above has fallen from the thirteen this note used to
//     say: two zeros (CaseStudies' and RadarReports' own guards) became
//     one. Its browser
//     witness is now tests/e2e/fixtures/data-variant/radar-reports.json
//     alone: that overlay still clears the field to JSON null, and the
//     case-studies overlay beside it no longer does (see the entry below).
//   src/components/shared/MirrorSyncStatus.js:22 (x2) -- was NOT a residual,
//     and is one now. The !syncDate arm is reachable only with a generatedAt
//     that is truthy and unparseable; until this note was edited no fixture
//     build produced that shape -- both overlays set the field to null,
//     which returns at src/components/shared/MirrorSyncStatus.js:20 first --
//     so it was unit-covered by tests/case-studies-sync-status.test.mjs and
//     reached by no browser at all.
//     tests/e2e/fixtures/data-variant/case-studies.json now carries an
//     unparseable string instead of null, and
//     tests/e2e/case-studies-variant.spec.js asserts the variant page drops
//     the provenance line without rendering "Invalid Date". The arm is
//     therefore browser-executed; whether the union credits it is the #1066
//     question the other zeros in this list turn on, and nothing here
//     changes that.
//   src/lib/profile-links.mjs:68 (x2) -- a residual of the same family,
//     diagnosed in #1469; not lost browser coverage. #1414/#1420 rewrote
//     websiteUrl() onto isSafeUrl(), so the closing
//     `return url ? url.href : null` is now a ternary whose two arms share
//     one line. In the bundle that holds the community-people dialog the
//     CommunityPeople fixture persons drive both arms: one page records
//     the then-arm at zero (the fixture whose blog does not parse) and
//     another the else-arm at zero (the valid and bare-host blogs), and
//     V8 emits no range for the arm each page does take, because it runs
//     at its enclosing code's count. Each arm is therefore covered only by
//     absence, and the absence inference in isContradictedRegion rejects a
//     witness when any zero touches the region's lines; on a one-line
//     ternary the sibling arm's zero always does. The two arms
//     disqualify each other, so both stay at zero in the union.
//     Reproduced on the full 356-test suite: 13/15, 86.67%, uncovered
//     regions [68, 68]. The file's other 13 regions, including every
//     branch of isSafeUrl's caller above line 68, are covered. Narrowing
//     that exclusion to the zero's own span is a change to the union and
//     is not made here; until then this is a reporting residual.
//
// Do not set --check-source-regions above 96 or
// --check-source-file-regions above 66 without first changing the union. One
// file sits exactly on that per-file floor and all of its zeros are in the
// residual: src/components/shared/MirrorSyncStatus.js at 6/9
// (src/components/PeopleFreshness/index.js, which used to share the floor at
// 2/3, reads 3/4 in this run -- the denominator moved, not the code; see
// MEASURED_ON_NODE_MAJOR). The aggregate stays at 96 rather than 97: 97 would
// demand 642 of 661, and the 645 the run records clears that by three
// regions, which is inside the same-major runtime wobble documented below
// and not room to ratchet on.
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
// runtime its floors came from. One commit, one suite and the same two fixture
// builds measure differently on the major ci.yml pins and on a newer one. The
// two-column comparison below was taken on the tree that introduced this
// constant -- it is kept as the demonstration that the runtime moves the
// numbers, not as a description of the tree shipping now, whose node-22
// figures are the ones recorded in the ceiling note above:
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
// headroom is a property of the runtime: the aggregate above cleared 97% on
// node 22 by a single region and read 97.45% on node 26, which looks like
// three regions of room. A contributor who follows CONTRIBUTING.md's local
// recipe on a newer Node reads the second column, concludes the aggregate
// floor can be ratcheted, and turns the required job red on the next
// denominator wobble -- which is what the tree before #1527 (655/676,
// 96.89%, measured on node 22) would have done immediately, and what the
// current tree's three-region margin over 97 leaves exposed to.
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
//
// 39 -> 38: tests/e2e/technical-community-groups.spec.js was removed when the
// Platform Engineering page moved under docs/community/user-groups/ and the
// Technical Community Groups directory went with it. That spec drove only a
// Docusaurus generated-index route, which (as its own header recorded)
// executes no src/** source of its own, so the table above is carried over
// unchanged rather than re-measured.
//
// 38 -> 39: tests/e2e/community-landing.spec.js was added for the section-card
// grid on docs/community/index.md. Re-measured with the CONTRIBUTING.md recipe
// on node 22.23.3 -- the major this file records -- twice against the same two
// fixture builds, once with the new spec and once without it, so the spec's own
// effect is separated from the tree's:
//
//   file                                      without spec    with spec
//   src/components/MemberDirectory/
//     DirectoryFreshness.js                     11/15 73.33% 11/14 78.57%
//   src/components/PeopleFreshness/index.js      3/4  75.00%   2/3  66.67%
//   src files (aggregate)                    648/665 97.44% 647/663 97.59%
//
// No floor moved: the aggregate clears 96 either way and the lowest file stays
// src/components/shared/MirrorSyncStatus.js at 6/9 (66.67%), the per-file floor
// this note already says not to ratchet past. The table above is therefore
// carried over rather than rewritten -- it was taken by the e2e-coverage job
// itself, with the artifact provenance recorded beside it, and a local render
// is not an equal substitute for that.
//
// The two files that moved are the two this note already names as the lane's
// unstable denominators, and they moved the way it describes: the covered
// counts barely change while V8 splits the same expressions into a different
// number of ranges once a differently-shaped union of scripts is captured.
// src/components/PeopleFreshness/index.js oscillates between the 2/3 recorded
// in the node-22 column above and the 3/4 the ceiling note records; both read
// at or above the per-file floor, which is why the floor is 66 and not 75.
//
// 39 -> 38: tests/e2e/legacy-urls.spec.js was removed with the unlisted
// compatibility stubs it exercised (/members, /awards, /metrics and the
// /community/* pre-reorganisation paths). The site is not public yet, so
// there were no inbound links to keep alive. The stubs were plain Markdown
// docs that mounted no src/** component, and every onward destination the
// spec clicked through to is loaded by another spec, so the table above is
// again carried over unchanged.
//
// 38 -> 39: tests/e2e/architecture-submit.spec.js was added for
// /architectures/submit, the one listed sidebar doc route no other spec
// loaded. The table above is carried over unchanged, for the reason the two
// entries above give for doing so rather than by re-measuring: that route is
// a plain Markdown doc. Its body is hand-written markup -- the `pillar` and
// `benefit` card grids -- compiled by MDX into static elements, and it mounts
// no src/** component of its own. The only src/** module that executes on it
// is src/theme/Footer/index.js, which is on every page of the site and is
// already driven by tests/e2e/footer.spec.js, so the new spec moves no src/**
// region into or out of the covered set on its own account.
//
// What a local run cannot settle is the denominator: a differently-shaped
// union of captured scripts re-splits the same expressions, which is the
// wobble the PeopleFreshness and DirectoryFreshness notes above describe, and
// only the e2e-coverage job itself measures it. No floor is moved here on the
// strength of a guess -- the job runs on every pull request, and if the union
// shifts a file under its floor it says so by name.
const MEASURED_AT_SPEC_COUNT = 39;

// The number of src/** modules the table above was measured against.
//
// The spec count covers the half of the suite's shape that lives in
// tests/e2e. The other half is the measured tree itself: the aggregate is a
// ratio over the src/** modules the run observed, so splitting one module into
// two re-measures the lane without touching a spec. Nothing noticed that
// either. #1439 extracted src/components/shared/MirrorSyncStatus.js and
// src/components/shared/initials.js out of their callers, which moved the
// node-22 aggregate from 651/671 to 655/676 and put a second file on the
// per-file floor, and every guard in this file stayed green -- the note above
// had already recorded the symptom ("#1439 moved every one of them with
// nothing going red") without the guard that would have caught it.
//
// Counted with enumerateSourceFiles(), the same walker the e2e reporter uses
// for --require-source-files, restricted to src/ because that is the only tree
// the reporter admits coverage for. That makes it as hermetic as the spec
// count: no browser, no build, no coverage run. It is a count and not a file
// list for the reason the spec count is -- editing a module's body without
// adding or removing a file slips past it, which is the residual the ceiling
// note's own citations are there to absorb.
//
// When this goes red the measured tree has changed shape since the table was
// written. Re-measure with the recipe in CONTRIBUTING.md on Node
// MEASURED_ON_NODE_MAJOR, update the table and any floor that moved, and set
// this constant in the same change.
//
// 24 -> 25: #1539 extracted src/components/shared/useFilterToolbar.js out of
// CaseStudies, MemberDirectory and ArchitectureFilters to share their
// search/filter state logic. The full CONTRIBUTING.md e2e-coverage recipe was
// re-run on Node 22 (chromium, 208/208 e2e specs passing) and the unit lane
// already holds every src file at 100% lines/regions; the floors below are
// left unchanged because nothing in that run came within sight of them.
const MEASURED_AT_SOURCE_MODULE_COUNT = 25;

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

/**
 * Asserts the src/** tree the table above was measured against is the tree on
 * disk.
 *
 * Takes the module list as an argument for the reason checkSuiteShape does: a
 * guard nobody has seen go red is indistinguishable from one that always
 * passes.
 *
 * @param {string[]} modules repo-relative src/** module paths
 */
function checkSourceShape(modules) {
  assert.equal(
    modules.length,
    MEASURED_AT_SOURCE_MODULE_COUNT,
    `src/ now holds ${modules.length} modules, but the measurement table in ` +
      `this file was taken against ${MEASURED_AT_SOURCE_MODULE_COUNT}. The ` +
      'aggregate it records is a ratio over the src modules the run observed, ' +
      'so splitting or folding one re-measures the lane without touching a ' +
      'spec: re-run the recipe in CONTRIBUTING.md on Node ' +
      `${MEASURED_ON_NODE_MAJOR}, update the table and any floor that moved, and set ` +
      'MEASURED_AT_SOURCE_MODULE_COUNT in the same change',
  );
}

const sourceModules = enumerateSourceFiles(repoRoot).filter((file) =>
  file.startsWith('src/'),
);

test('the measurement table still describes the src tree on disk', () => {
  assert.ok(
    sourceModules.length > 0,
    'no src/ modules found; the source-shape guard is asserting nothing',
  );
  checkSourceShape(sourceModules);
});

test('the source-shape guard fails when a src module is added or removed', () => {
  assert.throws(
    () => checkSourceShape([...sourceModules, 'src/components/Invented.js']),
    /measurement table in this file was taken against/,
  );
  assert.throws(
    () => checkSourceShape(sourceModules.slice(1)),
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
