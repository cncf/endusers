# ADR 0005: Host the site on Netlify instead of GitHub Pages

- **Status**: Accepted
- **Date**: 2026-10-14
- **Tracking issue**: [#1433](https://github.com/cncf/endusers/issues/1433) (DNS
  cutover; this ADR changes what the cutover points at)

## Context

ADR 0001 transferred the repository to the `cncf` organization and left the site
on GitHub Pages at `https://cncf.github.io/endusers/`, built and published by
`.github/workflows/deploy-gh-pages.yml` on every push to `main`. Its step 3
("add `static/CNAME`, verify the custom domain in GitHub Pages settings, switch
the deploy workflow's `SITE_URL`/`BASE_URL`") is the still-open DNS cutover
tracked in #1433.

The repository has since been connected to Netlify (site name `endusers`,
production URL `https://endusers.netlify.app/`). Netlify's GitHub App already
posts a `netlify/endusers/deploy-preview` status plus three rule checks on every
pull request, but every build fails because the repository carries no
`netlify.toml` and Netlify's auto-detected settings do not match this build.

Three properties of the current publish lane constrain the move:

1. **The deploy workflow is a gate, not just a publisher.** Automation pull
   requests (`refresh-radar-reports.yml`, `refresh-community-people.yml`,
   `import-architectures.yml`) are authored by `github.token`, which never
   triggers `ci.yml` (#755). The deploy build job therefore runs the full
   `validate:*` set before publishing and is the only validation those data
   changes receive. `tests/deploy-publish-contract.test.mjs` pins that parity.
2. **Canonical and Open Graph URLs follow `SITE_URL`/`BASE_URL`.**
   `docusaurus.config.js` reads both from the environment, defaulting to
   `https://endusers.cncf.io` and `/`; the deploy workflow overrides them to the
   GitHub Pages project URL and subpath.
3. **A dozen tests and documents pin the GitHub Pages shape** — the workflow
   file name, the `/endusers/` subpath, `.nojekyll`, and GitHub Pages' case
   sensitivity.

## Decision drivers

- Keep the #755 gate: a data validator failure must still prevent publishing.
- Deploy previews for every pull request, including Hive-authored ones (which
  receive no `pull_request` workflow runs today).
- One source of truth for build settings, reviewable in the repository.
- No new secrets in GitHub Actions.
- Canonical URLs that are correct on day one and need no edit at DNS cutover.

## Options considered

### Option A: Netlify git-integration build, `netlify.toml` in the repository

Netlify clones `main`, runs the build command from `netlify.toml`, and publishes
`build/`. Deploy previews come from the same configuration.

- Pros: fewest moving parts; no Actions secrets; previews for every PR
  regardless of author; the validators run inside the build command, so a
  failure fails the deploy and the previous deploy stays live.
- Cons: the unit suite leaves the publish gate (it costs ~5 minutes per deploy
  and `ci.yml` already runs it on every human PR); build minutes move to
  Netlify.

### Option B: Build in GitHub Actions, publish with the Netlify CLI

Keep `deploy-gh-pages.yml`'s build job, replace the deploy job with
`netlify deploy --prod --dir=build`, and stop Netlify's own builds.

- Pros: the publish gate is unchanged, including the unit suite; every action
  stays SHA-pinned under this repository's supply-chain tests.
- Cons: requires `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` secrets; deploy
  previews need a second workflow and still never run for Hive PRs; Netlify's UI
  and the workflow must agree on settings.

### Option C: Option A plus a post-merge Actions lane for the unit suite

- Pros: the unit suite still runs on automation merges.
- Cons: a red lane that blocks nothing, since Netlify publishes independently.

## Decision

**Option A.** Netlify builds and publishes the site from `main`; the data
validators move into the Netlify build command so the #755 gate survives; the
GitHub Pages deployment and its workflow are removed once Netlify's first
production deploy is verified.

## Design

### Build configuration

`netlify.toml` at the repository root is the single source of truth. The Netlify
UI build settings are cleared so they defer to the file.

```toml
[build]
  command = "npm run build:netlify"
  publish = "build"

[build.environment]
  NODE_VERSION = "22"
```

`BASE_URL` keeps its `docusaurus.config.js` default of `/`; Netlify serves every
deploy at a host root, so no context sets it.

Two npm scripts are added to `package.json`:

- `validate:all` runs the thirteen `validate:*` targets `ci.yml` runs today, in
  the same order (`validate:members` last, before any build, as
  `tests/automation-workflow-ordering.test.mjs` requires).
- `build:netlify` runs `node scripts/netlify-build.mjs`.

`scripts/netlify-build.mjs` does two things:

1. Resolves `SITE_URL` if the environment does not already set it:
   `CONTEXT=production` uses Netlify's `URL` (the production URL, which becomes
   `https://endusers.cncf.io` automatically once the custom domain is attached);
   `deploy-preview` and `branch-deploy` use `DEPLOY_PRIME_URL`; with neither
   variable present the config default stands. An explicit `SITE_URL` always
   wins so local and CI builds are unaffected.
2. Runs `npm run validate:all` and then `npm run build:production`, exiting with
   the first non-zero status. A validator failure therefore fails the Netlify
   build and the previous production deploy stays live.

The resolver is exported and the execution sits behind a main-module guard so
the unit suite can test the URL logic without running a build.

Netlify's clone is blobless, not shallow, so `scripts/generate-changelog.mjs`
sees full `--first-parent` history and renders real entries; the fallback page
from #1409 is not reached.

`static/CNAME` (empty) and `static/.nojekyll` are GitHub Pages artifacts and are
deleted; the `.nojekyll` entry leaves the allowlist in
`scripts/validate-architecture-assets.mjs`. Deleting them while GitHub Pages is
still live is safe: the Actions-based Pages deployment uploads the built
artifact directly and never runs Jekyll.

### Workflows and GitHub Pages

- `.github/workflows/deploy-gh-pages.yml` is deleted in the second rollout step
  (below). Nothing else in the repository publishes the site.
- GitHub Pages is disabled on the repository
  (`gh api -X DELETE repos/cncf/endusers/pages`) after the first green Netlify
  production deploy. `https://cncf.github.io/endusers/` then returns 404; the
  decision is to accept that rather than keep a redirect stub.
- Netlify's `deploy-preview` status and the three rule checks are not made
  required checks.

### Tests

Changes land in two steps, matching the rollout: PR 1 adds the Netlify tests and
reworks anything that does not depend on the deploy workflow's existence; PR 2
removes the assertions that pin `deploy-gh-pages.yml`.

PR 1:

- New `tests/netlify-publish-contract.test.mjs`. It parses `netlify.toml`
  (adding `smol-toml` as a dev dependency) and asserts: `build.command` is
  `npm run build:netlify`; `build.publish` is `build`; `NODE_VERSION` equals
  `ci.yml`'s `node-version`; and the `validate:all` script names every
  `validate:*` target `ci.yml`'s validate job runs — the #755 parity invariant,
  checked against the script as well as the workflow job while both exist.
- `tests/automation-workflow-ordering.test.mjs`: the "members before build"
  check additionally covers the `build:netlify` script order (`validate:all`
  precedes `build:production`).
- `tests/site-config.test.mjs`: the "CSP holds under a preview deployment
  origin" case uses `SITE_URL=https://deploy-preview-1--endusers.netlify.app`
  and `BASE_URL=/`; a subpath (`BASE_URL=/endusers/`) case is kept as a
  config-shape test because `BASE_URL` stays environment-driven.
- New `tests/netlify-build.test.mjs` covers the `SITE_URL` resolver: explicit
  `SITE_URL` wins; `production` uses `URL`; `deploy-preview` and `branch-deploy`
  use `DEPLOY_PRIME_URL`; no Netlify variables leaves it unset; and the script's
  command sequence stops at the first failure.
- Comments in `tests/css-assets.test.mjs`, `tests/tools/static-references.mjs`
  and `tests/manifest-contract.test.mjs` that attribute case sensitivity to
  GitHub Pages are reworded for Netlify; the checks themselves do not change.

PR 2:

- `tests/deploy-publish-contract.test.mjs` is deleted; its unit-suite assertion
  is dropped by decision and its validator-parity assertion already lives in the
  Netlify contract test.
- `tests/automation-workflow-ordering.test.mjs`: the `publishesSite` detector
  expects no workflows and the "members before build" loop drops the
  `deploy-gh-pages.yml` row.
- `tests/ci-concurrency.test.mjs`, `tests/workflow-scripts.test.mjs`,
  `tests/swc-native-binding-contract.test.mjs`: deploy-gh-pages entries and
  mentions are removed.

Both PRs: the unit gate's coverage thresholds (99% lines / 100% source / 96%
regions / 100% source regions) must still be met; `scripts/netlify-build.mjs`
counts toward line coverage.

