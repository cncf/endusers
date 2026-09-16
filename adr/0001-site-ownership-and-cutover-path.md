# ADR 0001: Site ownership and cutover path for endusers.cncf.io

- **Status**: Proposed
- **Date**: 2026-08-08
- **Decision deadline**: 2026-08-17 (LAUNCH.md week W-12; see "Decision" below)
- **Tracking issue**: [#46](https://github.com/castrojo/endusers/issues/46)

## Context

The README describes this site as "the home of the CNCF End User Community" and
the build deploys content branded `endusers.cncf.io`. In practice today:

- The source repository lives in a personal account (`castrojo/endusers`), not a
  CNCF-owned GitHub org.
- The repository's GitHub Pages homepage is `castrojo.github.io/endusers`, not
  the `endusers.cncf.io` domain.
- Content is derived from authoritative CNCF sources (cncf/architecture,
  cncf/landscape, cncf/tab), so alignment with CNCF is already a stated
  requirement (see `AGENTS.md`), but there is no CNCF org ownership, no DNS
  cutover, and no documented governance decision.

Until this is resolved, every investment in content, SEO, and metrics
accumulates in a property whose long-term home is undecided. This is a
strategic risk for adoption and for contributor recruitment, and it blocks
Phase 2/3 of the roadmap (see `ROADMAP.md`, PR #50).

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

Not yet made. This ADR exists to record the options and their tradeoffs so
that CNCF end-user/TAB stakeholders and the repo owner can make an informed
decision. The decision itself belongs to the owner and CNCF stakeholders, not
to automated tooling.

To keep this from stalling silently (see issue #99), a decision deadline is
recorded above: **2026-08-17**. This date is not a default answer — it is the
point by which the owner and CNCF stakeholders should have picked among
Options A, B, and C (or explicitly extended the deadline in a follow-up PR to
this ADR). `LAUNCH.md` treats this ADR's decision as its W-12 gating
milestone, since the announcement plan cannot name the site's permanent home
until this is resolved.

If the deadline passes without a decision, the fallback is Option B (stay
personal) by default, purely to avoid blocking Phase 1/2 content work — this
default does not close the ADR or set Status to Accepted, it just documents
what "no decision yet" means operationally for downstream work.

## Proposed next step

1. Open a discussion with CNCF end-user community and TAB stakeholders on the
   intended long-term home for this content (see options above). A
   ready-to-send outreach draft, with suggested venues and stakeholders, is
   available at [0001-stakeholder-outreach-draft.md](./0001-stakeholder-outreach-draft.md)
   (proposed in PR #113).
2. Land the prerequisites shared by every option regardless of outcome:
   LICENSE (done: #32 / PR #40) and a governance/MAINTAINERS note (#47).
3. By the decision deadline above, update this ADR's Status and Decision
   sections, link the outcome from `ROADMAP.md` Phase 2, and open the
   follow-up issues/PRs needed to execute it (org transfer, DNS cutover, or
   content merge).

## Consequences

- Until a decision is recorded here, roadmap items that depend on ownership
  (DNS cutover, cross-linking with contribute.cncf.io/cncf.io) remain blocked
  by design.
- This ADR should be superseded (not silently edited into a different
  decision) if the chosen path changes after being recorded, so the history of
  the decision stays auditable.
