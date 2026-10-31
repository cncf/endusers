# Architecture Decision Records

This directory records significant, hard-to-reverse decisions about this
repository and the endusers.cncf.io site itself (not about CNCF end-user
architectures, which live under `docs/architectures/`), plus hive
fleet-management decisions recorded here because this is the repository the
agent fleet can currently write to (see `AGENTS.md`).

Each ADR captures the context, options considered, and the decision made (or
still pending) so future contributors understand why, not just what.

| ADR                                                                  | Title                                                                        | Status   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| [0001](./0001-site-ownership-and-cutover-path.md)                    | Site ownership and cutover path for endusers.cncf.io                         | Accepted |
| [0002](./0002-peoplehub-fleet-status.md)                             | peoplehub fleet status — pause agent work                                    | Accepted |
| [0003](./0003-public-changelog-mechanism.md)                         | Public changelog generated from git history at build time                    | Accepted |
| [0004](./0004-audience-boundaries-across-cncf-properties.md)         | Audience boundaries across endusers.cncf.io, contribute.cncf.io, and cncf.io | Accepted |
| [0005](./0005-host-the-site-on-netlify.md)                           | Host the site on Netlify instead of GitHub Pages                             | Accepted |
| [0006](./0006-retire-line-number-citations-in-test-prose.md)         | Retire line-number citations in test prose and narrow test-only agent work   | Accepted |
| [0007](./0007-scope-end-to-end-coverage-to-user-reachable-states.md) | Scope end-to-end coverage findings to user-reachable states                  | Accepted |
| [0008](./0008-scope-agent-findings-to-user-observable-change.md)     | Scope agent findings to user-observable change                               | Accepted |
| [0009](./0009-refresh-generated-data-only-on-content-change.md)      | Refresh generated data only when its content changes                         | Accepted |
| [0010](./0010-architecture-pages-are-the-metadata-source.md)         | Architecture pages are the source of their catalog metadata                  | Accepted |
| [0011](./0011-content-focused-validation-for-documentation.md)       | Content-only pull requests use focused validation                            | Accepted |
| [0012](./0012-event-pages-are-the-source-of-the-events-section.md)   | Event pages are the source of the events section                             | Proposed |

Supporting material is not part of the numbered ADR sequence and is not assigned
an ADR number, but is listed here for discoverability:

| Document                                                                           | Supports | Purpose                                                                 |
| ---------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| [stakeholder-outreach-draft-for-0001.md](./stakeholder-outreach-draft-for-0001.md) | 0001     | Ready-to-send outreach draft for ADR 0001's stakeholder discussion step |
| [inbound-link-requests-for-0004.md](./inbound-link-requests-for-0004.md)           | 0004     | Ready-to-file inbound-link requests for contribute.cncf.io and cncf.io  |
