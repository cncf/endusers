# Roadmap: endusers.cncf.io

This roadmap describes the planned evolution of the CNCF End User Community
site. It is a living document; update it as priorities change. Tracking: issues
labeled `roadmap`.

## Vision

Be the trusted home of the CNCF End User Community: the place where
organizations running cloud native in production find reference architectures,
metrics, events, and pathways to participate.

## Launch target

The launch is gated on readiness, not on a date or event. Earlier revisions
named a specific conference as the announcement window (issue #104); the dated
countdown slipped twice (#966, #1271) and was replaced by the ordered, dateless
milestone checklist in `LAUNCH.md`. Conferences and End User TAB meetings that
fall near readiness are amplification opportunities, not deadlines. The
ownership decision has landed (ADR 0001 is Accepted; issue #99 closed); the
remaining pre-launch dependency is the DNS cutover tracked in issue #1433.

## Guiding principles

- **Audience first**: content serves end users (adopters), not project
  contributors.
- **Data over prose**: metrics, awards, and architectures are generated from
  authoritative sources (cncf/landscape, cncf/architecture, cncf/tab), never
  hand-edited.
- **Verified facts**: every CNCF fact is backed by an authoritative source link.
- **Green pipeline**: the site must always deploy; a broken deploy blocks
  everything.

## Phase 0 — Foundation

Goal: a reliable, trustworthy site skeleton.

- [x] Restore a green deploy pipeline (#52)
- [x] Add a LICENSE (#40, issue #32)
- [x] Pin GitHub Actions by SHA and verify downloaded installers (issues #38,
      #39; PRs #42, #43, #112) — all `uses:` references across
      `.github/workflows/` are SHA-pinned; the Prince-installer workflow was
      removed
- [x] Shared validation utilities and test coverage for data pipelines (#37,
      #65)
- [x] This roadmap (#50), plus MILESTONES.md (#53)
- [x] Create GitHub milestones matching these phases (issue #78)

## Phase 1 — Content completeness

Goal: every pillar section is accurate, current, and self-maintaining.

- [x] Architectures: catalog seeded from cncf/architecture, now maintained as
      committed content with new entries arriving through the submission
      workflow (`architecture-submission.yml`); the automated upstream sync and
      its freshness indicator (issue #80) were retired once the catalog became
      submission-driven
- [x] Metrics: refresh of data/metrics.json with validation gating the build —
      issue #74 closed not-planned at the time; the on-demand
      `refresh-metrics.yml` workflow now runs
      `collect:metrics`/`validate:metrics` (documented in `LAUNCH.md`)
- [x] Awards: complete historical winner list, each entry verified against its
      cncf.io announcement (issue #77)
- [x] Community: current TAB membership, End User Groups, and engagement
      pathways — issue #79, shipped via `src/components/PeopleFreshness/` and
      `src/components/GroupLinkStatus/` rendering freshness notes from
      `data/community-people.json`'s `fetchedAt`
- [x] Events: upcoming end-user events at KubeCon + CloudNativeCon (issue #75)
- [x] Blog: establish a publishing cadence beyond the welcome post — monthly
      "Month in Metrics" post sourced from `data/metrics.json` diffs (issue #76;
      cadence documented in
      [docs/skills/blog-management.md](docs/skills/blog-management.md#publishing-cadence))

## Launch (tracking: #90) (current)

Goal: the moment Phase 1 goes green, the site is announced deliberately — not
shipped silently. Content completeness alone is not a launch plan.

- [ ] **Launch criteria**: every Phase 1 pillar (architectures, metrics, awards,
      community, events, blog) is green in CI and current as of launch day.
- [ ] **Announcement channels**: a cncf.io blog post, a mention at an End User
      TAB meeting, and a KubeCon + CloudNativeCon mention or session are the
      minimum bar; amplify further via the End User community Slack.
- [x] **Launch success metrics** (issue #100): `data/launch-metrics.json`
      defines the falsifiable signals — GitHub stars, watchers, forks, new
      unique human contributors since baseline, and good-first-issues claimed —
      each with a live-collected baseline and a 90-day post-launch target.
      Refresh with `npm run collect:launch-metrics`, validate with
      `npm run validate:launch-metrics`. The committed file is the milestone-8
      baseline (captured 2026-10-02 under the `W-6` label the earlier dated plan
      used); re-run it immediately before launch (see `LAUNCH.md`) so the 90-day
      comparison starts from the numbers the announcement went out on.
- [ ] **DNS cutover dependency**: the Phase 2 ownership decision (issue #46,
      ADR 0001) is resolved — the repository has been transferred to the `cncf`
      GitHub org — so cutover to `endusers.cncf.io` itself (Phase 3) is what
      remains gating this item.
- [ ] **90-day check-in**: re-run `npm run collect:launch-metrics` 90 days after
      launch and compare each signal against its `data/launch-metrics.json`
      baseline to record whether the launch moved the needle.

Related: #90 (this finding), #46 (ownership), #75 (events pillar), #76 (blog
cadence).

## Phase 2 — Community and governance

Goal: the project can outlive any single maintainer.

- [x] MAINTAINERS.md with an explicit process for adding maintainers (#55)
- [x] Governance note describing review/merge expectations, including
      agent-automation policy (GOVERNANCE.md, #60)
- [x] Good-first-issue curation to recruit human contributors (#98)
- [x] Decide the long-term home of the site (issue #46, ADR 0001): ADR 0001 is
      Accepted — the repository has been transferred to the `cncf` GitHub org.
      The remaining DNS cutover to `endusers.cncf.io` is tracked separately in
      Phase 3 (see `adr/0001-site-ownership-and-cutover-path.md`)

## Phase 3 — Ecosystem integration

Goal: endusers.cncf.io becomes the authoritative end-user destination.

- [ ] DNS cutover to endusers.cncf.io (depends on Phase 2 ownership decision;
      tracked in #1433, blocked on the external DNS record — the remaining ADR
      0001 step-3 action is adding the custom domain to the Netlify site and
      pointing DNS at it; see ADR 0005)
- [ ] Cross-linking with contribute.cncf.io and cncf.io (clear audience
      boundaries) (#1407). Audience boundary decided: ADR 0004. Outbound
      signposts shipped (site footer, architecture submission flow, community
      resources). Inbound-link requests against contribute.cncf.io and cncf.io
      remain open: ready-to-file drafts are in
      `adr/inbound-link-requests-for-0004.md` (origin issue #1434, closed once
      the drafts shipped), but filing is deliberately held until the DNS cutover
      (#1433) completes so requests do not point at a non-resolving URL.
- [x] Public feedback loop: content-issue templates and a visible changelog
      (#1408). Shipped: the `content-issue.yml` report form and a changelog
      generated at build time (`adr/0003-public-changelog-mechanism.md`), both
      linked from the site footer. The fallback-page caveat from the GitHub
      Pages era (#1409) no longer applies: since the move to Netlify (ADR 0005,
      #1485, #1489) the deploy checkout carries full git history, and the
      deployed changelog renders real dated entries.

## Non-goals

- Contributor-facing documentation (belongs on contribute.cncf.io)
- Project-facing marketing for individual CNCF projects
- Client-specific or proprietary framing of any kind

## How this roadmap is maintained

- Strategic gaps and reprioritizations are filed as GitHub issues by the
  strategist agent and reviewed by the maintainer.
- Each phase maps to a GitHub milestone; issues and PRs are tagged accordingly.
- This document is updated by planning PRs, not ad hoc edits.
