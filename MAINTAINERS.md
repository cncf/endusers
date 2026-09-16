# Maintainers

This file lists the people responsible for reviewing and merging changes to
endusers.cncf.io, and the process for adding more of them. It exists because a
single point of failure on review/merge limits both continuity and community
trust for a site that presents itself as a CNCF community property (see issue
#47).

## Current maintainers

| Name         | GitHub                                   | Role       |
| ------------ | ---------------------------------------- | ---------- |
| Jorge Castro | [@castrojo](https://github.com/castrojo) | Maintainer |

This list intentionally starts with one person. The goal of this document is the
process below, not the roster above.

## What maintainers do

- Review and merge pull requests, including automated (hive/agent) PRs.
- Triage issues and keep the roadmap (`ROADMAP.md`) current.
- Make project-direction decisions and record lasting ownership or site
  architecture decisions in `adr/`.

## Becoming a maintainer

There is no formal nomination process yet. In the near term:

1. Contribute several substantive, merged pull requests (content, code, or data
   fixes — see `CONTRIBUTING.md`).
2. Demonstrate familiarity with the review standards in this repository:
   audience fit (end users, not contributors), sourced facts, and the
   generated-data rules for `/metrics`, `/awards`, and `/architectures`.
3. Ask an existing maintainer to sponsor you, or open an issue proposing
   yourself with links to your prior contributions.
4. A new maintainer is added by a pull request to this file, approved by at
   least one existing maintainer.

This process is deliberately lightweight; revisit it as the maintainer roster
grows.

## Reducing the review bottleneck

The current roster has one maintainer. To preserve meaningful gates without
making that maintainer a merge deadlock:

- Required CI checks must be green before every merge.
- The sole maintainer may review and self-merge low-risk, routine changes such
  as dependency bumps, validated generated-data refreshes, and typo or link
  fixes. Independent human review is recommended, but does not block these
  changes.
- Workflow and security-sensitive changes, governance changes, and major factual
  or structural changes require independent human review when another qualified
  reviewer is available. When none is available, the sole maintainer may proceed
  after required checks pass and the maintainer documents the rationale for the
  decision; the absence of a second maintainer must not deadlock the change.
- A maintainer may explicitly delegate an agent to merge a specific pull
  request, but only after required checks pass. The delegation must be a human
  maintainer decision; an agent-generated approval does not substitute for it or
  for required independent human review.
- `hold`, `on-hold`, and `do-not-merge` labels remain binding. Hive-specific
  hold instructions apply only when a hold is present or the work is
  Hive-assigned, not to all repository work by default.
