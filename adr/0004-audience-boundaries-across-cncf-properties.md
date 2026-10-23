# ADR 0004: Audience boundaries across endusers.cncf.io, contribute.cncf.io, and cncf.io

- **Status**: Accepted
- **Date**: 2026-10-13
- **Tracking issue**: [#1407](https://github.com/cncf/endusers/issues/1407)

## Context

Three CNCF web properties overlap in subject matter but serve different readers:

- **endusers.cncf.io** (this repository): practitioners, architects, and
  organizations _adopting and running_ cloud native in production. The audience
  boundary is already stated for authors in `CONTRIBUTING.md` ("Content
  audience") and `AGENTS.md` ("Audience"), but neither document enumerates which
  content types belong on which property, and the site has no reader-facing
  signpost for a visitor who lands here looking for contributor material.
- **contribute.cncf.io**: project _contributors_ — people writing code,
  reviewing PRs, or joining a project's governance. Today this site links out to
  it in exactly two places (`docs/community/awards.md`,
  `src/components/AwardsTimeline`), both about the awards nomination process,
  which is itself contributor-facing.
- **cncf.io**: the foundation's front door — press, membership, the project
  landscape, and foundation-level governance. This site already links to
  `https://www.cncf.io/` from structured data (`docusaurus.config.js`'s
  `organization.url`) but has no content-level cross-linking policy.

Issue #1407 asks for "a short decision record ... enumerating which content
types live on which property" as the first of three deliverables (the other two
— outbound links and an inbound-link request list — are separate,
implementation-level follow-ups and are out of scope here).

## Decision

| Content type                                                                                                                              | Home property                         | Rationale                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Reference architectures, adoption metrics, end-user awards, TAB/End User Group membership, end-user-facing events                         | endusers.cncf.io                      | Generated from authoritative sources for an adopter audience (this repo's guiding principle: "data over prose")  |
| Project contribution guides, "good first issue" finding, project governance docs, CLA/DCO mechanics                                       | contribute.cncf.io                    | Contributor audience; out of scope per this repo's own `CONTRIBUTING.md` "Content audience" section              |
| Foundation membership, press and brand, the full project landscape, foundation-level events (KubeCon logistics, foundation annual report) | cncf.io                               | Foundation-wide audience, not specific to either adopters or contributors                                        |
| Awards _nomination process_ (as opposed to the published winner list)                                                                     | contribute.cncf.io (linked from here) | Nominating is a contribution act; the published list of winners stays here as adopter-facing recognition content |

Consequences for this repository:

- Any new page or component here that primarily addresses _how to contribute_
  (file an issue against a CNCF project, join a working group, submit code)
  should link out to contribute.cncf.io rather than restate that guidance, per
  the existing "prefer linking over restating" content guideline.
- Any new page or component here that primarily addresses _foundation-wide_
  concerns (membership tiers, press contacts, the full landscape) should link
  out to cncf.io rather than restate that guidance.
- Content that is specific to CNCF's end-user adopter audience — reference
  architectures, metrics, awards-as-recognition, End User Group and TAB
  activity, end-user-facing events — stays here, generated from the
  authoritative sources this project already pulls from (`cncf/landscape`,
  `cncf/architecture`, `cncf/tab`).

## Out of scope

- The DNS cutover to endusers.cncf.io (tracked in the open issue #1433; see also
  ADR 0001 and the closed ownership issue #46).
- Implementing the outbound links identified above and filing the matching
  inbound-link requests against contribute.cncf.io / cncf.io — issue #1407's
  remaining two deliverables, left for separate follow-up work once this
  decision record is merged.

## References

- Issue #1407 (tracking issue for this deliverable)
- `CONTRIBUTING.md`, "Content audience" section
- `AGENTS.md`, "Audience" bullet
- ADR 0001 (site ownership and cutover path) — the DNS cutover this ADR
  deliberately excludes
