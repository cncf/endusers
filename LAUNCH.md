# Launch plan: endusers.cncf.io — KubeCon NA 2026

This document is the date-backed launch plan called for by issues #90 (no
launch/promotion strategy), #100 (no success metrics), and #104 (KubeCon NA
2026 launch window). It converts those findings into a single countdown.

**Launch event**: KubeCon + CloudNativeCon North America 2026, November 9–12,
Salt Lake City. **Today (2026-08-08) is 13 weeks out — launch Monday is
2026-11-09.**

## Goals

1. Announce the site to the CNCF End User Community during KubeCon week with
   every content pillar (architectures, metrics, awards, community, events,
   blog) current as of launch day.
2. Convert launch attention into durable contribution: good-first-issues
   labeled, CONTRIBUTING path verified by a non-author, maintainer bus
   factor > 1.
3. Have the ownership question (ADR 0001, issue #46) decided before launch so
   the announcement points at the site's permanent home.

## Non-goals

- DNS cutover to endusers.cncf.io itself (Phase 3; follows the ownership
  decision — nice to have for launch, not required to announce).
- Paid promotion, swag, or a booth presence.

## Timeline (weeks are Mondays)

| Week | Date | Milestone |
|------|------|-----------|
| W-13 | 2026-08-11 | Merge LICENSE (#40) and close Phase 0; create the four GitHub milestones (#78) so every launch task is tagged |
| W-12 | 2026-08-17 | ADR 0001 ownership decision made (#46/#99) — this gates the announcement target and DNS work |
| W-11 | 2026-08-24 | Metrics refresh workflow landed (#74); events page lists KubeCon NA 2026 co-located end-user events (#75) |
| W-10 | 2026-08-31 | Awards list verified complete against cncf.io announcements (#77) |
| W-9  | 2026-09-07 | Architectures freshness indicator on-page (#80); community/TAB staleness signal (#79) |
| W-8  | 2026-09-14 | Good-first-issue curation done (#98); CONTRIBUTING walk-through by someone who didn't write it |
| W-7  | 2026-09-21 | Blog cadence resumes: first post-welcome article (#76) — end-user story or architecture deep-dive |
| W-6  | 2026-09-28 | Success-metrics baseline captured (see below) and dashboard/tracking issue live (#100) |
| W-5  | 2026-10-05 | Launch blog post drafted; announcement channels confirmed (CNCF blog/Twitter amplification, end-user Slack, TAB mailing list) |
| W-4  | 2026-10-12 | Full content freeze rehearsal: every generated-data workflow runs green end-to-end |
| W-3  | 2026-10-19 | Launch blog post reviewed; DNS cutover executed if ownership decision landed on a CNCF org (Phase 3) |
| W-2  | 2026-10-26 | Dry-run announcement to end-user community Slack; collect last-mile fixes |
| W-1  | 2026-11-02 | Final content refresh; all Phase 1 issues closed or explicitly deferred |
| W-0  | 2026-11-09 | **Launch during KubeCon NA week**: publish launch post, amplify on agreed channels, open feedback issue template |

## Success metrics (baseline + 30-day post-launch targets)

Baselines are as of 2026-08-08; capture the W-6 baseline snapshot in #100.

| Signal | Baseline (2026-08-08) | 30-day post-launch target |
|--------|----------------------|---------------------------|
| GitHub stars | 0 | 50 |
| Watchers / forks | 0 / 1 | 10 / 5 |
| Unique contributors (humans, non-bot) | 1 | 5 |
| Open good-first-issues claimed | 0 labeled | 3 claimed |
| Blog posts since launch | 0 | 2 (launch post + 1 community voice) |
| Referral from cncf.io properties | none | cross-link merged on at least one CNCF property (Phase 3) |

## Dependencies and risks

- **Ownership decision (ADR 0001)** is the critical path: without it the
  announcement can't say where the site lives permanently. If undecided by
  W-9, launch announces the current URL with an explicit "permanent home
  pending" note rather than slipping the date.
- **Merge throughput** (#58): the plan assumes the human merge gate keeps its
  current burst cadence; the W-13 and W-12 items are all merge-gated, not
  work-gated.
- **Content freshness workflows** (#74, #75, #79, #80) must be landed by W-9
  or the launch-day "every pillar current" goal fails silently.

## How to use this file

Track execution against the table above in the matching issues; when a week
slips, update the table in a PR labeled `roadmap` rather than letting the
plan drift. After KubeCon, replace this file with a launch retrospective.

---
*Filed by strategist agent (ACMM L6 — full mode). Tracks #90, #100, #104.*
