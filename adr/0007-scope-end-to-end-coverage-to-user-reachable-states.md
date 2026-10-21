# ADR 0007: Scope end-to-end coverage findings to user-reachable states

- **Status**: Accepted
- **Date**: 2026-10-20
- **Tracking issue**: [#1718](https://github.com/cncf/endusers/issues/1718)
  (missing gates behind recurring Hive findings, class 2)

## Context

Two coverage lanes measure the shipped sources:

- The unit lane (`npm run test:unit:coverage:check`) requires 100% of source
  lines and 100% of source regions.
- The browser lane (the "End-to-end coverage" job in `ci.yml`) requires 100% of
  source lines and 96% of source regions, and `--require-source-files` insists
  every source file is measured. Per-file region floors were dropped in #1617.

The 4% region allowance in the browser lane is deliberate: some branches only
run when the data files are absent or malformed, and a production build never
contains that data. Reaching them in a browser means building a dedicated
fixture site for each one.

Hive's `quality` agent nevertheless treats every region the browser lane does
not reach as a defect. In the 100 issues before 2026-10-21 this produced a
steady run of "unit-covered but reached by no e2e fixture build" findings
(#1469, #1486, #1593, #1654, #1656, #1692) and pull requests that add fixture
builds or specs to reach a single defensive arm (#1688, #1693, #1717). Each one
is correct on its own terms, and each one is already pinned by a unit test.
Fixture builds are the most expensive artifact in the test tree: every one adds
a full Docusaurus build to the "End-to-end coverage" job.

A second, related shape is "branch X runs under test but nothing asserts its
outcome" (#1620, #1670, #1674, #1676, #1682, #1705). That is a real gap, but
finding it by hand one branch at a time is the work mutation testing automates,
which #1718 proposes adding.

ADR 0006 anticipated this: if test-tree work did not fall after narrowing
test-only agent work, a follow-up should revisit the coverage incentives.

## Decision drivers

- Maintainer attention is still the scarce resource (ADR 0006).
- The unit lane already guarantees every source branch executes and, once
  mutation testing lands, that its outcome is asserted.
- The browser lane exists to prove that pages and interactions work in a real
  browser, not to re-prove data-shape guards.
- Fixture builds have a recurring CI cost that unit tests do not.

## Options considered

1. **Keep accepting browser-reach work case by case.** No policy change; the
   series continues until every region is reached or the region floor is raised
   to 100%, at a fixture build per arm.
2. **Raise the browser region floor to 100%.** Makes the series mandatory for
   every future guard.
3. **Scope browser-lane findings to user-reachable states.** Keep the current
   floors, and state which unreached regions are worth an issue.

## Decision

Option 3.

1. **The unit lane is authoritative for branch behaviour.** A branch that is
   unit-covered, and whose outcome a unit test asserts, needs no browser
   coverage when it is selected only by the shape of build-time data (absent,
   null, empty or malformed files and fields).
2. **Browser-lane findings must name a user-reachable state.** An issue or pull
   request about a region the browser lane does not reach must show that an end
   user can put the page into that state through input, navigation, keyboard,
   pointer or viewport changes on a production build. Data-shape guards do not
   qualify, and no new fixture build is added to reach one.
3. **"Nothing asserts this" findings come from mutation testing.** Once the
   mutation gate proposed in #1718 is in place, an issue of the "nothing asserts
   this outcome" shape cites a surviving mutant from that report rather than a
   hand-constructed mutation.
4. **The floors do not move.** The browser lane keeps 100% source lines, 96%
   source regions and `--require-source-files`; the unit lane keeps 100% / 100%.

## Clarification: integration-boundary evidence (2026-10-21)

Decision 3 requires surviving-mutant evidence for assertion gaps in production
logic covered by the configured mutation run. It does not require inventing a
hand-constructed mutation or another mutation harness to qualify an integration
boundary the configured mutation scope or runner does not exercise.

For such boundaries, including root configuration, Actions event environments,
and dependency/compiler contracts, a finding may instead cite a reproducible
integration failure or a documented historical regression. It must identify the
production failure mode, explain why the mutation run does not exercise that
boundary, and add a regression test against the actual consumer or exported
configuration rather than only a helper or a duplicate parser.

This clarification does not relax decisions 1, 2 or 4, or ADR 0006's
restrictions on test-tree guards. It does not authorize data-shape browser
fixture builds, change coverage floors, or replace surviving-mutant evidence for
assertion gaps within mutation-covered production logic.

## Clarification: measurement attribution and provenance (2026-10-21)

The calibration in [#1752](https://github.com/cncf/endusers/issues/1752) and
provenance repair in [#1748](https://github.com/cncf/endusers/pull/1748)
motivate these evidence requirements.

A mutation result of `NoCoverage` means the configured run did not attribute
execution to that mutant; it does not by itself prove an assertion gap.
Calibrate the runner and any subprocess boundary, including active-mutant
selection and child-to-parent coverage reporting, before treating those results
as missing assertions or using them to justify mutation-scope or threshold
changes. Assertion gaps within mutation-covered production logic still require
the surviving-mutant evidence in decision 3.

Browser-coverage artifacts preserve producer identities separately from the
current reporter runtime: build-process Node/V8 identity, and capture-process
Node/V8, Playwright and browser product/V8 identities. Record producer metadata
when building or capturing and preserve it when sealing the run. Later renders,
including failure reports, retain those identities and identify the current
reporter separately. Missing legacy producer metadata remains explicitly
unknown, not inferred from the renderer. The reporter's runtime alone is not
evidence of which browser produced the raw ranges or why region counts differ.

This clarification selects no new mutation-runner architecture, expands no
mutation scope, changes no thresholds, and does not relax the existing
browser-fixture or test-tree restrictions.

## Consequences

- Hive `quality` findings that do not meet decision 2 are closed as not planned
  with a pointer to this ADR.
- Existing fixture builds stay. No fixture build is removed by this ADR; one
  that only reaches a data-shape guard may be removed later if it becomes a
  maintenance cost.
- If the browser lane's region percentage approaches its 96% floor because new
  data-shape guards accumulate, that is a signal to revisit the floor in a new
  ADR, not to add fixture builds.
