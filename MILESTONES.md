# Milestone plan for endusers.cncf.io

This document defines the GitHub milestones that back [ROADMAP.md](./ROADMAP.md)
(see PR #50) and the tracking issue #45. GitHub milestones cannot be created by
the automation that authored this plan (no API write access), so a maintainer
with write access should create them from this list, then tag the referenced
issues/PRs against the matching milestone.

Once created, this file can be deleted or trimmed to a short pointer — the
milestones themselves become the source of truth.

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

Tag issues covering:
- Architectures sync freshness indicator
- Metrics data refresh + validation gating
- Awards historical winner list verification
- Community/TAB membership and End User Group pathways
- Events listing for KubeCon + CloudNativeCon
- Blog publishing cadence

## Milestone: Phase 2 — Community and governance

**Description**: The project can outlive any single maintainer.

Tag these issues/PRs:
- #47 (MAINTAINERS.md / bus factor)
- Governance/agent-automation policy issue (if filed)
- Good-first-issue curation
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
North America 2026 (Nov 9–12, Salt Lake City) — see `LAUNCH.md` (PR #108) for
the full date-backed plan. This milestone sits alongside Phase 0–3 above; it
groups the specific issues that gate the Nov 9 announcement rather than
duplicating the phase they also belong to.

Tag these issues/PRs:
- #74, #75, #76, #77, #79, #80 (Phase 1 content pillars: metrics, events,
  awards, blog, community freshness, architectures freshness — all must be
  green by launch)
- #99 (ADR 0001 ownership decision — ratify before the announcement so it can
  name the site's permanent home)
- #90 (launch/promotion strategy: announcement channels, KubeCon timing)
- #100 (success metrics baseline + post-launch targets)
- #104 (this launch-window finding, tracking the countdown itself)

Depends on: PR #108 (LAUNCH.md) merging first, since it is the source of the
week-by-week countdown this milestone tracks.

## How to apply this plan

1. Create the four milestones above via the repo's Issues → Milestones page,
   using the descriptions verbatim.
2. For each milestone, open the linked issues/PRs and set the milestone field.
3. Close or update this file once milestones exist and are populated.
4. If a maintainer-triggered milestone-creation workflow lands (see #78), add
   the "KubeCon NA 2026 Launch" milestone to its data source so it is created
   and tagged alongside the phase milestones, not by hand afterward.
