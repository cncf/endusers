# Roadmap: endusers.cncf.io

This roadmap describes the planned evolution of the CNCF End User Community site.
It is a living document; update it as priorities change. Tracking: issues labeled `roadmap`.

## Vision

Be the trusted home of the CNCF End User Community: the place where
organizations running cloud native in production find reference architectures,
metrics, events, and pathways to participate.

## Launch target

**KubeCon + CloudNativeCon North America 2026 (Nov 9–12, Salt Lake City)** is
the target announcement window (see issue #104): the largest concentration of
CNCF end users this year, and every Phase 1 content pillar is exactly what
that audience looks for. The week-by-week backwards plan lives in
`LAUNCH.md` (PR #108); the ownership decision that must land before the
announcement is tracked in ADR 0001 / issue #99.

## Guiding principles

- **Audience first**: content serves end users (adopters), not project
  contributors.
- **Data over prose**: metrics, awards, and architectures are generated from
  authoritative sources (cncf/landscape, cncf/architecture, cncf/tab), never
  hand-edited.
- **Verified facts**: every CNCF fact is backed by an authoritative source link.
- **Green pipeline**: the site must always deploy; a broken deploy blocks
  everything.

## Phase 0 — Foundation (current)

Goal: a reliable, trustworthy site skeleton.

- [x] Restore a green deploy pipeline (#52)
- [x] Add a LICENSE (#40, issue #32)
- [ ] Pin GitHub Actions by SHA and verify downloaded installers (issues #38, #39; PRs #42, #43, #112 open)
- [x] Shared validation utilities and test coverage for data pipelines (#37, #65)
- [x] This roadmap (#50), plus MILESTONES.md (#53)
- [ ] Create GitHub milestones matching these phases (issue #78)

## Phase 1 — Content completeness

Goal: every pillar section is accurate, current, and self-maintaining.

- [ ] Architectures: automated import from cncf/architecture stays in sync (scheduled workflow exists; add freshness indicator on the page — issue #80)
- [ ] Metrics: scheduled refresh of data/metrics.json with validation gating the build (issue #74)
- [x] Awards: complete historical winner list, each entry verified against its cncf.io announcement (issue #77)
- [ ] Community: current TAB membership, End User Groups, and engagement pathways (issue #79)
- [ ] Events: upcoming end-user events at KubeCon + CloudNativeCon (issue #75)
- [x] Blog: establish a publishing cadence beyond the welcome post — monthly "Month in Metrics" post sourced from `data/metrics.json` diffs (issue #76; cadence documented in [docs/skills/blog-management.md](docs/skills/blog-management.md#publishing-cadence))

## Launch (tracking: #90)

Goal: the moment Phase 1 goes green, the site is announced deliberately — not
shipped silently. Content completeness alone is not a launch plan.

- [ ] **Launch criteria**: every Phase 1 pillar (architectures, metrics, awards,
      community, events, blog) is green in CI and current as of launch day.
- [ ] **Announcement channels**: a cncf.io blog post, a mention at an End User
      TAB meeting, and a KubeCon + CloudNativeCon mention or session are the
      minimum bar; amplify further via the End User community Slack.
- [ ] **Baseline metrics snapshot**: capture stars, watchers, forks, and unique
      human contributors immediately before announcing, so launch impact is
      measurable rather than assumed. As of 2026-08-08 the baseline is 0 stars,
      0 watchers, 1 fork.
- [ ] **DNS cutover dependency**: cutover to `endusers.cncf.io` is gated on the
      Phase 2 ownership decision (issue #46, ADR 0001). If undecided by launch,
      the announcement links the current GitHub Pages URL instead of slipping
      the date.
- [ ] **30-day check-in**: compare stars/watchers/forks/contributors against the
      baseline snapshot and record whether the launch moved the needle.

Related: #90 (this finding), #46 (ownership), #75 (events pillar), #77 (blog
cadence).

## Phase 2 — Community and governance

Goal: the project can outlive any single maintainer.

- [x] MAINTAINERS.md with an explicit process for adding maintainers (#55)
- [x] Governance note describing review/merge expectations, including agent-automation policy (GOVERNANCE.md, #60)
- [ ] Good-first-issue curation to recruit human contributors
- [ ] Decide the long-term home of the site (issue #46, ADR 0001): transfer to a CNCF org,
      remain a personal staging site, or merge into an existing CNCF property. Decision deadline: 2026-08-17
      (see `adr/0001-site-ownership-and-cutover-path.md` for the documented options and path)

## Phase 3 — Ecosystem integration

Goal: endusers.cncf.io becomes the authoritative end-user destination.

- [ ] DNS cutover to endusers.cncf.io (depends on Phase 2 ownership decision)
- [ ] Cross-linking with contribute.cncf.io and cncf.io (clear audience
      boundaries)
- [ ] Public feedback loop: content-issue templates and a visible changelog

## Non-goals

- Contributor-facing documentation (belongs on contribute.cncf.io)
- Project-facing marketing for individual CNCF projects
- Client-specific or proprietary framing of any kind

## How this roadmap is maintained

- Strategic gaps and reprioritizations are filed as GitHub issues by the
  strategist agent and reviewed by the maintainer.
- Each phase maps to a GitHub milestone; issues and PRs are tagged accordingly.
- This document is updated by planning PRs, not ad hoc edits.
