// What the committed data overlays do to the gate that governs the file they
// patch.
//
// tests/e2e-data-fixture-integrity.test.mjs establishes the properties the
// directory alone can establish: an overlay names a real data file, still
// applies to it, still changes it, and still says which source arm it exists
// to reach. None of those asks what the merged document *is*. An overlay that
// applies cleanly and changes something can still produce a document that
// `scripts/validate-<name>.mjs` -- the gate every pull request runs over the
// real file -- would reject.
//
// Several of them deliberately do. Clearing `metrics.generatedAt` or emptying
// `community-people.fetchedAt` is the whole point of the variant build: the
// degraded arm is only reachable from a document the collector is not supposed
// to produce. That is a legitimate thing for a fixture to be, and it is not
// the hazard here.
//
// The hazard is that it is invisible. The rejection an overlay intends and a
// rejection it acquired by accident look identical from CI, because nothing
// runs a validator over a merged fixture at all:
//
//   * A validator that gains a rule -- a new required field, a tightened URL
//     host list -- starts rejecting every overlay that appends a record. The
//     fixture still applies, still patches, still builds, and the arm it holds
//     open is still reached, so no test says anything; but the fixture record
//     now describes a shape the real file may no longer hold, and the browser
//     coverage it buys is coverage of a document the site cannot ship.
//   * An overlay written against the validator's rules can drift out of them
//     without being edited. `tests/e2e/fixtures/data/members.json` already has:
//     its description states that its appended record "is valid per
//     MEMBERSHIP_STATUSES in scripts/validate-members.mjs", and the merged
//     document is in fact rejected, because the status it carries now requires
//     source roles the empty `membershipSources` does not supply.
//   * An overlay whose deliberate invalidity is silently repaired -- a cleared
//     timestamp that a later edit restores -- stops reaching the guard arm it
//     was committed for, which is the same silent retirement the integrity
//     test's "still changes the document" case exists to catch one level up.
//
// So this file records the rejections rather than forbidding them. Each
// overlay's effect on its validator is pinned exactly: the set of errors the
// merged document produces that the real document does not. An overlay that
// starts or stops being rejected, or is rejected for a different reason, fails
// here with the reason on the record, and the fix is either the fixture or one
// line of this table -- but it is a decision someone made.
//
// Errors are compared as a *delta* against the same validator run over the
// unmodified `data/` tree, not as an absolute set. The sandbox mirrors
// `scripts/` and `data/` but not `static/`, so asset-existence rules report
// against both runs alike; subtracting the baseline removes every finding that
// is a property of the sandbox rather than of the overlay.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';

import {
  DATA_DIR,
  FIXTURE_DIR,
  applyOverlay,
  coverageBuildNames,
  overlayDirFor,
} from './tools/e2e-data-fixtures.cjs';
import { runScriptInSandbox } from './helpers-script-sandbox.mjs';

// The gate that governs each overlayable data file. Keyed by the data file
// rather than by the overlay so a second overlay of the same file -- which is
// what a new `data-<name>/` build directory is -- inherits the mapping without
// an edit. A data file with no entry is a failure below rather than a skip:
// an overlay whose merged document nothing validates is the case this file
// exists to make impossible.
const VALIDATORS = new Map([
  ['awards.json', 'validate-awards.mjs'],
  ['case-studies.json', 'validate-case-studies.mjs'],
  ['community-groups.json', 'validate-community-groups.mjs'],
  ['community-people.json', 'validate-community-people.mjs'],
  ['members.json', 'validate-members.mjs'],
  ['metrics.json', 'validate-metrics.mjs'],
  ['radar-reports.json', 'validate-radar-reports.mjs'],
]);

