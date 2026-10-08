# Contributing to endusers.cncf.io

Thanks for your interest in contributing to the CNCF End User Community site.
This document covers the development workflow and the data contribution model.

## Development setup

Prerequisites: Node.js 22+ (LTS recommended) and npm.

```bash
npm ci
npm run docus:start
```

`npm ci` installs the exact, integrity-checked versions in `package-lock.json`,
matching CI. Reach for `npm install <package>` only to add or upgrade a
dependency, and commit the resulting lockfile change deliberately.

The dev server runs at `http://localhost:3000`. In the devcontainer:

```bash
npm run docusaurus start -- --host 0.0.0.0 --port 3000 --poll 10000
```

Two `package.json` scripts deserve a note because nothing else references them:

- `build:preview` is an alias of `build:production` kept for preview-style
  deploys of the production build; the two run the identical command, and the
  deploy workflow uses `build:production`.
- `update:pkgs` (`npx npm-check-updates -u`) is a maintainer-only bulk-refresh
  tool that rewrites every semver range in `package.json` at once. It is not the
  routine upgrade path — that remains per-package `npm install <package>` and
  Dependabot — and any output it produces still lands as a deliberately reviewed
  lockfile commit.

### Justfile shortcuts

If you have [`just`](https://github.com/casey/just) installed, the repository's
`Justfile` provides shortcuts that wrap the npm scripts above:

- `just serve` — start the dev server bound to all interfaces.
- `just import` — refresh end-user member data from `cncf/landscape`
  (`collect:enduser-members`, `validate:enduser-members` — this step clones
  `cncf/landscape` from GitHub, so it needs network access) and then import
  reference architectures and run `import:architectures`,
  `validate:architectures`, and `validate:architecture-assets`.
- `just build` — run the data validators (`validate:architectures`,
  `validate:architecture-assets`, `validate:metrics`, `validate:awards`,
  `validate:community-people`, `validate:community-groups`,
  `validate:launch-metrics`, `validate:case-studies`, `validate:radar-reports`,
  `validate:projects-born`, `validate:button-contrast`,
  `validate:enduser-members`, `validate:members`) followed by `build`.

These recipes are a superset of the validation steps the "Deploy to GitHub
Pages" and "Import reference architectures" workflows run, but they are **not**
the same checks the "Validate repository" and "Lint repository" PR gates run,
and a green `just build`/`just import` locally does **not** imply a green PR
check. Before opening a PR, also run `npm run test:unit:coverage:check` and the
local check scripts that match "Lint repository": `npm run check:format`,
`npm run check:spelling`, and `npm run check:markdown`. The "Validate
repository" gate additionally runs `npm run check:audit` (dependency advisory
allowlist) — see step 5 below. `npm run check` also runs the lint trio, but it
additionally runs `check:audit`, `check:links` (network-dependent) and
`check:community-group-links` (needs `GH_TOKEN` and rewrites
`data/community-groups.json`) — see step 5 below before running the full
`npm run check`. `just` is optional — the npm scripts remain the canonical
interface and work without it.

## Content audience

