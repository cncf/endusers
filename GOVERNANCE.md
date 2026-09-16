# Governance

This document describes how decisions get made and how work lands in this
repository. It complements `MAINTAINERS.md` (who) and `CONTRIBUTING.md` (how to
contribute). It exists because agent automation opens pull requests faster than
a single human can review them, and the project needs an explicit, written
policy instead of ad-hoc judgment (see issues #47 and #58).

## Decision making

- **Everyday changes** (content fixes, dependency bumps, CI repairs): decided by
  the reviewing maintainer. No ceremony.
- **Direction changes** (ownership, site architecture, new content pillars):
  record lasting design decisions as an ADR in `adr/`. See
  `adr/0001-site-ownership-and-cutover-path.md` for the format.
- **Roadmap priorities**: `ROADMAP.md` is the source of truth; changes to it are
  pull requests labeled `roadmap`, reviewed by a maintainer.

## Review and merge expectations

- Required CI checks must be green before any merge.
- While the roster has a sole maintainer, that maintainer may review and
  self-merge low-risk, routine changes. Independent human review is recommended,
  but is not a blocking requirement, for those changes.
- Workflow and security-sensitive changes, governance changes, and major factual
  or structural changes require independent human review when another qualified
  reviewer is available. If none is available, the sole maintainer may proceed
  after required checks pass and the maintainer documents the rationale for the
  decision; the lack of a second maintainer must not deadlock the change.
- A human maintainer must make and record each maintainer decision. An
  agent-generated review, summary, or approval does not count as independent
  human review or replace that decision.
- Reviewers check, in order: audience fit (end users, not contributors), factual
  accuracy with sources, generated-data rules (edit data, not pages), and only
  then style.

## Agent-automation policy

This repository is developed with AI-agent automation (hive agents). The policy
for agent-authored work:

- Agent PRs follow the same merge policy as human PRs. The `[agent]`-style
  prefix in a title is a provenance marker, not a merge shortcut.
- An agent must not decide to merge its own PR. A maintainer may explicitly
  delegate an agent to merge a specific PR, but only after all required checks
  pass. That delegation is the maintainer's decision, not an agent-generated
  approval.
- Agents must respect `hold` / `on-hold` / `do-not-merge` labels and never touch
  issues or PRs carrying them. Hive-specific hold instructions apply only when a
  hold is actually present or when the work is Hive-assigned; they are not a
  universal hold on other repository work.

### Low-risk merge classes

With green required checks, the sole maintainer may self-merge or explicitly
delegate an agent to merge these low-risk classes:

- Dependency bumps (dependabot) with passing validation and deploy.
- Generated-data refreshes (metrics, architectures, community people) that pass
  their `validate:*` checks.
- Typo and link fixes.
- Test-only changes that add coverage without touching production code.

The following use the independent-review rule above rather than the low-risk
path:

- Workflow and security-sensitive changes (`.github/workflows/`, install
  scripts, anything handling tokens) and governance changes.
- Major factual changes, including award winners, TAB/community membership, and
  architecture facts.
- Major site structure, navigation, and branding changes.

## Merge-queue hygiene

To keep the queue from rotting (see issue #58):

- Agent PRs that conflict with the base branch for more than 48 hours should be
  rebased by their author agent or closed as superseded.
- Superseded PRs (e.g. a fix landed by a different route) are closed with a
  comment pointing at the replacement.
- Maintainers aim to keep the open-PR queue in single digits; a growing queue is
  a signal to adjust the low-risk merge classes above, not to lower the review
  bar.

## Changing this document

Changes to this file are direction changes. Propose them as a pull request and
explain the policy reasoning in the pull request description.
