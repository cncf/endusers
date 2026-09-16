# ADR 0001: Site ownership and cutover path for endusers.cncf.io

- **Status**: Accepted
- **Date**: 2026-08-08
- **Decision date**: 2026-09-16
- **Decision deadline**: 2026-08-17 (Missed/superseded by transfer to `cncf` org on 2026-09-16)
- **Tracking issue**: [#46](https://github.com/cncf/endusers/issues/46)

## Context

The README describes this site as "the home of the CNCF End User Community" and
the build deploys content branded `endusers.cncf.io`.

Originally, the source repository lived in a personal account (`castrojo/endusers`)
with GitHub Pages deployed to `castrojo.github.io/endusers`.
In September 2026, Option A was enacted: the canonical repository was transferred
to the CNCF organization as [cncf/endusers](https://github.com/cncf/endusers),
with staging GitHub Pages deployed to `cncf.github.io/endusers`.

With CNCF organization ownership established, the project is officially housed
under CNCF infrastructure. The remaining operational milestone is Phase 3:
the DNS cutover to `endusers.cncf.io`.
Resolving ownership removes the strategic risk around repo longevity and contributor
recruitment, fulfilling the Phase 2 milestone (see `ROADMAP.md`).

## Decision drivers

- Legitimacy and community trust: an end-user-facing CNCF property should be
  unambiguously CNCF-owned.
- Maintainer bus factor: the repo currently has a single active human
  maintainer (see issue #47).
- Licensing and governance prerequisites: a LICENSE (issue #32 / PR #40) and a
  MAINTAINERS.md / governance note (issue #47) are foundational regardless of
  which option is chosen.
- Speed of iteration: the site is still assembling its content pillars
  (architectures, metrics, awards, community, events) and benefits from fast,
  low-ceremony iteration in the near term.

## Options considered

### Option A: Donate/transfer to the `cncf` GitHub org

Transfer the repository (or a clean successor) into the `cncf` org, matching
the branding already used across the site.

- **Pros**: Maximizes legitimacy; unlocks a larger maintainer pool via CNCF
  processes; makes the `endusers.cncf.io` domain claim accurate.
- **Cons**: Requires CNCF TOC/TAB buy-in and org onboarding steps; blocked on
  LICENSE and governance being in place first; timeline depends on CNCF
  process, not this repo alone.

### Option B: Stay personal as a staging/prototype

Keep the repository in the personal account for now, continue iterating
quickly, and revisit DNS/ownership once content and governance mature.

- **Pros**: No process overhead; fastest iteration; low risk of stalling
  content work while ownership is discussed.
- **Cons**: Risk of community confusion about which site is authoritative
  while the domain is referenced but not yet backed by CNCF-owned
  infrastructure; defers the decision rather than resolving it.

### Option C: Merge into an existing CNCF site repo

Fold this content into an existing CNCF property (for example the
contributor-site or cncf.io) instead of standing up a new one.

- **Pros**: Avoids maintaining a new property and its infrastructure; reuses
  existing governance and maintainer pool.
- **Cons**: Risks diluting the end-user audience and voice inside a
  contributor- or marketing-oriented site; may not fit the existing site's
  information architecture.

## Decision
**Accepted (Option A: Transfer to the `cncf` GitHub org).**

The repository has been transferred to the CNCF organization as
`cncf/endusers` (canonical non-fork repository), and `castrojo/endusers` has
become a personal fork. The default GitHub Pages staging host is now
`cncf.github.io/endusers`.

This resolves the strategic ownership question raised in issue #46: the site
is officially an upstream CNCF property, enabling broader community maintainership
and governance under the CNCF umbrella.

Remaining work is operational and tracked under Phase 3:
1. DNS cutover to `endusers.cncf.io`.
2. Updating GitHub Pages custom domain / CNAME once DNS verification is complete.

## Proposed next step

1. Transfer to `cncf` org: **Completed**. Canonical repository is `cncf/endusers`.
2. Prerequisites: LICENSE (done: #32 / PR #40) and governance/MAINTAINERS (done: #47, #55, #60).
3. Next: Execute Phase 3 DNS cutover to `endusers.cncf.io` and configure custom domain in Pages.
4. Stakeholder outreach draft (`0001-stakeholder-outreach-draft.md`) is archived/retained for historical context.

## Consequences

- Repository ownership is settled under `cncf/endusers`.
- Phase 2 ownership gating milestone is complete.
- Phase 3 (DNS cutover to `endusers.cncf.io` and cross-linking with CNCF properties) is unblocked.
- This ADR should be superseded (not silently edited into a different
  decision) if the chosen path changes after being recorded, so the history of
  the decision stays auditable.
