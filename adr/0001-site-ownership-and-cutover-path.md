# ADR 0001: Site ownership and cutover path for endusers.cncf.io

- **Status**: Accepted
- **Status note**: Option A — the repository has been transferred to the `cncf`
  GitHub org, which is the fact GitHub's own repository metadata now confirms.
  This ADR is not aware of a separate, minuted CNCF TOC/TAB vote; if one exists,
  link it here. The remaining DNS cutover to `endusers.cncf.io` is still open —
  see "Consequences" below.
- **Date**: 2026-08-08
- **Tracking issue**: [#46](https://github.com/cncf/endusers/issues/46)

## Context

The README describes this site as "the home of the CNCF End User Community" and
the build deploys content branded `endusers.cncf.io`. At the time this ADR was
originally written:

- The source repository lived in a personal account (`castrojo/endusers`), not a
  CNCF-owned GitHub org.
- The repository's GitHub Pages homepage was `castrojo.github.io/endusers`, not
  the `endusers.cncf.io` domain.
- Content is derived from authoritative CNCF sources (cncf/architecture,
  cncf/landscape, cncf/tab), so alignment with CNCF is already a stated
  requirement (see `AGENTS.md`).

Since then, the repository has been transferred: it now lives at
[cncf/endusers](https://github.com/cncf/endusers), with GitHub Pages served at
`cncf.github.io/endusers`. The `endusers.cncf.io` domain itself is still not
wired up (no DNS record, no `static/CNAME`), so every investment in content,
SEO, and metrics still accumulates under a staging URL rather than the intended
production domain. This remaining DNS cutover is what blocks Phase 3 of the
roadmap (see `ROADMAP.md`).

## Decision drivers

- Legitimacy and community trust: an end-user-facing CNCF property should be
  unambiguously CNCF-owned.
- Maintainer bus factor: the repo currently has a single active human maintainer
  (see issue #47).
- Licensing and governance prerequisites: a LICENSE (issue #32 / PR #40) and a
  MAINTAINERS.md / governance note (issue #47) are foundational regardless of
  which option is chosen.
- Speed of iteration: the site is still assembling its content pillars
  (architectures, metrics, awards, community, events) and benefits from fast,
  low-ceremony iteration in the near term.

## Options considered

### Option A: Donate/transfer to the `cncf` GitHub org

Transfer the repository (or a clean successor) into the `cncf` org, matching the
branding already used across the site.

- **Pros**: Maximizes legitimacy; unlocks a larger maintainer pool via CNCF
  processes; makes the `endusers.cncf.io` domain claim accurate.
- **Cons**: Requires CNCF TOC/TAB buy-in and org onboarding steps; blocked on
  LICENSE and governance being in place first; timeline depends on CNCF process,
  not this repo alone.

### Option B: Stay personal as a staging/prototype

Keep the repository in the personal account for now, continue iterating quickly,
and revisit DNS/ownership once content and governance mature.

- **Pros**: No process overhead; fastest iteration; low risk of stalling content
  work while ownership is discussed.
- **Cons**: Risk of community confusion about which site is authoritative while
  the domain is referenced but not yet backed by CNCF-owned infrastructure;
  defers the decision rather than resolving it.

### Option C: Merge into an existing CNCF site repo

Fold this content into an existing CNCF property (for example the
contributor-site or cncf.io) instead of standing up a new one.

- **Pros**: Avoids maintaining a new property and its infrastructure; reuses
  existing governance and maintainer pool.
- **Cons**: Risks diluting the end-user audience and voice inside a contributor-
  or marketing-oriented site; may not fit the existing site's information
  architecture.

## Decision

**Option A (transfer to the `cncf` GitHub org) has been executed.** The
repository now lives at [cncf/endusers](https://github.com/cncf/endusers)
instead of `castrojo/endusers`, which resolves the ownership question this ADR
was tracking. This section records that fact as it is verifiable from GitHub's
repository metadata; it does not assert that a specific CNCF TOC/TAB meeting or
vote produced this outcome. If such a record exists, please link it here in a
follow-up PR.

## Proposed next step

1. ~~Open a discussion with CNCF end-user community and TAB stakeholders on the
   intended long-term home for this content~~ — superseded by the transfer. The
   outreach draft at
   [stakeholder-outreach-draft-for-0001.md](./stakeholder-outreach-draft-for-0001.md)
   is retained for historical context on the options considered.
2. Land the prerequisites shared by every option regardless of outcome: LICENSE
   (done: #32 / PR #40) and a governance/MAINTAINERS note (#47).
3. Execute the DNS cutover to `endusers.cncf.io` (add `static/CNAME`, verify the
   custom domain in GitHub Pages settings, and switch the deploy workflow's
   `SITE_URL`/`BASE_URL`), then update `ROADMAP.md` Phase 3 accordingly.

## Consequences

- The ownership question is resolved: `cncf/endusers` is the canonical,
  CNCF-owned repository.
- The remaining roadmap item that depends on ownership — DNS cutover to
  `endusers.cncf.io` and cross-linking with contribute.cncf.io/cncf.io — stays
  open until that cutover is executed.
- This ADR should be superseded (not silently edited into a different decision)
  if the chosen path changes after being recorded, so the history of the
  decision stays auditable.