### Documentation

- This ADR records the decision. ADR 0001 gains a dated status-note amendment
  pointing here, and its step 3 is restated: the cutover is now "add
  `endusers.cncf.io` as the Netlify custom domain and point DNS at Netlify";
  `static/CNAME` and workflow `SITE_URL`/`BASE_URL` edits are no longer part of
  it. #1433 receives a comment with the revised steps.
- `README.md` deployment section: Netlify, `netlify.toml`, `URL`-derived
  canonical, deploy previews on every PR, interim URL
  `https://endusers.netlify.app/`.
- `AGENTS.md` (deployment sentence), `LAUNCH.md` ("Default-branch deployment"
  pipeline row), `ROADMAP.md` (Phase 3 DNS bullet),
  `adr/stakeholder-outreach-draft-for-0001.md` and
  `adr/inbound-link-requests-for-0004.md` (interim URL mentions) are updated to
  the Netlify URL. `docs/skills/` (now `.agents/skills/`) is checked for GitHub
  Pages references and updated if any.
- `adr/README.md` lists this ADR.

### Rollout

1. **PR 1** adds `netlify.toml`, the scripts, the new and updated tests, and the
   documentation, and marks this ADR Accepted. It keeps `deploy-gh-pages.yml` so
   GitHub Pages stays live. Its own deploy preview is the first evidence that
   the Netlify build works.
2. **Verification** before PR 2: `https://endusers.netlify.app/` serves the site
   with `<link rel="canonical">` and `og:url` pointing at itself; a throwaway
   branch with a deliberately invalid data fixture produces a failed deploy
   preview, proving the gate.
3. **PR 2** deletes `deploy-gh-pages.yml` and its remaining test entries, and
   drops the GitHub Pages `SITE_URL`/`BASE_URL` overrides from `ci.yml`'s build
   step. After it merges, GitHub Pages is disabled via the API and #1433 is
   updated.

Status: step 1 shipped in #1485; step 2 verified on 2026-10-14 (production
deploy canonical to `https://endusers.netlify.app/`, gate proven by #1488's
failed preview); step 3 is this ADR's final change set.

## Consequences

- The unit suite no longer runs between an automation data merge and
  publication; the data validators do. `ci.yml` remains the unit gate for every
  human-authored change.
- Every pull request, including Hive-authored ones, gets a deploy preview.
- `https://cncf.github.io/endusers/` stops resolving to the site after PR 2.
- The DNS cutover in #1433 becomes a Netlify custom-domain step with no
  repository change required for canonical URLs.
- Build settings are reviewed in pull requests like any other file.
