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
- An agent-filed issue or PR must name a defect an end user can observe on the
  production site, a security or supply-chain exposure, a required CI check
  failing on `main` or fleet-wide, a generated-data or dependency refresh
  through its existing lane, or an issue a maintainer filed for agent work.
  Anything else is out of remit, and a change whose only effect is to move a
  metric (mutation score or surviving mutants, coverage, clone count, test-prose
  or harness shape) is closed as not planned. The thresholds behind those
  metrics are frozen regression gates; changing one is a maintainer-authored ADR
  amendment
  ([ADR 0008](./adr/0008-scope-agent-findings-to-user-observable-change.md)).
- A decision recorded in an ADR, or by a maintainer on a closed issue or PR,
  binds every later finding on the same rule, file or component however it is
  worded. A re-filing is closed as not planned with a pointer to the decision
  ([ADR 0008](./adr/0008-scope-agent-findings-to-user-observable-change.md)).
- A PR for a finding that Hive folded into an existing issue says `Refs #N` for
  that issue, never `Fixes`, `Closes` or `Resolves`, unless it also completes
  the issue's own deliverable
  ([ADR 0008](./adr/0008-scope-agent-findings-to-user-observable-change.md)).

### Low-risk merge classes

With green required checks, the sole maintainer may self-merge or explicitly
delegate an agent to merge these low-risk classes:

- Dependency bumps (dependabot) with passing validation and deploy. One narrow
  subset is queued without a per-PR decision:
  [`dependabot-automerge.yml`](.github/workflows/dependabot-automerge.yml) arms
  auto-merge (`gh pr merge --auto`) on a pull request opened by Dependabot only
  when it is an npm update, its highest semver change is patch or minor, and it
  changes no file other than `package-lock.json` (so nothing under
  `.github/workflows/`). The merge queue merges it only after the required
  checks pass, including `npm run check:audit`. Security updates within those
  bounds, the usual shape of a transitive advisory fix, take this path. Every
  other Dependabot pull request (`package.json` range bumps, major versions,
  GitHub Actions and dev container pins) waits for a maintainer. This standing
  delegation is the maintainer's decision; disabling auto-merge on a pull
  request, or the workflow, withdraws it.
- Generated-data refreshes (metrics, architectures, community people) that pass
  their `validate:*` checks.
- Typo and link fixes.
- Test-only changes that exercise production code and state which behavior in
  `src/`, `scripts/`, `docs/`, `data/`, `static/` or `.github/workflows/` would
  regress undetected without them
  ([ADR 0006](./adr/0006-retire-line-number-citations-in-test-prose.md)). Guards
  over the test tree itself are not in this class, nor are new end-to-end
  fixture builds that only reach a data-shape guard
  ([ADR 0007](./adr/0007-scope-end-to-end-coverage-to-user-reachable-states.md)).

The following use the independent-review rule above rather than the low-risk
path:

- Workflow and security-sensitive changes (`.github/workflows/`, install
  scripts, anything handling tokens) and governance changes.
- Major factual changes, including award winners, TAB/community membership, and
  architecture facts.
- Major site structure, navigation, and branding changes.

## Hive App workflow-permission gap

The hivecommons-hive GitHub App installation on this repo has `contents:write`
but not the `workflows` permission, so hive agent branches that touch
`.github/workflows/**` cannot be pushed through the App. Issue #120 tracked this
gap and is closed, but the permission was never granted and the gap is still in
effect. This is a repo/organization admin setting (GitHub App installation →
Permissions), not something a pull request can change, so until an admin grants
it agents must follow this interim process instead of opening artifact-only PRs:

- An agent that finds a fix requiring changes to `.github/workflows/**` must not
  commit `.patch` files or other artifact-only evidence as a PR. Instead, it
  posts the full proposed diff (as a fenced code block, not an attachment) as a
  comment on the relevant tracking issue, so a maintainer can apply it directly
  with normal write access.
- The comment must state which workflow file(s) it touches and link back to this
  section so reviewers understand why there is no branch.
- Once a maintainer applies the change (either by hand or by re-running the
  agent after the App gains the permission), the tracking issue is closed and
  any duplicate artifact comments are marked superseded, per the cross-agent
  duplicate-prevention rule below.
- If the `workflows` permission is granted to the App, this section is removed
  and agents resume opening normal branches/PRs for workflow changes.

## Merge-queue hygiene

To keep the queue from rotting (see issue #58):

- Agent PRs that conflict with the base branch for more than 48 hours should be
  rebased by their author agent or closed as superseded.
- Superseded PRs (e.g. a fix landed by a different route) are closed with a
  comment pointing at the replacement.
- Maintainers aim to keep the open-PR queue in single digits; a growing queue is
  a signal to adjust the low-risk merge classes above, not to lower the review
  bar.

**Operational status**: `scripts/pr-queue-hygiene.mjs` flags (labels
`needs-rebase-or-close` + comments) any open PR that has been conflicting with
the base branch for more than 48 hours. It does not close PRs automatically —
judging whether a conflicting PR is superseded needs human or author-agent
judgment — but it makes stale PRs visible without waiting for manual sweeps.
Mergeability is checked per-PR via the single-PR API endpoint to avoid stale
cached list values, and PRs labeled `hold`, `on-hold`, or `do-not-merge` are
skipped per agent-automation policy. The scheduled GitHub Actions workflow file
(`.github/workflows/pr-queue-hygiene.yml`) is committed on the default branch
and runs on a schedule (see PR #544); issue #318, which tracked getting it
committed, is closed. See the `Hive App workflow-permission gap` section above
for the current status of that separate, ongoing constraint on agent-pushed
workflow changes.

### Cross-agent duplicate prevention

Fleet-wide sweeps have repeatedly found duplicate PRs opening the same fix from
different agents (see issue #119). To prevent this:

- Before implementing a fix, an agent must search open (and recently closed) PRs
  and issues touching the same file(s) or the same problem. If a match exists,
  the agent links to it and either supersedes it (with a comment explaining why
  the new PR replaces it) or stands down instead of opening a parallel PR.
- When an equivalent change lands, the superseded PR is closed with a comment
  pointing at the replacement, per the merge-queue hygiene rule above.
- Fixes that require changes to workflow files (`.github/workflows/`) or other
  security-sensitive files should, where a tracking issue already exists,
  reference that issue rather than opening a new artifact-patch PR that
  duplicates work already queued against it.

## Changing this document

Changes to this file are direction changes. Propose them as a pull request and
explain the policy reasoning in the pull request description.
