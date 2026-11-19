# ADR 0013: Surface dependency advisories through a daily issue, not a pull-request gate

- **Status**: Accepted
- **Date**: 2026-11-19
- **Related**:
  [ADR 0008](./0008-scope-agent-findings-to-user-observable-change.md),
  [ADR 0011](./0011-content-focused-validation-for-documentation.md)

## Context

`npm run check:audit` (`scripts/audit-gate.mjs`) fails when `npm audit`
reports a high or critical advisory outside the allowlist in `SECURITY.md`,
when a moderate or low advisory has a patched release reachable in range, or
when an allowlisted advisory no longer appears in the lockfile. Until this
decision it ran in two places: the "Validate repository" job of `ci.yml` on
every non-document-only pull request and in the merge queue, and the daily
"Dependency audit" workflow (`audit-schedule.yml`) on `main`. The scheduled
lane held a read-only token and, by its own header, opened nothing: "a red run
is the notification."

The gate's input is the advisory database, not the repository. It moves on its
own: an advisory is published against a lockfile nobody changed, or an
allowlisted advisory is fixed or withdrawn upstream. Either event turns the gate
red on whichever pull request happens to be open next. The recorded instance is
[#2131](https://github.com/cncf/endusers/pull/2131), a one-line documentation
change to an imported architecture page: it took the full validation path
because architecture pages are generated content
([ADR 0011](./0011-content-focused-validation-for-documentation.md)), and
"Validate repository" failed at `check:audit` because `GHSA-fc5q-39xc-vjpf`
had been fixed upstream and its allowlist entry was now stale. The unit suite
behind it passed. The contributor could not fix the failure from that pull
request, and nobody was told about the stale entry except by way of their red
check.

The daily lane already detected the same drift a few hours earlier, but a red
scheduled run notifies only the people watching the Actions tab. Meanwhile
`audit-fix.yml` triggers on that failure and opens a lockfile pull request when
`npm audit fix --package-lock-only` can resolve the finding in range; it has no
way to report the cases it cannot fix, such as a stale allowlist entry.

## Decision drivers

- A pull request should fail only on something the pull request changed.
- A new advisory, or a stale allowlist entry, must still reach a person within
  a day, in a place they will see without watching workflow runs.
- `audit-fix.yml` must keep triggering on the scheduled failure.
- The scheduled lane runs unattended daily, so its token stays as narrow as the
  job allows.
- Keep one notification per incident, not one per day.

## Options considered

1. **Keep the gate on every pull request.** Any pull request can carry a
   dependency change, so this is the only option that blocks a lockfile bump
   from introducing a known advisory at merge time. Rejected: in practice the
   gate turned red on changes with no dependency content, and the person it
   blocked was never the person who could act on it.
2. **Gate only pull requests that change `package.json` or
   `package-lock.json`.** Narrows the blast radius to dependency changes, but a
   stale allowlist entry or a freshly published advisory would still fail a
   routine Dependabot bump that did not introduce it, and the classification
   adds a third validation path to `ci.yml`. Rejected as not worth the
   complexity for a window the daily run already closes.
3. **Run the gate on pull requests as a non-blocking annotation.** Keeps the
   signal visible on every pull request without blocking. Rejected: the
   repository's gating contract (`tests/ci-gating-jobs.test.mjs`) treats
   `continue-on-error` on a pull-request job as a hole to be argued for, and an
   annotation on a bystander's pull request still notifies the wrong person.
4. **Remove the gate from `ci.yml`; have the daily run file an issue.** The
   daily lane already detects the drift; making it file and maintain a single
   issue puts the finding in front of maintainers instead of on a contributor's
   check. Chosen.

## Decision

`check:audit` runs only in the daily "Dependency audit" workflow
(`.github/workflows/audit-schedule.yml`), on its schedule and on dispatch. It
is removed from `ci.yml` and is not a required check. `npm run check` still
includes it for local use.

When the gate is red, the workflow files an issue titled "Dependency audit:
action needed" and labelled `dependency-audit`, carrying the gate's output and
the three remediation paths (the `automation/audit-fix` pull request, the
`SECURITY.md` register process, or removing a stale allowlist entry). While an
open issue with that label exists, later red runs comment on it instead of
opening another. The next green run closes it with a link to the passing run.
The job holds `issues: write` and no other write scope, and a constant
concurrency group serializes overlapping runs so two cannot both file.

The job still exits non-zero when the gate is red, after filing the issue, so
`audit-fix.yml` keeps triggering on the failure and opening its lockfile pull
request when a fix is reachable in range. `audit-fix.yml` itself is unchanged.

`tests/audit-schedule-contract.test.mjs` pins each clause: `ci.yml` does not
run the gate; the scheduled workflow runs it daily and on demand, runs nothing
else, holds exactly `issues: write`, lists, creates, comments on and closes the
issue, and ends in `exit 1` on a red gate without `continue-on-error`.

## Consequences

- A pull request never fails on advisory-database drift. A contributor's red
  "Validate repository" check now means something in their change.
- A dependency bump can introduce a known high or critical advisory and merge;
  the daily run reports it within a day, and `audit-fix.yml` or Dependabot
  opens the fix. This window is accepted. Dependabot auto-merge
  (`dependabot-automerge.yml`) no longer counts `check:audit` among the checks
  it waits on.
- Maintainers get one issue per incident, updated with each day's output,
  closed automatically when the gate is green. A stale allowlist entry, which
  `audit-fix.yml` cannot repair, now reaches them the same way as an advisory.
- The scheduled lane gains `issues: write`. `audit-fix.yml` remains the only
  lane with `contents: write` and `pull-requests: write`.
- `CONTRIBUTING.md`, `SECURITY.md` and `GOVERNANCE.md` describe the issue, not
  the pull-request check, as where an advisory surfaces.
