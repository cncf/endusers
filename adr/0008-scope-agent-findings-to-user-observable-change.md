# ADR 0008: Scope agent findings to user-observable change

- **Status**: Accepted
- **Date**: 2026-10-23
- **Tracking issue**: [#1788](https://github.com/cncf/endusers/issues/1788)
  (trend analysis of the last 100 issues and PRs)
- **Related**: [ADR 0006](./0006-retire-line-number-citations-in-test-prose.md),
  [ADR 0007](./0007-scope-end-to-end-coverage-to-user-reachable-states.md)

## Context

The site at endusers.cncf.io is launched (DNS cutover 2026-10-22, #1433) and its
content is stable. The repository is not: in the ten days to 2026-10-23 the Hive
fleet opened 138 of the last 150 issues, at a steady 15 a day, and of the 80
pull requests merged since 2026-10-17, 65 changed only `tests/`, `scripts/`,
`.github/` or root markdown. One changed `docs/`. By filing agent, the issues
split as quality 62, architect 26, sec-check 17, guide 11, scanner 9, strategist
6, ci-maintainer 4.

ADR 0006 narrowed test-only work and ADR 0007 narrowed browser-coverage
findings. Both were read and honoured, and the fleet moved to the adjacent
categories each left open:

- The `quality` agent files against metrics that have no terminal value:
  surviving mutants in the weekly full-tree Stryker report, including mutants in
  the test harness that tests the tests (#1819, #1838, #1840) and in the
  mutation runner itself (#1843); the 4% browser-lane region allowance; and the
  clone count. Every gate the repository added to settle an earlier series (the
  mutation harness in #1729, the accepted-regions registry in ADR 0007) became
  the next series' evidence.
- The `architect` agent files any byte-identical CSS or validation block as a
  defect, and re-files decided questions: the `.freshnessNote` rule decided in
  #1669 was filed again as #1681, #1683 and #1814.
- The `strategist` agent turned every unchecked bullet in the planning documents
  into a tracking issue. Those documents were retired in #1841; this ADR records
  why they should not come back in another form.
- Hive's finding-folding merges unrelated findings into an existing issue when
  they cite the same file, and the pull request for the folded part then carries
  `Fixes` for an issue it does not fix (#1829 and #1839, #1837 and #1838).

ADR 0007 also shows the failure mode of a scoping ADR: its decisions carried
qualifiers ("unless there is surviving-mutant evidence", "integration-boundary
evidence", "accepted regions"), and each qualifier became its own series of
issues (#1736, #1752, #1811) and an amendment within two days. A remit written
as policy with exceptions is read as an invitation to explore the exceptions.

The Hive configuration that sets the agent roster, the schedule, the autonomy
level and the folding behaviour lives outside this repository (`AGENTS.md`,
"Hive Configuration"). What this repository controls is the remit statement the
agents read, and the thresholds they measure themselves against.

## Decision drivers

- Maintainer attention is the scarce resource (ADR 0006, ADR 0007). Every
  agent-filed issue costs a triage decision whether or not it is acted on.
- The site is the product. Work on the test tree is justified only by the
  regression in the site it would catch.
- The gates already in place (unit and browser coverage, mutation score on
  changed files, clone ceilings, advisory allowlist, content-security
  validators) block regressions. They do not need to be driven to a limit.
- A bright line that is occasionally too strict costs one maintainer-filed
  issue. A nuanced line costs a series.

## Options considered

1. **Keep narrowing category by category.** ADR 0006 and ADR 0007 each closed
   one series; the fleet opened the next. The pattern does not converge.
2. **Change the Hive configuration.** Reduce the schedule, drop `quality` and
   `architect` to advisory mode, or disable folding. This is the complete fix
   but is not controlled from this repository, and it leaves no written rule for
   an agent that is later re-enabled.
3. **State one remit in terms of user-observable change, freeze the metric
   thresholds, and mirror the rule where agents read it.** Controllable from
   this repository, applies to every agent, and composes with option 2 if the
   Hive maintainers take it up.

## Decision

Option 3. The rules below are bright lines. They have no "unless" clauses on
purpose; a case that seems to need one is a maintainer-filed issue, not an agent
interpretation.

1. **An agent-filed issue or pull request must name one of these effects.**
   - A defect an end user can observe on the production site: wrong, missing or
     stale content; a broken link, redirect or navigation; a rendering,
     accessibility or performance fault.
   - A security or supply-chain exposure: a bypass of a content gate, token or
     secret handling, a dependency advisory, a workflow permission.
   - A required CI check failing on `main`, or across open pull requests for a
     reason unrelated to them.
   - A generated-data refresh or dependency update through its existing lane
     (`validate:*`, Dependabot).
   - An issue a maintainer filed or labelled for agent work.

2. **Everything else is out of remit.** In particular, a change whose only
   effect is to move a repository metric is out of remit: mutation score or
   surviving-mutant count, unit or browser coverage, clone count or duplication
   percentage, test-prose shape, harness structure. So is a restructuring of
   tests, scripts, CSS or workflows that no effect under rule 1 depends on. An
   agent that notices such a thing may leave one comment on the advisory issue
   (#23). It does not open an issue or a pull request.

3. **The thresholds are frozen.** They are regression gates, not targets, and a
   change to any of them is a maintainer-authored amendment to this ADR:
   - Unit lane: 99% lines, 100% source lines, 96% regions, 100% source regions;
     `tests/tools/` 100% lines, 99% regions, 98% regions per harness file.
   - Browser lane: 100% source lines, 96% source regions, with the
     accepted-regions registry of ADR 0007.
   - Mutation: `break` 90 on the files a pull request changes; the scheduled
     full-tree report is a maintainer artifact, and a mutant surviving in it is
     not a finding under rule 1.
   - Clones: `CLONE_CEILING` 245 and `CSS_YAML_CLONE_CEILING` 35. A clone under
     the ceiling is not a finding. The ceilings still fall when a change that
     was in remit anyway happens to remove clones, so the headroom is not spent
     on new copies; nobody removes clones to make them fall.

4. **A decided question stays decided.** A decision recorded in an ADR, or by a
   maintainer on a closed issue or pull request, binds every later finding on
   the same rule, file or component, however it is worded. A new finding on that
   subject is a comment on the original, not a new issue. The maintainer closes
   any re-filing as not planned with a pointer to the decision.

5. **Folded findings do not close their host.** A pull request that addresses a
   finding folded into an existing issue says `Refs #N` for that issue, never
   `Fixes`, `Closes` or `Resolves`, unless it also completes the issue's own
   deliverable.

6. **No planning checklists in the tree.** Roadmaps, milestone lists and launch
   plans are not kept as markdown in this repository, and an agent does not file
   tracking issues for unchecked bullets in prose. Open work is the open issue
   list.

## Consequences

- `AGENTS.md` ("Guidelines for Agents") and `GOVERNANCE.md` ("Agent-automation
  policy") carry rules 1, 2, 4 and 5 in the same words, because those are the
  files agents quote back.
- Open agent-filed issues and pull requests that fail rule 1 are closed as not
  planned with a pointer to this ADR. The two consolidated pull requests already
  in flight on 2026-10-23 (#1845 and #1846) are finished rather than discarded;
  nothing new of their shape is opened.
- The `sec-check`, `guide` and `ci-maintainer` findings of the last ten days
  (MDX gate bypasses, a token on `argv`, broken community-group links, a
  required check failing fleet-wide) all pass rule 1 and continue unchanged.
- Decision 3 of ADR 0007 said "nothing asserts this" findings cite a surviving
  mutant. Rule 2 narrows that: the mutant is evidence for a finding that already
  meets rule 1, not a finding on its own.
- This ADR does not change the schedule, autonomy level or folding behaviour of
  the fleet. If the issue rate does not fall materially within 30 days (by
  2026-11-23, measured as agent-filed issues per agent against the counts in
  Context), the remaining lever is the Hive configuration, and that request goes
  to the Hive maintainers with this ADR attached.
