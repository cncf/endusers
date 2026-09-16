# Maintainers

This file lists the people responsible for reviewing and merging changes to
endusers.cncf.io, and the process for adding more of them. It exists because a
single point of failure on review/merge limits both continuity and community
trust for a site that presents itself as a CNCF community property (see issue
#47).

## Current maintainers

| Name | GitHub | Role |
| --- | --- | --- |
| Jorge Castro | [@castrojo](https://github.com/castrojo) | Maintainer |

This list intentionally starts with one person. The goal of this document is
the process below, not the roster above.

## What maintainers do

- Review and merge pull requests, including automated (hive/agent) PRs.
- Triage issues and keep the roadmap (`ROADMAP.md`) current.
- Make or delegate decisions recorded in `adr/` when they affect the project's
  direction (ownership, governance, architecture of the site itself).

## Becoming a maintainer

There is no formal nomination process yet. In the near term:

1. Contribute several substantive, merged pull requests (content, code, or
   data fixes — see `CONTRIBUTING.md`).
2. Demonstrate familiarity with the review standards in this repository:
   audience fit (end users, not contributors), sourced facts, and the
   generated-data rules for `/metrics`, `/awards`, and `/architectures`.
3. Ask an existing maintainer to sponsor you, or open an issue proposing
   yourself with links to your prior contributions.
4. A new maintainer is added by a pull request to this file, approved by at
   least one existing maintainer.

This process is deliberately lightweight today and is expected to be
formalized (e.g. a documented voting or consensus model) if and when this
project moves toward CNCF org ownership — see the ownership/cutover
discussion in issue #46.

## Reducing the review bottleneck

Hive/agent automation regularly opens pull requests here, and only human
maintainers can merge them. To keep the queue from growing unbounded when a
maintainer is unavailable:

- Low-risk, mechanical PRs (dependency bumps with green CI, generated-data
  refreshes that pass validation, typo/link fixes) are good candidates for a
  future automerge policy once CI coverage is trusted enough to gate on it.
- Anything touching content accuracy (award winners, TAB scope, architecture
  facts) or site structure should continue to require human review regardless
  of automation.

This is a starting point, not a final governance model; revisit it as the
maintainer list grows.
