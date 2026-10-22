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
PR, and every commit must carry a DCO `Signed-off-by` trailer (`git commit -s`)
or CI will fail the PR.

## Build & Test

- **Install**: `npm ci` — installs the exact versions in `package-lock.json`, as
  CI does. Use `npm install <package>` only to add or upgrade a dependency on
  purpose; it re-resolves the semver ranges and rewrites the lockfile.
- **Start Dev Server**: `npm run docus:start`
- **Build**: `npm run build`
- **Unit Tests**: `npm run test:unit:coverage:check` — required "Validate
  repository" CI check on every PR; enforces coverage thresholds (99% lines /
  100% source / 96% regions / 100% source regions), plus separate floors for the
  `tests/tools/` harness (100% lines / 99% regions, 98% regions per harness
  file). `npm run test:unit` alone skips the coverage gate.
- **End-to-end Tests**: required "End-to-end tests" CI check on every PR. Needs
  a production build first, then a one-time browser install:
  `npm run build:production && npx playwright install --with-deps chromium && npm run test:e2e`.
  Specs live in `tests/e2e/`; the suite serves `build/` on `localhost:3000`
  (override with `E2E_PORT`) and does not rebuild it for you.
- **Mutation Tests**: `npm run test:mutation` runs StrykerJS over `src/` and
  `scripts/lib/` (config in `stryker.config.mjs`; report in
  `reports/mutation/`). The "Mutation testing" workflow mutates only the files a
  PR changes and fails below the `break` score; it is not a required check. Run
  `npm run test:mutation -- --mutate <file>[,<file>]` before pushing a change to
  those files, and kill the survivors it lists instead of filing them one by
  one. See [`CONTRIBUTING.md`](CONTRIBUTING.md#mutation-testing).
- **Lint**: required "Lint repository" CI check on every PR runs
  `npm run check:format`, `npm run check:spelling`, `npm run check:markdown`,
  `npm run check:duplication`, `npm run check:lint` and `npm run check:unused`.
  `check:lint` runs ESLint (`eslint.config.mjs`) over `src/`, `scripts/`,
  `tests/` and the root config files. `check:unused` runs knip
  (`knip.config.js`) and fails on unused files, exports and dependencies, and on
  undeclared dependencies. `check:duplication` counts exact clones with jscpd in
  two scans, code in `tests/`, `src/` and `scripts/` (`.jscpd.json`) and CSS in
  `src/` plus YAML in `.github/` (`.jscpd.css-yaml.json`), and fails when either
  exceeds its ceiling (`CLONE_CEILING`, `CSS_YAML_CLONE_CEILING`) in
  `scripts/check-duplication.mjs`; extract a shared helper, CSS module or
  composite action instead of copying, and lower a ceiling (never raise it) when
  the gate reports headroom.
- **Data Changes**: Data files under `/data/` have their own validators; see the
  data contribution model table in
  [`CONTRIBUTING.md`](CONTRIBUTING.md#data-contribution-model).

## Guidelines for Agents

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
  (`sidebars.js`). Single-page sections (practitioners, events) intentionally
  have no sidebar; multi-page sections (architectures, which lists only its
  catalog and submission pages so imported architecture pages stay full-width;
  community which includes awards and members; resources) do.
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
