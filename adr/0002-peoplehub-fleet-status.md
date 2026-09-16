# ADR 0002: peoplehub fleet status — pause agent work

- **Status**: Accepted
- **Date**: 2026-08-08
- **Tracking issue**: [#97](https://github.com/castrojo/endusers/issues/97)

## Context

`peoplehub` (`castrojo/peoplehub`) is one of five repositories in the hive agent
fleet alongside this one (see `scripts/fleet-merge-queue-digest.mjs`). As of
this ADR:

- The default branch has not been pushed to since **2026-06-16** (53 days).
- **14 mergeable PRs** are queued against it, including a build-breaking bug
  fixed twice by independent agents (`#29`, opened 2026-05-01, duplicated by
  `#45`, opened 2026-08-08 — three months apart because nothing merged in
  between), several feature PRs (social feed, MCP server, two Slack-bot
  variants, tool-of-the-day curation, AI-pillar curation), and dependency bumps
  dating back to `#32` (2026-06-16).
- The hive App's GitHub installation is scoped to `endusers` only, so agent PRs
  opened against `peoplehub` cannot be merged by the same automation path used
  here regardless of their content.
- Every fleet sweep re-discovers and re-reports the same stale queue (see `#58`,
  `#81`), spending agent compute on a repository whose maintainer has not
  engaged with it in nearly two months.

This repository does not have push access to `peoplehub` and cannot merge,
close, or rebase PRs there. This ADR does not take any action against
`peoplehub` itself — it records the fleet-level decision and rationale in the
one repository the agent fleet can currently write to, per `AGENTS.md`'s
guidance that cross-repo hive configuration "lives elsewhere and cannot be
corrected with a PR here."

## Options considered

### Option A: Revive

Merge the build fix (`#45` or `#29`) first, close the duplicate, then triage the
remaining 12 PRs by value, and resume a regular review cadence.

- **Pros**: Unblocks real feature work already sitting mergeable; lowest
  disruption to contributors who already opened PRs.
- **Cons**: Requires sustained maintainer attention peoplehub has not received
  in 53 days; nothing in this decision changes that attention budget going
  forward, so reviving without a committed cadence just resets the dormancy
  clock.

### Option B: Pause (recommended)

Stop the agent fleet from filing new work against `peoplehub` until a human
maintainer re-engages; close PRs that have gone stale past the merge-queue
hygiene threshold (`GOVERNANCE.md`'s 48-hour conflict/30-day staleness guidance,
applied here since no maintainer has triaged the queue at all).

- **Pros**: Stops negative-expected-value agent work (rot, rebase churn,
  repeated re-reporting) immediately; costs nothing to reverse if a maintainer
  wants to revive the repo later — no PRs or code are destroyed, only new
  agent-filed work is suspended.
- **Cons**: The 14 open PRs remain unresolved in the interim; contributors who
  opened dependency-bump and feature PRs get no immediate resolution.

### Option C: Archive

Archive the repository outright and remove it from the fleet's scope.

- **Pros**: Fully stops compute and attention spend; unambiguous signal to
  contributors.
- **Cons**: Irreversible-in-spirit (un-archiving is possible but signals project
  death); premature given 14 mergeable PRs represent real, wanted feature work
  and the repo owner has not indicated abandonment, only inattention.

## Decision

**Pause.** Archiving is too strong a signal for a repo with 14 mergeable,
apparently wanted feature PRs and no stated intent to abandon it; reviving
without a maintainer commitment would just repeat the same 53-day dormancy
cycle. Pausing is the only option that is both immediately actionable by this
ADR (it changes agent behavior, not `peoplehub`'s code or PR queue) and
reversible without cost.

Concretely, until a `peoplehub` maintainer re-engages:

1. The hive agent fleet should stop opening new PRs against `peoplehub`.
2. The weekly fleet digest (`scripts/fleet-merge-queue-digest.mjs`, `#81`)
   should keep reporting `peoplehub`'s queue depth and dormancy so the pause is
   visible and not forgotten, without individual agents each re-filing the same
   finding.
3. This ADR's status should move to Superseded, with a new ADR recording the
   outcome, if a maintainer chooses to revive or archive the repository instead.

## Consequences

- The 14 open PRs against `peoplehub` are left as-is by this decision; this ADR
  does not close or merge any of them, since this repository has no write access
  there.
- Future strategist sweeps should treat `peoplehub` as paused (not silently
  re-file the same dormancy finding) until this ADR is superseded.
- If `peoplehub` gains a re-engaged maintainer, Option A's staged approach
  (merge the build fix first, close the duplicate, then triage by value) becomes
  the concrete first step of reviving it.
