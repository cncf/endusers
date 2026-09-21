# Architecture Decision Records

This directory records significant, hard-to-reverse decisions about this
repository and the endusers.cncf.io site itself (not about CNCF end-user
architectures, which live under `docs/architectures/`), plus hive
fleet-management decisions recorded here because this is the repository the
agent fleet can currently write to (see `AGENTS.md`).

Each ADR captures the context, options considered, and the decision made (or
still pending) so future contributors understand why, not just what.

| ADR                                               | Title                                                | Status   |
| ------------------------------------------------- | ---------------------------------------------------- | -------- |
| [0001](./0001-site-ownership-and-cutover-path.md) | Site ownership and cutover path for endusers.cncf.io | Accepted |
| [0002](./0002-peoplehub-fleet-status.md)          | peoplehub fleet status — pause agent work            | Accepted |

Supporting material is not part of the numbered ADR sequence and is not
assigned an ADR number, but is listed here for discoverability:

| Document                                                         | Supports | Purpose                                    |
| ----------------------------------------------------------------- | -------- | ------------------------------------------- |
| [stakeholder-outreach-draft-for-0001.md](./stakeholder-outreach-draft-for-0001.md) | 0001     | Ready-to-send outreach draft for ADR 0001's stakeholder discussion step |
