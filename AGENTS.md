# Agent Entry Point: CNCF End User Community Repository

This repository hosts the source for the CNCF End User Community site at
<https://endusers.cncf.io/>, deployed on Netlify (see
[ADR 0001](./adr/0001-site-ownership-and-cutover-path.md) and
[ADR 0005](./adr/0005-host-the-site-on-netlify.md)). It serves practitioners,
architects, and organizations running cloud native technologies in production.

## Navigation

- **Core Documentation**: `/docs/`
- **Blog**: `/blog/`
- **Static Assets**: `/static/`
- **Components/UI**: `/src/`
- **Data (generated + curated)**: `/data/`

## Skills & Capabilities

This repository defines specific skills for AI agents to follow when
contributing or managing documentation. They live in `.agents/skills/`, one
`<name>/SKILL.md` per skill with `name` and `description` front matter following
the [Agent Skills](https://agentskills.io) layout; they are not site content.

- [Skill Manifest](.agents/skills/manifest.md) - Index of all available agent
  skills.

## Hive Configuration

This repository does not contain a `hive.yaml` or any authorized-repository
allowlist. The Hive orchestrator's `project.repos` configuration is maintained
outside this codebase. If a Hive-filed issue reports a stale or nonexistent repo
entry (for example, a 404 on an authorized repo), that config lives elsewhere
and cannot be corrected with a PR here — flag it to the Hive maintainers
directly.

## Workflow

Before opening a PR, read
[`CONTRIBUTING.md#making-changes`](CONTRIBUTING.md#making-changes) for the full
fork/branch/PR process. Two CI-enforced requirements to note up front: the
"Validate repository" check runs `npm run test:unit:coverage:check` (coverage
thresholds 99% lines / 100% source / 96% regions / 100% source regions) on every
PR except a document-only one, and every commit must carry a DCO `Signed-off-by`
trailer (`git commit -s`) or CI will fail the PR. A PR that changes only
authored documents (`docs/`, `blog/`, `adr/` and the root documents listed in
`scripts/lib/content-only-ci.mjs`, not data-backed pages or generated files)
takes a focused path
([ADR 0011](./adr/0011-content-focused-validation-for-documentation.md)): the
coverage gate, advisory audit, data validators and browser suites are skipped,
and the changed documents alone are linted and checked against the document
contracts. Every other PR, including data, generated-content and mixed changes,
takes the full path.

## Build & Test

- **Install**: `npm ci` — installs the exact versions in `package-lock.json`, as
  CI does. Use `npm install <package>` only to add or upgrade a dependency on
  purpose; it re-resolves the semver ranges and rewrites the lockfile.
- **Start Dev Server**: `npm run docus:start`
- **Build**: `npm run build`
- **Unit Tests**: `npm run test:unit:coverage:check` — part of the required
  "Validate repository" CI check on every PR except a document-only one, which
  takes the focused path described above; it runs the suite under the coverage
  gate whose thresholds are listed in
  [`CONTRIBUTING.md`](CONTRIBUTING.md#making-changes). The thresholds are frozen
  regression gates, not targets
  ([ADR 0008](./adr/0008-scope-agent-findings-to-user-observable-change.md)).
  `npm run test:unit` alone skips the gate.
- **End-to-end Tests**: required "End-to-end tests" CI check on every PR except
  a document-only one. Needs a production build first, then a one-time browser
  install:
  `npm run build:production && npx playwright install --with-deps chromium && npm run test:e2e`.
  Specs live in `tests/e2e/`; the suite serves `build/` on `localhost:3000`
  (override with `E2E_PORT`) and does not rebuild it for you.
- **Mutation Tests**: the "Mutation testing" workflow mutates only the `src/`
  and `scripts/lib/` files a PR changes and fails below the `break` score in
  `stryker.config.mjs`; it is not a required check. Run
  `npm run test:mutation -- --mutate <file>[,<file>]` before pushing a change to
  those files and tighten the assertions for any survivor it lists. A survivor
  in a file a PR does not touch is not a finding. See
  [`CONTRIBUTING.md`](CONTRIBUTING.md#mutation-testing).
- **Lint**: the required "Lint repository" CI check runs on every PR. A
  document-only PR lints just the changed files: markdownlint blocks, while
  Prettier and cspell findings are advisory annotations that do not fail the
  check (ADR 0011 amendment); the "Format documents" workflow then opens a
  `chore: format documents` PR to normalize any drift on `main`. Every other PR
  runs `npm run check:format`,
  `npm run check:spelling`, `npm run check:markdown`,
  `npm run check:duplication`, `npm run check:lint` and `npm run check:unused`.
  `check:lint` runs ESLint (`eslint.config.mjs`) over `src/`, `scripts/`,
  `tests/` and the root config files. `check:unused` runs knip
  (`knip.config.js`) and fails on unused files, exports and dependencies, and on
  undeclared dependencies. `check:duplication` fails when a change adds exact
  clones (jscpd, ceilings in `scripts/check-duplication.mjs`); extract a shared
  helper, CSS module or composite action instead of copying. If the gate asks
  you to lower a ceiling after a change, do so in the same PR. A clone that is
  already under the ceiling is not a finding.
- **Data Changes**: Data files under `/data/` have their own validators; see the
  data contribution model table in
  [`CONTRIBUTING.md`](CONTRIBUTING.md#data-contribution-model).

## Guidelines for Agents

- **Remit**: An agent-filed issue or PR must name a defect an end user can
  observe on the production site, a security or supply-chain exposure, a
  required CI check failing on `main` or fleet-wide, a generated-data or
  dependency refresh through its existing lane, or an issue a maintainer filed
  for agent work. Anything else is out of remit. In particular, a change whose
  only effect is to move a metric (mutation score or surviving mutants, unit or
  browser coverage, clone count, test-prose or harness shape) gets at most one
  comment on the advisory issue (#23), never an issue or PR. The coverage,
  mutation and clone thresholds are frozen regression gates, not targets
  ([ADR 0008](./adr/0008-scope-agent-findings-to-user-observable-change.md)).
  State the effect as a `Remit: <effect>` line in the PR description; the PR
  queue hygiene job labels an agent PR without one `needs-human` and leaves the
  label for a maintainer to clear.
- **Decided questions stay decided**: A decision in an ADR, or by a maintainer
  on a closed issue or PR, binds every later finding on the same rule, file or
  component however it is worded. Comment on the original; do not re-file
  ([ADR 0008](./adr/0008-scope-agent-findings-to-user-observable-change.md)).
- **Folded findings**: A PR for a finding that was folded into an existing issue
  says `Refs #N`, never `Fixes`/`Closes`/`Resolves`, unless it also completes
  that issue's own deliverable
  ([ADR 0008](./adr/0008-scope-agent-findings-to-user-observable-change.md)).
- **Duplicate PR prevention**: Before implementing a fix, search open (and
  recently closed) PRs and issues touching the same files or problem. See the
  "Cross-agent duplicate prevention" section of `GOVERNANCE.md` for the full
  policy.
- **Test-only work**: A PR confined to `tests/` must state which behavior in
  `src/`, `scripts/`, `docs/`, `data/`, `static/` or `.github/workflows/` would
  regress undetected without it. Guards over the test tree itself (citation
  pins, listing reach, harness-of-harness tests) are out of agent remit unless a
  maintainer files the issue
  ([ADR 0006](./adr/0006-retire-line-number-citations-in-test-prose.md)).
- **Browser-coverage work**: A region the end-to-end coverage lane does not
  reach is only worth an issue or PR when an end user can reach that state on a
  production build. Data-shape guards (absent, null or malformed data) are
  covered by unit tests and get no new fixture build
  ([ADR 0007](./adr/0007-scope-end-to-end-coverage-to-user-reachable-states.md)).
- **Audience**: Content is for CNCF end users (adopters), not project
  contributors. Contributor-facing material belongs on contribute.cncf.io.
- **Documentation Standards**: Follow GFM (GitHub Flavored Markdown).
- **No Client Secrets**: Never include proprietary or client-specific framing.
- **No Emojis**: Do not use emojis in content, code, or commit messages.
- **Lazy Loading**: Use the `.agents/skills/` manifest to discover detailed
  instructions for specific tasks (e.g., blog posts, documentation updates).
- **Structure**: Maintain Docusaurus file layout and sidebar configurations
  (`sidebars.js`). The single-page practitioners section intentionally has
  no sidebar; multi-page sections (architectures, which lists only its
  catalog and submission pages so imported architecture pages stay full-width;
  community which includes awards and members; events, whose sidebar is
  derived from the `event:` front matter of `docs/events/<year>/*.md` per
  [ADR 0012](./adr/0012-event-pages-are-the-source-of-the-events-section.md);
  resources) do.
- **Facts**: Verify CNCF facts (award winners, TAB scope, architecture counts)
  against authoritative sources: cncf/tab, cncf/architecture, cncf/landscape,
  and cncf.io announcements. Never assert numbers without a source.

## Metrics

The `/resources/metrics` page is generated from `data/metrics.json`. Refresh it
with `npm run collect:metrics`, validate with `npm run validate:metrics`, and
build with `npm run build`. Do not edit generated metrics data manually; update
`scripts/collect-metrics.mjs` instead.

## Awards

The `/community/awards` page is generated from `data/awards.json`. Winners are
data entries, not hand-built pages. Verify each entry against its cncf.io
announcement link.