Content on this site speaks to **end users** — the practitioners, architects,
and organizations adopting cloud native — not to project contributors, who are
served by [contribute.cncf.io](https://contribute.cncf.io/). Keep this audience
in mind for every page.

## Data contribution model

Most pages are generated from data files. Contribute by editing the data, not by
hand-building pages:

| Page                            | Data source                                                                                                                                                                   | Validation                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `/community/awards`             | `data/awards.json`                                                                                                                                                            | `npm run validate:awards`                                         |
| `/metrics`                      | `data/metrics.json` (generated)                                                                                                                                               | `npm run validate:metrics`                                        |
| `/architectures`                | `data/architectures/records/*.json`                                                                                                                                           | `npm run validate:architectures`                                  |
| `/community/members`            | `data/enduser-landscape.json` (pinned CNCF landscape snapshot) + `data/members.json` (generated from the snapshot, `data/awards.json`, and `data/architectures/catalog.json`) | `npm run validate:enduser-members` and `npm run validate:members` |
| Community people lightboxes     | `data/community-roster.json` (curated) → refreshed into `data/community-people.json`                                                                                          | `npm run validate:community-people`                               |
| `docs/community/` user groups   | `data/community-groups.json` (generated)                                                                                                                                      | `npm run validate:community-groups`                               |
| ProjectsBorn (`/practitioners`) | `data/projects-born.json`                                                                                                                                                     | `npm run validate:projects-born`                                  |
| `/resources/case-studies`       | `data/case-studies.json` (generated by `npm run collect:case-studies`)                                                                                                        | `npm run validate:case-studies`                                   |
| `/resources/radar-reports`      | `data/radar-reports.json` (generated by `npm run collect:radar-reports`)                                                                                                      | `npm run validate:radar-reports`                                  |

Rules:

- **Never edit `data/metrics.json` by hand.** Refresh it with
  `npm run collect:metrics`; change `scripts/collect-metrics.mjs` instead. Set
  `GH_TOKEN` to a GitHub personal access token with public-repo read access
  before running it — this script makes enough GitHub API calls to exceed the
  unauthenticated rate limit.
- **Never edit `data/launch-metrics.json` by hand.** It is the machine-checked
  launch success-metrics baseline (issue #100, `LAUNCH.md`). Refresh it with
  `npm run collect:launch-metrics` (needs `GH_TOKEN`) and validate with
  `npm run validate:launch-metrics`.
- Verify award entries against the linked cncf.io announcement before adding.
- Reference architectures are imported from
  [cncf/architecture](https://github.com/cncf/architecture) — fix content
  upstream, then re-import. Imported pages and SVG diagrams must pass the
  content-security validators (`validate:architectures`,
  `validate:architecture-assets`); the rules they enforce — and how to fix an
  `active content` or `remote reference` failure — are documented in
  [CONTENT-SECURITY.md](CONTENT-SECURITY.md).
- Verify CNCF facts (award winners, TAB scope, architecture counts) against
  authoritative sources. Never assert numbers without a source.
- Radar report `summary` fields in `data/radar-reports.json` are hand-written
  and preserved across refreshes by `scripts/collect-radar-reports.mjs`; fill in
  any `PLACEHOLDER` summaries in the automation PR rather than editing the
  script's generated fields.
- **Adding or editing an award winner requires re-running
  `npm run generate:members`** so `/community/members` stays in sync with
  `data/awards.json`. The generator validates its output; refresh the
  authoritative organization roster with `npm run collect:enduser-members` and
  validate the snapshot with `npm run validate:enduser-members` before
  generation; `npm run validate:members` also runs explicitly before CI and
  deployment builds, alongside the existing unit smoke validation.
- **Never edit `data/community-people.json` by hand.** Add or fix a person in
  `data/community-roster.json`, then refresh with
  `npm run fetch:community-people`. This enriches roster entries with bio,
  location, image, and social links from
  [cncf/people](https://github.com/cncf/people)'s `people.json`, matched by
  GitHub handle; roster name, company, and role stay authoritative.
- `data/projects-born.json` has no generator; edit it directly, verify the
  origin story against a reliable source, and validate with
  `npm run validate:projects-born` before adding an entry.
- **Never edit `data/community-groups.json` by hand.** Add or rename a group in
  the `GROUPS` list in `scripts/check-community-group-links.mjs`, then refresh
  with `npm run check:community-group-links` (needs `GH_TOKEN`), which records
  each group's archived/reachable status. Validate with
  `npm run validate:community-groups`.

## Blog contributions

The blog is hand-authored Markdown in `blog/`, not generated from a data file.
See [`docs/skills/blog-management.md`](docs/skills/blog-management.md) for post
format, front matter (`blog/authors.yml`/`blog/tags.yml` keys), and the
publishing cadence.

## Style rules

- GitHub Flavored Markdown for all content.
- No emojis in content, code, or commit messages.
- Maintain the Docusaurus layout and `sidebars.js` configuration. Single-page
  sections (practitioners, events, metrics) intentionally have no sidebar;
  multi-page sections (architectures, community which includes awards and
  members, resources) do.

## Good first issues

New to this repository? Start with an issue labeled
[`good first issue`](https://github.com/cncf/endusers/labels/good%20first%20issue).
These are scoped for a first contribution: each names the file(s) to touch and
the acceptance criteria for the change. There isn't always an open one — see
below for what to do if the query comes up empty.

- **Docs/typo sweep**: Read through `docs/` and the top-level `*.md` files for
  broken links, stale version numbers, or typos and open small, focused fixes.
  No issue required — a PR is enough for this one.

The label query above is the source of truth: pick any open issue carrying
`good first issue` and mention in your pull request which one you picked up. If
the query is empty, the docs/typo sweep above is always available, or check the
[open issues list](https://github.com/cncf/endusers/issues) for something scoped
enough for a first contribution.

## Making changes

1. Fork the repository and create a branch from `main`.
2. Make your change and run the relevant validation script.
3. Run `npm run test:unit:coverage:check` — the required "Validate repository"
   check runs this on every PR, and it fails the build if unit-test coverage
   drops below its thresholds (99% lines / 100% source / 95% regions / 99%
   source regions). `npm run test:unit` alone skips the coverage gate, so a
   green `test:unit` locally does not guarantee a green PR check.
4. Verify with `npm run build` before opening a PR. If your change touches
   pages, components, or navigation, also run the end-to-end suite — see
   [End-to-end tests](#end-to-end-tests) below.
5. Run `npm run check:format`, `npm run check:spelling`, and
   `npm run check:markdown` — the required "Lint repository" check runs these
   three on every PR. If a check fails:
   - `check:format` — run `npm run fix:format` to auto-format.
   - `check:spelling` — add the flagged term to `.cspell.yml` if it's a
     legitimate project word, or fix the typo.
   - `check:markdown` — fix the reported issue, or add an inline disable comment
     per the rules in `.markdownlint.yaml` if the rule doesn't apply.

   The "Validate repository" check also runs `npm run check:audit` on every PR,
   which fails differently from the lint trio:
   - `check:audit` — fails the build on any high/critical dependency advisory
     not in the allowlist (see "Known unpatched dependency advisories" in
     [`SECURITY.md`](SECURITY.md)). The advisory database updates daily, so a
     branch that was green yesterday can fail with no code change. Do **not**
     run `npm audit fix --force`; flag the failure for maintainers, who own the
     allowlist in `scripts/audit-gate.mjs`.

   `npm run check` runs the lint trio plus three more scripts that the PR gates
   enforce separately ("Validate repository") or not at all, so treat it as a
   superset rather than a drop-in for the CI checks:
   - `check:audit` — see above; part of "Validate repository", not "Lint
     repository".
   - `check:links` — runs `markdown-link-check` over every root-level `*.md`
     file; it needs network access and can fail for reasons unrelated to your
     change (a linked site being temporarily down, for example).
   - `check:community-group-links` — needs `GH_TOKEN` set to avoid the
     unauthenticated GitHub rate limit, and unconditionally rewrites
     `data/community-groups.json` with a fresh `checkedAt` timestamp. Only
     commit that file's diff when you intentionally meant to refresh group
     status; otherwise revert it before opening your PR.

6. Commit with a DCO sign-off: `git commit -s`. CI enforces this and will fail
   the PR if any commit is missing a `Signed-off-by` trailer. If you forget, fix
   it before pushing (or after, then force-push) with
   `git rebase --signoff main`.
7. Open a pull request against `main` describing what changed and why.

## End-to-end tests

The Playwright suite in `tests/e2e/` exercises the built site in a browser and
is a required "End-to-end tests" CI check on every PR. It has two prerequisites
that `npm run test:e2e` does not handle for you:

```bash
npm run build:production      # required first: the suite serves build/, it
                               # does not build it
npx playwright install --with-deps chromium   # once per machine: downloads the
                               # browser and the OS packages it needs to launch
npm run test:e2e
```

The suite starts its own server on `localhost:3000` (override with `E2E_PORT`)
and serves the static output already built in `build/` via `docusaurus serve` —
it does not rebuild your changes, so re-run `npm run build:production` after
each edit before re-running the suite.

Browser source coverage is opt-in and is not part of the required e2e command.
Use a fresh run directory for each capture so artifacts from an earlier run
cannot be mixed into the report:

```bash
RUN_ID="local-$(date +%s)"
RUN_DIR="coverage/e2e/$RUN_ID"
node tests/tools/e2e-coverage-run.mjs init --dir "$RUN_DIR" --run-id "$RUN_ID"
E2E_COVERAGE_DIR="$RUN_DIR" E2E_COVERAGE_RUN_ID="$RUN_ID" \
  npm run build:e2e:coverage
E2E_COVERAGE_DIR="$RUN_DIR" E2E_COVERAGE_RUN_ID="$RUN_ID" \
  npm run test:e2e:coverage
node tests/tools/e2e-coverage-run.mjs seal \
  --dir "$RUN_DIR" --status passed
npm run report:e2e:coverage -- \
  --input "$RUN_DIR" --build build \
  --check-source 100 --check-source-regions 91 \
  --require-source-files \
  --json "coverage/e2e/$RUN_ID-report.json" \
  --text "coverage/e2e/$RUN_ID-report.txt"
```

The report is source-mapped back to `src/**`. The thresholds above are the ones
the `e2e-coverage` job in `.github/workflows/ci.yml` enforces, so a local render
that omits them passes where CI fails; `tests/e2e-coverage-gate.test.mjs` holds
floors under them. Invalid maps, stale manifests, and empty aggregate
attribution fail visibly and leave their raw artifacts for review.

Some component branches render only for data shapes the checked-in `data/*.json`
never take — an archived End User Group, a person with neither role nor company,
an organization holding both membership roles. The components read those files
at build time, so no browser test can reach those branches against the shipped
data. `npm run build:e2e:coverage` therefore applies the overlays committed
under `tests/e2e/fixtures/data/`, which add the missing records to the data the
coverage build compiles. Each overlay states only its delta, and every path it
names must still exist in the real file, so a regenerated data file fails the
build rather than quietly taking the coverage with it. See
[`tests/tools/e2e-data-fixtures.cjs`](tests/tools/e2e-data-fixtures.cjs) for the
format, and `tests/e2e/data-fixtures.spec.js` for the specs that drive the
branches. A spec that asserts against a data file should read it through
`loadSiteData()` so it describes the build it is running against.

Data overlays reach only components that read `data/*.json`. A branch whose
props arrive through generated MDX — the architecture pages under
`docs/architectures/` are committed output of `npm run import:architectures`, so
a prop shape absent from every imported page is absent from every build — needs
the second mechanism: MDX fixture pages committed under
`tests/e2e/fixtures/docs/`. When `E2E_COVERAGE=1`, `docusaurus.config.js`
registers an extra docs-plugin instance that serves them at the
`/e2e-coverage-fixtures/` route, where a spec can render the component with
exactly the props the real corpus never supplies. See
`tests/e2e/cncf-project-card.spec.js` for a worked example. Like the data
overlays, nothing outside `E2E_COVERAGE=1` registers the instance, so these
pages never reach a production build or the deployed site.

`npm run build:production`, the gating end-to-end job and the deployed site are
unaffected: nothing outside `E2E_COVERAGE=1` registers the overlay. The coverage
build opts out of the bundler's persistent cache for the same reason — the cache
is keyed on neither the loader nor `E2E_COVERAGE`, so sharing it would replay
overlaid data into the next production build in the same working tree.

## Agent contributors

AI agents should start at [`AGENTS.md`](AGENTS.md) and the skill manifest in
[`docs/skills/manifest.md`](docs/skills/manifest.md).

## Project direction and policies

- [`ROADMAP.md`](ROADMAP.md) — what the site is building toward and the current
  phase.
- [`GOVERNANCE.md`](GOVERNANCE.md) — how decisions get made and how pull
  requests land.
- [`SECURITY.md`](SECURITY.md) — how to report a vulnerability.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — community participation
  expectations.

## Maintainers

See [`MAINTAINERS.md`](MAINTAINERS.md) for who reviews and merges changes here,
and the process for becoming a maintainer.
