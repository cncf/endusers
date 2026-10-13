# ADR 0003: Public changelog generated from git history at build time

- **Status**: Accepted
- **Date**: 2026-10-13
- **Tracking issue**: [#1408](https://github.com/cncf/endusers/issues/1408)

## Context

Once the site is announced, a returning reader has no way to see what changed
since their last visit (LAUNCH.md's public feedback loop). Issue #1408 lists
three candidate mechanisms — a `CHANGELOG.md` rendered as a page, a `/changelog`
page generated from merged PR titles, or a blog category — with one hard
requirement: whatever is chosen must be generated or trivially maintained,
because a hand-curated file that goes stale is worse than none.

## Options considered

### Option A: Hand-curated CHANGELOG.md rendered as a page

Zero machinery, but every pull request would owe the file an edit, nothing
enforces that edit, and the file decays exactly the way #1408 warns against.
Rejected.

### Option B: A blog category for release notes

Blog posts are dated, authored announcements — the right shape for "we published
a case study", not for "what changed on the site". A post per meaningful change
is hand-curation under another name. Rejected.

### Option C: A docs page generated from git history at build time

Every commit on `main` arrives by squash merge with a Conventional Commits
subject, so `git log --first-parent` _is_ the list of merged PR titles.
`scripts/generate-changelog.mjs` renders it into `docs/community/changelog.md`
on every build, keeping the reader-visible types (`feat`, `fix`, `docs`, `perf`)
and dropping the rest. No pull request owes the changelog anything; it cannot
drift.

## Decision

Option C. The generator runs as part of `npm run _build`, so local builds, CI,
and deploys all regenerate the page, and the generated file is gitignored. The
page is capped at 200 entries and links the full commit history for older
changes.

## Consequences

- The deploy job checks out with the default `fetch-depth: 1`, so a deploy build
  has no history to render. Until the checkout fetches full history (a one-line
  workflow change), the generator detects the shallow checkout and renders a
  fallback page linking GitHub's live merged-PR and commit views instead of a
  one-entry fiction. The fallback is accurate and zero-maintenance; the full
  rendering returns automatically once the workflow change lands.
- Commit subjects become public-facing copy. Reviewers should treat a PR title
  the way they treat a heading: it is what a returning reader will see.
- `npm run docus:start` does not run the generator; a developer who wants the
  page in the dev server runs `npm run generate:changelog` first.