// One entry per committed overlay, keyed `<fixture dir>/<data file>`.
//
// `adds` is the exact set of validator errors the merged document produces
// that the unmodified file does not, written as the validator prints them
// (without the `[error] ` prefix). An empty list states the stronger property:
// the overlay leaves the document passing everything it already passed.
//
// `why` is prose for the reader of a failure, not an assertion. It says what
// the degraded shape is for, so that a diff removing an entry can be read as
// the claim it is: that the arm no longer needs a document the gate rejects.
const EXPECTED = new Map([
  [
    'data/case-studies.json',
    {
      why: 'appends two undated studies to reach the comparator fallbacks; the records carry no url, which the duplicate-url rule reports as missing',
      adds: ['900002: missing or duplicate url'],
    },
  ],
  [
    'data/community-groups.json',
    {
      why: 'appends one archived group, which is a shape the real file may legitimately hold',
      adds: [],
    },
  ],
  [
    'data/community-people.json',
    {
      why: 'appends four staff profiles carrying website shapes no real profile has; they are not on the upstream roster, carry a local image, and two carry no public profile link',
      adds: [
        'people.staff: Coverage Fixture Absent Website has no public profile link',
        'people.staff: Coverage Fixture Absent Website image must be an https URL on an allowed host: "/img/favicon.svg"',
        'people.staff: Coverage Fixture Absent Website is not on the roster',
        'people.staff: Coverage Fixture Bare Host Website image must be an https URL on an allowed host: "/img/favicon.svg"',
        'people.staff: Coverage Fixture Bare Host Website is not on the roster',
        'people.staff: Coverage Fixture Person has no public profile link',
        'people.staff: Coverage Fixture Person image must be an https URL on an allowed host: "/img/favicon.svg"',
        'people.staff: Coverage Fixture Person is not on the roster',
        'people.staff: Coverage Fixture Unparseable Website image must be an https URL on an allowed host: "/img/favicon.svg"',
        'people.staff: Coverage Fixture Unparseable Website is not on the roster',
      ],
    },
  ],
  [
    'data/members.json',
    {
      why: 'appends the only member-and-contributor organization so MemberCard renders that label; the record carries no membershipSources, which the status requires',
      adds: [
        'coverage-fixture-org: member-and-contributor status must carry both source roles',
      ],
    },
  ],
  [
    'data/metrics.json',
    {
      why: 'patches metric values only, so the document stays within every rule the real one satisfies',
      adds: [],
    },
  ],
  [
    'data-no-revision/metrics.json',
    {
      why: 'clears sources.architectures.revision to reach the absent-revision guard in ReferenceArchitectures; the gate requires that revision',
      adds: ['metrics.json: source revisions are required'],
    },
  ],
  [
    'data-variant/awards.json',
    {
      why: 'clears verifiedAt to drop the provenance paragraph from AwardsTimeline',
      adds: [
        'awards.json: verifiedAt must be a parseable date recording the last completeness audit against verifiedAgainst',
      ],
    },
  ],
  [
    'data-variant/case-studies.json',
    {
      why: 'clears generatedAt and empties caseStudies to reach the empty-corpus arms',
      adds: [
        'case-studies.json: caseStudies must be a non-empty array',
        'case-studies.json: generatedAt must be a parseable date',
      ],
    },
  ],
  [
    'data-variant/community-groups.json',
    {
      why: "makes checkedAt unparseable to reach formatDate's NaN guard in GroupLinkStatus",
      adds: ['community-groups.json: checkedAt must be ISO 8601'],
    },
  ],
  [
    'data-variant/community-people.json',
    {
      why: 'empties fetchedAt to reach both return-null arms of PeopleFreshness',
      adds: ['community-people.json: fetchedAt must be strict ISO 8601'],
    },
  ],
  [
    'data-variant/members.json',
    {
      // Recorded as an empty delta because that is what the gate does today,
      // not because the shape is benign: DirectoryFreshness renders
      // sources.landscape.collectedAt and validate-members.mjs never reads it,
      // unlike every sibling validator's document-level timestamp. If that gap
      // is closed this entry gains the new error, which is the signal.
      why: 'makes sources.landscape.collectedAt unparseable to degrade the DirectoryFreshness note; validate-members.mjs does not check that field',
      adds: [],
    },
  ],
  [
    'data-variant/metrics.json',
    {
      why: 'clears generatedAt and five collections to reach the empty fallbacks in MetricsDashboard and ReferenceArchitectures',
      adds: ['metrics.json: generatedAt must be ISO 8601'],
    },
  ],
  [
    'data-variant/radar-reports.json',
    {
      why: 'clears generatedAt and empties radarReports to reach the empty-corpus arms',
      adds: [
        'radar-reports.json: generatedAt must be a parseable date',
        'radar-reports.json: radarReports must be a non-empty array',
      ],
    },
  ],
]);

