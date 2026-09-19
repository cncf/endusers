# Milestone plan for endusers.cncf.io

This document defines the five GitHub milestones that back
[ROADMAP.md](./ROADMAP.md) (see PR #50) and the tracking issue #45. The plan is
also encoded in [`data/milestones.json`](./data/milestones.json).

A maintainer can create or reuse all five milestones and apply their issue and
pull request assignments in one click by running the **Create milestones**
workflow from the Actions tab. Re-running it is safe: it finds open and closed
milestones by title and preserves existing issue milestones unless `retag` is
enabled.

## Milestone: Phase 0 — Foundation

**Description**: A reliable, trustworthy site skeleton: green deploys, a
license, supply-chain hygiene, and this planning infrastructure.

Tag these issues/PRs:

- #44 (deploy blocker)
- #32, PR #40 (LICENSE)
- #38, #39, PRs #41–#43 (pin actions by SHA / verify installers)
- #36, PR #37 (shared validation utilities + test coverage)
- #45 (this roadmap/milestones issue), PR #50 (ROADMAP.md)

## Milestone: Phase 1 — Content completeness

**Description**: Every content pillar (architectures, metrics, awards,
community, events, blog) is accurate, current, and self-maintaining.

Tag these issues:

- #74 (metrics data refresh + validation gating)
- #75 (events listing for KubeCon + CloudNativeCon)
- #76 (blog publishing cadence)
- #77 (awards historical winner list verification)
- #79 (community/TAB membership and End User Group pathways)
- #80 (architectures sync freshness indicator)

## Milestone: Phase 2 — Community and governance

**Description**: The project can outlive any single maintainer.

Tag these issues/PRs:

- #47 (MAINTAINERS.md / bus factor)
- PR #60 (governance/agent-automation policy)
- #98 (good-first-issue curation)
- #46 (long-term ownership decision)

## Milestone: Phase 3 — Ecosystem integration

**Description**: endusers.cncf.io becomes the authoritative end-user
destination.

Tag issues/PRs covering:

- DNS cutover to endusers.cncf.io
- Cross-linking with contribute.cncf.io and cncf.io
- Content-issue templates and a public changelog

## Milestone: KubeCon NA 2026 Launch

**Description**: Cross-cutting launch milestone for KubeCon + CloudNativeCon
North America 2026 (Nov 9–12, Salt Lake City).

See `LAUNCH.md` (PR #108) for the full date-backed plan. This milestone tracks
launch-specific coordination. The six content-pillar issues
(#74, #75, #76, #77, #79, and #80) remain in Phase 1 because GitHub supports
one milestone per issue;
the launch milestone depends on that phase instead of duplicating those
assignments.

Tag these issues:

- #99 (ADR 0001 ownership decision — ratify before the announcement so it can
  name the site's permanent home)
- #90 (launch/promotion strategy: announcement channels, KubeCon timing)
- #100 (success metrics baseline + post-launch targets)
- #104 (this launch-window finding, tracking the countdown itself)

Depends on: the Phase 1 milestone and PR #108 (LAUNCH.md), which provides the
week-by-week countdown this milestone tracks.

## How to apply this plan

1. In the Actions tab, open **Create milestones** and select **Run workflow**.
2. Leave `retag` disabled to preserve issue and pull request milestones that are
   already set. Enable it only when the assignments in this file should replace
   existing assignments.
3. Confirm that all five milestones exist and contain the expected items.

As a manual fallback, create the five milestones from the repository's Issues →
Milestones page, using the descriptions above, then apply each listed issue and
pull request assignment.
