# Inbound-link requests for ADR 0004

Ready-to-file drafts for the third deliverable of
[#1407](https://github.com/cncf/endusers/issues/1407): asking the
contribute.cncf.io and cncf.io maintainers to link back to this site. They
follow the content-type table in
[ADR 0004](./0004-audience-boundaries-across-cncf-properties.md). Filing them
needs a maintainer with access to those repositories; this repository's agents
cannot file them. Target pages are suggestions, to be confirmed against each
site's current structure before filing.

The DNS cutover to `endusers.cncf.io` completed on 2026-10-22
([#1433](https://github.com/cncf/endusers/issues/1433)), so the requested URLs
resolve and these requests can be filed.

Origin issue: [#1434](https://github.com/cncf/endusers/issues/1434) (closed once
these drafts shipped). Live status is the Status column below: when a request is
filed, record its link there and close #1407 once all are filed.

| #   | Target property    | Suggested page                                | Requested link and anchor text                                                                   | Why (ADR 0004)                                                    | Status |
| --- | ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------ |
| 1   | contribute.cncf.io | Awards nomination or recognition page         | `https://endusers.cncf.io/` - "Published end-user award winners"                                 | Winners list stays here; nomination lives there                   | Open   |
| 2   | contribute.cncf.io | Landing or "find your role" page              | `https://endusers.cncf.io/` - "Running cloud native in production? Start with the End User site" | Routes adopters who land on the contributor site to the right one | Open   |
| 3   | cncf.io            | End User Community page or section            | `https://endusers.cncf.io/` - "CNCF End User Community site"                                     | The site is the home for end-user content                         | Open   |
| 4   | cncf.io            | Reference architectures or case-study pages   | `https://endusers.cncf.io/architectures/` - "End user reference architectures"                   | Reference architectures are end-user content                      | Open   |
| 5   | cncf.io            | End-user events or TAB / End User Group pages | `https://endusers.cncf.io/events/` - "End user events"                                           | End-user-facing events and TAB activity live here                 | Open   |

## Issue body template

Use for each request, filling in the row:

```text
Title: Link to the CNCF End User Community site from <page>

The CNCF End User Community site (https://endusers.cncf.io/) hosts content for
adopters and operators of cloud native technologies. Per its audience-boundary
decision (ADR 0004), <why>. Could <page> link to <URL> with the anchor text
"<anchor>"? The reverse links already exist from the End User site.

Context: https://github.com/cncf/endusers/issues/1434
```
