# Launch plan: endusers.cncf.io

This document is the launch plan called for by issues #90 (no launch/promotion
strategy), #100 (no success metrics), and #104 (launch window). It converts
those findings into a single ordered checklist.

The launch is **not tied to a calendar date or a specific event**. An earlier
revision of this plan was a week-by-week countdown to a conference; the
countdown slipped twice (#966, #1271) and the dates drifted from the work, so
the plan now tracks readiness rather than time. The site launches when every
gate below is satisfied, and the announcement goes out through the agreed
channels at that point. Where a conference or End User TAB meeting falls close
to readiness, use it for amplification; do not hold or rush the launch to meet
one.

## Goals

1. Announce the site to the CNCF End User Community with every content pillar
   (architectures, metrics, awards, community, events, blog) current as of
   launch day.
2. Convert launch attention into durable contribution: good-first-issues
   labeled, CONTRIBUTING path verified by a non-author, maintainer bus
   factor > 1.
3. The ownership question (ADR 0001, issue #46) is decided — the repository has
   been transferred to the `cncf` GitHub org — so the announcement can point at
   the site's permanent home; DNS cutover itself remains the Phase 3 follow-up
   (see Non-goals).

## Non-goals

- DNS cutover to endusers.cncf.io itself (Phase 3; follows the ownership
  decision — nice to have for launch, not required to announce).
- Paid promotion, swag, or a booth presence.
- A fixed launch date. Readiness, not the calendar, decides.

## Milestones (in order)

Each row is a gate. Work the list top to bottom; a row is done when its linked
issues are closed and the check described in it has been performed, not when the
date someone once guessed for it has passed.

| #   | Milestone                                                                                                                                                                                 | Status                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Merge LICENSE (#40) and close Phase 0; create the GitHub milestones (#78) so every launch task is tagged                                                                                  | Done                                                                                                                                                                                                                                                                   |
| 2   | ADR 0001 ownership decision made (#46/#99) — this gates the announcement target and DNS work                                                                                              | Done (Accepted; repository transferred to the `cncf` org)                                                                                                                                                                                                              |
| 3   | Metrics refresh workflow landed (#74); events page lists upcoming end-user events (#75)                                                                                                   | Done                                                                                                                                                                                                                                                                   |
| 4   | Awards list verified complete against cncf.io announcements (#77)                                                                                                                         | Done                                                                                                                                                                                                                                                                   |
| 5   | Architectures freshness indicator on-page (#80); community/TAB staleness signal (#79)                                                                                                     | Done                                                                                                                                                                                                                                                                   |
| 6   | Good-first-issue curation done (#98); CONTRIBUTING walk-through by someone who didn't write it                                                                                            | Done                                                                                                                                                                                                                                                                   |
| 7   | Blog has at least one post beyond the welcome post (#76), and `docs/skills/blog-management.md` describes a cadence the blog actually meets                                                | Done (`blog/2026-08-08-month-in-metrics-august-2026.md`; cadence restated in #1278)                                                                                                                                                                                    |
| 8   | Success-metrics baseline captured in `data/launch-metrics.json` and tracking issue live (#100)                                                                                            | Done (captured 2026-10-02; the file's `checkpoint.label` still carries the `W-6` name from the dated plan, which is where it was taken)                                                                                                                                |
| 9   | Launch blog post drafted; announcement channels confirmed (CNCF blog/social amplification, end-user Slack, TAB mailing list)                                                              | Done (#1313, closed 2026-10-12; the draft and the channel confirmations were handled out of band by the maintainer, so no `blog/` file records them yet — the post is committed as `blog/YYYY-MM-DD-*.md` per `docs/skills/blog-management.md` when row 11 reviews it) |
| 10  | Full content freeze rehearsal: every generated-data workflow runs green end-to-end (see the readiness gate below)                                                                         | Done (verified 2026-10-16 UTC: `refresh-community-people.yml` and `refresh-radar-reports.yml` both show their required 2-of-2 consecutive green scheduled runs still holding — community-people green on 2026-09-28, 2026-10-05, 2026-10-12; radar-reports green on 2026-10-11 through 2026-10-16 — the Netlify production deploy remains green per the pipeline table, and `refresh-metrics.yml` stays excluded from the gate by its own on-demand carve-out below)                                                                                                                                    |
| 11  | Launch blog post reviewed and committed under `blog/` (the draft from row 9); DNS cutover executed (Phase 3, #1433)                                                                       | Open                                                                                                                                                                                                                                                                   |
| 12  | Dry-run announcement to end-user community Slack; collect last-mile fixes                                                                                                                 | Open                                                                                                                                                                                                                                                                   |
| 13  | Final content refresh; all Phase 1 issues closed or explicitly deferred                                                                                                                   | Open                                                                                                                                                                                                                                                                   |
| 14  | **Launch**: publish the launch post, amplify on the agreed channels, open the feedback issue template. If a conference or TAB meeting is near, time the amplification to it, not the gate | Open                                                                                                                                                                                                                                                                   |

## Success metrics (baseline + post-launch targets)

Five of the signals below are machine-collected in `data/launch-metrics.json`
(issue #100) rather than hand-tracked here, so they can't go stale the way a
one-time table does: refresh with `npm run collect:launch-metrics`, validate
with `npm run validate:launch-metrics`. The committed baseline was captured at
milestone 8 (2026-10-02); the file's own `checkpoint` field records that capture
under the `W-6` label the dated plan used at the time. Re-run the collector
immediately before launch (milestone 13) so the 90-day comparison starts from
the numbers the announcement actually went out on. The two signals without a
GitHub API source (blog cadence, cncf.io referral) are tracked here as prose and
checked manually.

| Signal                                       | Baseline                       | 90-day post-launch target                                 | Source                     |
| -------------------------------------------- | ------------------------------ | --------------------------------------------------------- | -------------------------- |
| GitHub stars                                 | see `data/launch-metrics.json` | 50                                                        | `data/launch-metrics.json` |
| GitHub watchers                              | see `data/launch-metrics.json` | 10                                                        | `data/launch-metrics.json` |
| GitHub forks                                 | see `data/launch-metrics.json` | 5                                                         | `data/launch-metrics.json` |
| New unique human contributors since baseline | 0 (by definition)              | 5                                                         | `data/launch-metrics.json` |
| Good-first-issues claimed                    | see `data/launch-metrics.json` | 3                                                         | `data/launch-metrics.json` |
| Blog posts since launch                      | 0                              | 2 (launch post + 1 community voice)                       | manual (blog/)             |
| Referral from cncf.io properties             | none                           | cross-link merged on at least one CNCF property (Phase 3) | manual                     |

## Launch-readiness gate: zero-red content pipelines (#136)

The site's differentiator over static CNCF documentation is _living,
self-refreshing_ community data. Launching with red scheduled pipelines means
shipping stale content on day one — the exact failure this automation exists to
prevent. Before launch (milestone 14), all scheduled content-refresh workflows
must be green for **2 consecutive scheduled runs**. The default-branch
deployment is listed as a separate operational prerequisite. Statuses below were
first verified against `main` workflow runs on **2026-10-01 UTC**; rows
re-verified since then carry their own later verification date:

| Pipeline                                                                                                                                                                                                                                                                                                                           | Schedule                                                     | Status (verified 2026-10-01 UTC unless a row notes a later date)                                                                                                                                                                                                                                                                                             | Tracking                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Default-branch deployment (Netlify, from [`netlify.toml`](https://github.com/cncf/endusers/blob/main/netlify.toml); replaced [`deploy-gh-pages.yml`](https://github.com/cncf/endusers/blob/5c81e81cce24cbd0b6b38762129f699c861b716a/.github/workflows/deploy-gh-pages.yml) per [ADR 0005](./adr/0005-host-the-site-on-netlify.md)) | Every push to `main` (deploy previews on every pull request) | Green: production deploy of [#1485](https://github.com/cncf/endusers/pull/1485) serves <https://endusers.netlify.app/> with canonical and `og:url` pointing at itself; a throwaway branch with an invalid data fixture ([#1488](https://github.com/cncf/endusers/pull/1488)) failed its deploy preview, proving the validator gate (verified 2026-10-14 UTC) | Operational prerequisite                            |
| Refresh community profiles ([`refresh-community-people.yml`](https://github.com/cncf/endusers/blob/5c81e81cce24cbd0b6b38762129f699c861b716a/.github/workflows/refresh-community-people.yml))                                                                                                                                       | Weekly                                                       | Green — gate satisfied (2 of 2 consecutive scheduled runs: [2026-09-28 02:55:29 UTC](https://github.com/cncf/endusers/actions/runs/36371675678) and [2026-10-05 02:59:13 UTC](https://github.com/cncf/endusers/actions/runs/37257547433); verified 2026-10-07 UTC)                                                                                           | #568 (closed; reopen a new issue if this regresses) |
| Metrics refresh ([`refresh-metrics.yml`](https://github.com/cncf/endusers/blob/main/.github/workflows/refresh-metrics.yml); replaced the `collect:metrics` + `validate:metrics` steps of the retired `import-architectures.yml`)                                                                                                   | On-demand (`workflow_dispatch`)                              | `collect:metrics` and `validate:metrics` last succeeded as steps of the retired workflow in the [2026-09-28 02:46:46 UTC run](https://github.com/cncf/endusers/actions/runs/36371126622); no `refresh-metrics.yml` run is recorded yet                                                                                                                       | #121 (closed; reopen a new issue if this regresses) |
| Refresh radar reports ([`refresh-radar-reports.yml`](https://github.com/cncf/endusers/blob/5c81e81cce24cbd0b6b38762129f699c861b716a/.github/workflows/refresh-radar-reports.yml))                                                                                                                                                  | Daily                                                        | Green on [2026-09-28 03:04:01 UTC](https://github.com/cncf/endusers/actions/runs/36372220678), [2026-09-29 03:00:48 UTC](https://github.com/cncf/endusers/actions/runs/36515236309), and [2026-09-30 03:01:56 UTC](https://github.com/cncf/endusers/actions/runs/36662555166)                                                                                | #605 (closed; reopen a new issue if this regresses) |

The cncf/architecture content import (`import-architectures.yml`) was retired:
reference architecture pages are now generated from submission issues by
`architecture-submission.yml`, and the pages that originated upstream remain as
committed content. Its "2 consecutive scheduled runs" gate history predates both
that retirement and its earlier move from a daily cron to on-demand.

A dedicated `refresh-metrics.yml` workflow was proposed in PR #125 and declined
(#74) while metrics refresh ran as steps inside `import-architectures.yml`. With
that workflow retired, `refresh-metrics.yml` now carries those steps as an
on-demand (`workflow_dispatch`) run; it inherits the tracking issue above and is
not subject to the scheduled-run gate, since it has no schedule to run on.

Issue #121 and its predecessor for the refresh-community-people `GITHUB_TOKEN`
permission error (#122, duplicate of #519) are closed, but closing a tracking
issue does not by itself mean the pipeline is green: the status column above
must be checked against the workflow's actual run history
(`gh run list --workflow <name>`) before treating a row as resolved. The
2026-09-28 community-profile run and the architecture/metrics run both report
`contents: write` and `pull-requests: write` in their effective `GITHUB_TOKEN`
permissions and complete their `create-pull-request` steps. Issue #568 (missing
`signoff: true` on `create-pull-request` steps) was closed and the
[2026-09-28 scheduled run](https://github.com/cncf/endusers/actions/runs/36371675678)
succeeded, as did the
[2026-10-05 scheduled run](https://github.com/cncf/endusers/actions/runs/37257547433);
with two consecutive green scheduled runs the gate is satisfied for this
pipeline.

If any pipeline is still red at the final content refresh (milestone 13), treat
it the same as any other Phase 1 blocker under "Full content freeze rehearsal"
(milestone 10): either land the fix or explicitly defer the affected content
pillar in the launch post rather than presenting it as current.

## Dependencies and risks

- **Ownership decision (ADR 0001)** is resolved — Accepted, and the repository
  has been transferred to the `cncf` GitHub org. What remains on the critical
  path is executing the DNS cutover to `endusers.cncf.io` itself (Phase 3, issue
  #1433), not the decision.
- **Merge throughput** (#58): the remaining milestones are merge-gated, not
  work-gated; the plan assumes the human merge gate keeps its current burst
  cadence.
- **Content freshness workflows** (#74, #75, #79, #80) have landed — remaining
  risk is regression before launch, not initial rollout.
- **Date drift**: this plan is intentionally undated. If a launch date is ever
  reintroduced, attach it to a milestone row in a PR labeled `roadmap` and keep
  it in exactly one place so it cannot disagree with itself.

## How to use this file

Track execution against the milestone table in the matching issues. When a
milestone's status changes, update the row in a PR labeled `roadmap` rather than
letting the plan drift. After launch, replace this file with a launch
retrospective that compares `data/launch-metrics.json` against its 90-day
targets.
