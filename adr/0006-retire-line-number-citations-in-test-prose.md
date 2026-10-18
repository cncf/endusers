# ADR 0006: Retire line-number citations in test prose and narrow test-only agent work

- **Status**: Accepted
- **Date**: 2026-10-18
- **Tracking issue**: [#1613](https://github.com/cncf/endusers/issues/1613)
  (replace the citations and delete the guard)

## Context

Prose under `tests/` has, since the end-to-end coverage lane was built, argued
for its own existence by line number: a fixture overlay's `description` names
the `src/**` line whose branch it reaches, and the spec that drives it repeats
the citation in a comment. On `main` at `381c02d` there are 84 such citations
across 37 files, almost all under `tests/e2e/`, plus two `ci.yml` citations
added by #1597.

Line numbers move on every refactor and nothing edits the prose, so
`tests/source-line-citations.test.mjs` (359 lines) was written to verify them.
It has since needed five rounds of widening, each correct on its own terms and
each prompted by a blind spot the previous round left:

| Round         | Change                                                     |
| ------------- | ---------------------------------------------------------- |
| #1444 / #1449 | Guard created after #1400 moved six cited lines            |
| #1471 / #1482 | Path-qualify every citation; refuse the bare `line N` form |
| #1579         | Drop the hand-recorded measurement the guard cross-checked |
| #1593 / #1597 | Extend to `.github/workflows/**` line numbers              |
| #1598 / #1610 | Extend the walk to `.mdx` overlay pages (closed unmerged)  |

A maintainer triage of the 100 most recent issues and 100 most recent pull
requests on 2026-10-18 put that series in context:

- 97 of the 100 issues and 65 of the 100 pull requests were filed by Hive
  agents.
- 73 of the 100 pull requests touch `tests/`; 38 touch only `tests/`. Six touch
  `src/`, nine `docs/`, three `data/`, one `blog/`.
- `tests/` is 74,122 lines against 2,157 in `src/`, 8,486 in `scripts/` and
  3,148 in `docs/`.
- 85 of the 208 unit-test files read the test tree or the `tests/tools/` harness
  rather than production code. The in-repo e2e coverage reporter is 4,639 lines
  of harness covered by 36 test files totalling 11,884 lines.

Two existing rules make this the cheapest work an agent can get merged:

1. `npm run test:unit:coverage:check` requires 100% of source lines, source
   regions and per-file source regions, and 100% of harness lines. At that
   ceiling the only coverage left to add is coverage of tests.
2. `GOVERNANCE.md` lists "test-only changes that add coverage without touching
   production code" as a low-risk merge class.

The result is a closed loop: agents write line-number prose, agents build a
guard for it, agents find the guard's gaps. None of it changes what an end user
of endusers.cncf.io sees, and every round costs maintainer review time that the
site's content, data and navigation do not get.

## Decision drivers

- Maintainer attention is the scarce resource; the repository has one active
  maintainer and a fleet of agents.
- A citation that cannot rot does not need a guard. Symbol and test names are
  checked by the compiler, the test runner and `grep`; line numbers are checked
  by nothing but a bespoke test.
- The fixture-overlay `description` contract
  (`tests/tools/e2e-data-fixtures.cjs` refuses an empty description) is worth
  keeping; only the form of the description is the problem.
- The audience rule in `AGENTS.md` applies to engineering effort as much as to
  content: work should be traceable to practitioners, architects and
  organizations running cloud native technologies.

## Options considered

1. **Merge #1610 and keep extending the guard.** Correct, cheap per round, and
   guarantees a sixth round the next time a new file type or tree carries a
   citation.
2. **Retire the convention.** Rewrite every citation to name the symbol, branch
   or workflow step it is about, then delete the guard. Removes the class rather
   than the instance; the rewrite is mechanical prose work.
3. **Also lower the coverage ceilings or remove the in-repo e2e coverage
   harness.** Addresses the deeper incentive but changes required CI checks and
   a large body of tooling at once; too much blast radius to decide alongside
   this.

## Decision

Option 2, with a scope rule so the same loop does not re-form around a different
artifact.

1. **Prose in `tests/` cites symbols, not line numbers.** A fixture
   `description`, a spec comment or a unit-test comment that explains which
   production behavior it exercises names the function, branch, selector or
   workflow step (for example "the `|| []` fallback in `CommunityPeople`'s
   roster resolution", "the `test:unit:coverage:check` step of the `validate`
   job"). Paths without line numbers remain fine. No new guard is added to
   police the new form.
2. **`tests/source-line-citations.test.mjs` is deleted** once no citation
   remains (#1613). #1598 is closed as not planned and #1610 closed unmerged;
   neither is to be reopened.
3. **Test-only agent work must name a production failure mode.** An agent-filed
   issue or pull request whose diff is confined to `tests/` must state which
   behavior in `src/`, `scripts/`, `docs/`, `data/`, `static/` or
   `.github/workflows/` would regress undetected without it. Guards over the
   test tree itself (listing reach, citation pins, measurement records,
   harness-of-harness tests) are out of agent remit unless a maintainer files
   the issue.

## Consequences

- One mechanical pull request rewrites 86 citations and removes a 359-line
  harness file (#1613). The `src/` coverage floors do not move because the guard
  is a harness file.
- Hive `quality` findings of the "guard X does not reach Y" shape are closed as
  not planned with a pointer to this ADR, unless they meet decision 3.
- `GOVERNANCE.md`'s low-risk class for test-only changes should be narrowed to
  tests that exercise production code. That is a governance edit and goes
  through the independent-review rule in a follow-up, not this ADR.
- The coverage ceilings and the in-repo e2e coverage harness are unchanged. If
  the ratio of test-tree work to product work does not fall after this ADR, a
  follow-up ADR should revisit option 3.
