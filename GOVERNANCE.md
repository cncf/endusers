# Governance

This document describes how decisions get made and how work lands in this
repository. It complements `MAINTAINERS.md` (who) and `CONTRIBUTING.md` (how
to contribute). It exists because agent automation opens pull requests faster
than a single human can review them, and the project needs an explicit,
written policy instead of ad-hoc judgment (see issues #47 and #58).

## Decision making

- **Everyday changes** (content fixes, dependency bumps, CI repairs): decided
  by the reviewing maintainer. No ceremony.
- **Direction changes** (ownership, governance, site architecture, new content
  pillars): recorded as an ADR in `adr/` before implementation. See
  `adr/0001-site-ownership-and-cutover-path.md` for the format.
- **Roadmap priorities**: `ROADMAP.md` is the source of truth; changes to it
  are pull requests labeled `roadmap`, reviewed by a maintainer.

## Review and merge expectations

- Every pull request gets at least one human maintainer review before merge.
  There is no self-merge, including for automation-authored PRs.
- Reviewers check, in order: audience fit (end users, not contributors),
  factual accuracy with sources, generated-data rules (edit data, not pages),
  and only then style.
- CI must be green before merge. A broken deploy pipeline blocks everything
  except the fix that restores it (see `ROADMAP.md` Phase 0).

## Agent-automation policy

This repository is developed with AI-agent automation (hive agents). The
policy for agent-authored work:

- Agent PRs are held to the same review bar as human PRs. The `[agent]`-style
  prefix in a title is a provenance marker, not a merge shortcut.
- Agents never merge their own PRs. A human maintainer merges, or an
  explicitly delegated automerge path does (below).
- Agents must respect `hold` / `on-hold` / `do-not-merge` labels and never
  touch issues or PRs carrying them.

### Automerge-eligible classes

Once branch protection and CI coverage are trusted enough to gate on them,
the following classes are candidates for automerge with green CI:

- Dependency bumps (dependabot) with passing validation and deploy.
- Generated-data refreshes (metrics, architectures, community people) that
  pass their `validate:*` checks.
- Test-only changes that add coverage without touching production code.

**Operational status**: `.github/workflows/automerge-eligible.yml` implements
the dependency-bump and generated-data-refresh classes above. It never fires
on its own — a maintainer applies the `automerge` label to a reviewed,
eligible PR (the explicit delegation this policy requires), and the workflow
double-checks eligibility before requesting GitHub's native auto-merge, which
still waits on required status checks and reviews from branch protection.
One-time setup (repo admin): enable "Allow auto-merge" in repository settings
and create the `automerge` label. Test-only changes remain manual until
eligibility can be detected reliably (e.g. by path).

The following always require human review, regardless of CI:

- Workflow and security-sensitive changes (`.github/workflows/`, install
  scripts, anything handling tokens).
- Content accuracy: award winners, TAB/community membership, architecture
  facts.
- Site structure, navigation, and branding.

## Merge-queue hygiene

To keep the queue from rotting (see issue #58):

- Agent PRs that conflict with the base branch for more than 48 hours should
  be rebased by their author agent or closed as superseded.
- Superseded PRs (e.g. a fix landed by a different route) are closed with a
  comment pointing at the replacement.
- Maintainers aim to keep the open-PR queue in single digits; a growing queue
  is a signal to adjust the automerge classes above, not to lower the review
  bar.

**Operational status**: `.github/workflows/pr-queue-hygiene.yml` runs on a
schedule and flags (labels `needs-rebase-or-close` + comments) any open PR
that has been conflicting with the base branch for more than 48 hours. It
does not close PRs automatically — judging whether a conflicting PR is
superseded needs human or author-agent judgment — but it makes stale PRs
visible without waiting for the next manual sweep.

## Changing this document

Changes to this file are direction changes: propose them as a pull request
and record the reasoning in an ADR if they alter the decision-making model.