// Every data file as the sandbox should see it, so a validator that reads more
// than the file its name suggests still finds the rest of the tree.
const REAL_DATA = Object.fromEntries(
  readdirSync(DATA_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [
      `data/${name}`,
      readFileSync(join(DATA_DIR, name), 'utf8'),
    ]),
);

/** The `[error]` lines of a validator run, with the prefix removed. */
function errorsOf({ stdout, stderr }) {
  return `${stdout}\n${stderr}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('[error]'))
    .map((line) => line.slice('[error]'.length).trim());
}

/** Runs one validator over a data tree, returning its error lines. */
function validate(script, fixtures) {
  return errorsOf(runScriptInSandbox({ script, fixtures }));
}

// What each validator already reports against the unmodified tree. Computed
// once per validator so the per-overlay delta below costs one run each.
const baselines = new Map();
function baselineFor(script) {
  if (!baselines.has(script))
    baselines.set(script, new Set(validate(script, REAL_DATA)));
  return baselines.get(script);
}

/** Every committed overlay as `<fixture dir>/<data file>` -> absolute path. */
function committedOverlays() {
  const dirs = [
    ['data', FIXTURE_DIR],
    ...coverageBuildNames().map((name) => [
      `data-${name}`,
      overlayDirFor(name),
    ]),
  ];
  const found = new Map();
  for (const [label, dir] of dirs)
    for (const name of readdirSync(dir).filter((entry) =>
      entry.endsWith('.json'),
    ))
      found.set(`${label}/${name}`, join(dir, name));
  return found;
}

const OVERLAYS = committedOverlays();

test('every committed overlay patches a data file some validator gates', () => {
  const ungated = [...OVERLAYS.keys()]
    .filter((key) => !VALIDATORS.has(basename(key)))
    .sort();
  assert.deepEqual(
    ungated,
    [],
    'a committed overlay patches a data file with no entry in VALIDATORS, so nothing checks what the merged document becomes. Add the gate that governs that file.',
  );
});

test('every committed overlay is registered with its validator effect', () => {
  assert.deepEqual(
    [...OVERLAYS.keys()].sort(),
    [...EXPECTED.keys()].sort(),
    'the committed overlays and the EXPECTED table disagree. Add the new overlay with the validator errors its merged document produces, or drop the entry whose overlay is gone.',
  );
});

// Only the overlays the two inventory tests above have already accounted for.
// A fixture they report on is named by their failure, not by a second one
// here raising on a missing table entry.
const REGISTERED = [...OVERLAYS].filter(
  ([key]) => EXPECTED.has(key) && VALIDATORS.has(basename(key)),
);

for (const [key, overlayPath] of REGISTERED) {
  const expected = EXPECTED.get(key);
  const dataFile = basename(key);
  const script = VALIDATORS.get(dataFile);

  test(`${key} affects ${script} exactly as recorded`, () => {
    const data = JSON.parse(readFileSync(join(DATA_DIR, dataFile), 'utf8'));
    const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
    const merged = applyOverlay(data, overlay, key);

    const baseline = baselineFor(script);
    const added = validate(script, {
      ...REAL_DATA,
      [`data/${dataFile}`]: JSON.stringify(merged, null, 2),
    })
      .filter((message) => !baseline.has(message))
      .sort();

    assert.deepEqual(
      [...new Set(added)],
      [...expected.adds].sort(),
      `${key} no longer affects ${script} the way it is recorded to (${expected.why}). ` +
        'An overlay that gained a rejection describes a shape the real file may no longer hold, so the browser coverage it buys is coverage of a document the site cannot ship. ' +
        'An overlay that lost one has stopped producing the degraded document its arm needs. Fix the fixture, or record the new effect here with the reason.',
    );
  });
}
