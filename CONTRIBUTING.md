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

The repository's `.npmrc` sets `ignore-scripts=true`, so neither command runs
dependency lifecycle scripts. That is deliberate: CI installs this tree in jobs
that hold a write-scoped `GITHUB_TOKEN`, and no dependency here needs an install
script to work. If a future dependency genuinely does, say so in the pull
request rather than dropping the setting.

The dev server runs at `http://localhost:3000`. In the devcontainer:

```bash
npm run docusaurus start -- --host 0.0.0.0 --port 3000 --poll 10000
```

Two `package.json` scripts deserve a note because nothing else references them:

- `build:preview` is an alias of `build:production` kept for preview-style
  deploys of the production build; the two run the identical command, and the
  Netlify build (`build:netlify`) ends in `build:production`.
- `update:pkgs` (`npx npm-check-updates -u`) is a maintainer-only bulk-refresh
  tool that rewrites every semver range in `package.json` at once. It is not the
  routine upgrade path — that remains per-package `npm install <package>` and
  Dependabot — and any output it produces still lands as a deliberately reviewed
  lockfile commit.

### Justfile shortcuts

If you have [`just`](https://github.com/casey/just) installed, the repository's
`Justfile` provides shortcuts that wrap the npm scripts above:

- `just serve` — start the dev server bound to all interfaces.
- `just refresh` — refresh the metrics dashboard data and the end-user member
  data (`collect:metrics`, `collect:enduser-members`,
  `validate:enduser-members`, `generate:members`, `validate:members`,
  `validate:metrics` — these steps clone `cncf/landscape` and
  `cncf/architecture` from GitHub and call the GitHub API, so they need network
  access and `GH_TOKEN`).
- `just build` — run the data validators (`validate:architectures`,
  `validate:architecture-assets`, `validate:metrics`, `validate:awards`,
  `validate:community-people`, `validate:community-groups`,
  `validate:case-studies`, `validate:radar-reports`, `validate:projects-born`,
  `validate:end-user-talks`, `validate:button-contrast`,
  `validate:enduser-members`, `validate:members`) followed by `build`.

These recipes are a superset of the validation steps the "Refresh metrics"
workflow runs, and `just build` runs the same `validate:*` set as
`npm run validate:all`, which `npm run build:netlify` runs before the Netlify
build. The recipes are **not** the same checks the "Validate repository" and
"Lint repository" PR gates run, and a green `just build`/`just refresh` locally
does **not** imply a green PR check. Before opening a PR, also run
`npm run test:unit:coverage:check` and the local check scripts that match "Lint
repository": `npm run check:format`, `npm run check:spelling`,
`npm run check:markdown`, `npm run check:duplication`, `npm run check:lint` and
`npm run check:unused`. The "Validate repository" gate additionally runs
`npm run check:audit` (dependency advisory allowlist) — see step 5 below.
`npm run check` also runs the lint checks, but it additionally runs
`check:audit`, `check:links` (network-dependent) and
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

| Page                                      | Data source                                                                                                                                                                   | Validation                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `/community/awards`                       | `data/awards.json`                                                                                                                                                            | `npm run validate:awards`                                         |
| `/resources/metrics`                      | `data/metrics.json` (generated)                                                                                                                                               | `npm run validate:metrics`                                        |
| `/architectures`                          | `data/architectures/records/*.json`                                                                                                                                           | `npm run validate:architectures`                                  |
| `/community/members`                      | `data/enduser-landscape.json` (pinned CNCF landscape snapshot) + `data/members.json` (generated from the snapshot, `data/awards.json`, and `data/architectures/catalog.json`) | `npm run validate:enduser-members` and `npm run validate:members` |
| Community people lightboxes               | `data/community-roster.json` (curated) → refreshed into `data/community-people.json`                                                                                          | `npm run validate:community-people`                               |
| `docs/community/` user groups             | `data/community-groups.json` (generated)                                                                                                                                      | `npm run validate:community-groups`                               |
| ProjectsBorn (`/community/projects-born`) | `data/projects-born.json`                                                                                                                                                     | `npm run validate:projects-born`                                  |
| `/resources/case-studies`                 | `data/case-studies.json` (generated by `npm run collect:case-studies`)                                                                                                        | `npm run validate:case-studies`                                   |
| `/resources/radar-reports`                | `data/radar-reports.json` (generated by `npm run collect:radar-reports`)                                                                                                      | `npm run validate:radar-reports`                                  |
| `/events` end user talks                  | `data/end-user-talks.json` (generated by `npm run collect:end-user-talks`)                                                                                                    | `npm run validate:end-user-talks`                                 |
| `/community/members` logos                | `data/enduser-landscape-assets.json` (generated by `npm run collect:enduser-members`; manifest of the mirrored landscape logos)                                               | `npm run validate:enduser-members`                                |
| `/community/members` logo overrides       | `data/enduser-logo-overrides.json` (curated; a committed, in-limit replacement under `static/img/end-user-members/` for an upstream logo the collector refuses for size)      | `npm run validate:enduser-members`                                |

Rules:

- **Never edit `data/metrics.json` by hand.** Refresh it with
  `npm run collect:metrics`; change `scripts/collect-metrics.mjs` instead. Set
  `GH_TOKEN` to a GitHub personal access token with public-repo read access
  before running it — this script makes enough GitHub API calls to exceed the
  unauthenticated rate limit.
- Verify award entries against the linked cncf.io announcement before adding.
- Reference architecture pages are generated from submission issues by
  `.github/workflows/architecture-submission.yml`; the pages that originated in
  [cncf/architecture](https://github.com/cncf/architecture) are committed
  content, attributed on each page under CC BY 4.0, and are edited here. All
  architecture pages and SVG diagrams must pass the content-security validators
  (`validate:architectures`, `validate:architecture-assets`); the rules they
  enforce — and how to fix an `active content` or `remote reference` failure —
  are documented in [CONTENT-SECURITY.md](CONTENT-SECURITY.md).
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
  origin story against a reliable source, insert the entry in alphabetical order
  by name (the page renders the file in order, and the validator rejects an
  out-of-place entry), and validate with `npm run validate:projects-born`.
- **Never edit `data/community-groups.json` by hand.** Add or rename a group in
  the `GROUPS` list in `scripts/check-community-group-links.mjs`, then refresh
  with `npm run check:community-group-links` (needs `GH_TOKEN`), which records
  each group's archived/reachable status. Validate with
  `npm run validate:community-groups`. The weekly "Refresh community profiles"
  workflow re-runs both and opens a pull request with the result.
- **Never edit `data/end-user-talks.json` by hand.** It mirrors the official
  KubeCon + CloudNativeCon North America 2026 schedule from the public
  Sessionize API. The weekly "Refresh metrics" workflow re-runs
  `npm run collect:end-user-talks` (no `GH_TOKEN` needed) and opens a pull
  request with the result; a maintainer can also run it by hand when the
  conference schedule changes. `npm run validate:end-user-talks` enforces the
  link host allow-list (`events.linuxfoundation.org`, `sessionize.com`) and runs
  as part of `validate:all`, so it gates the Netlify publish build as well as
  CI; the schedule's rendering and the collector's output are additionally
  covered by the unit tests.

## Blog contributions

The blog is hand-authored Markdown in `blog/`, not generated from a data file.
See
[`.agents/skills/blog-management/SKILL.md`](.agents/skills/blog-management/SKILL.md)
for post format, front matter (`blog/authors.yml`/`blog/tags.yml` keys), and the
publishing cadence.

## Reporting content problems and the changelog

Visitors who find incorrect, outdated, or missing content can report it with the
[content issue form](https://github.com/cncf/endusers/issues/new?template=content-issue.yml)
(`.github/ISSUE_TEMPLATE/content-issue.yml`), which is linked from the site
footer. Reports land with the `documentation` label.

The site publishes its own changelog at
[`/resources/changelog`](https://endusers.cncf.io/resources/changelog), also
linked from the footer. It is generated from git history on every build by
`scripts/generate-changelog.mjs` (`npm run generate:changelog`), which renders
the reader-visible Conventional Commits types (`feat`, `fix`, `docs`, `perf`)
from `git log --first-parent` into `docs/resources/changelog.md`. The decision
and its alternatives are recorded in
[`adr/0003-public-changelog-mechanism.md`](adr/0003-public-changelog-mechanism.md).
Two consequences worth knowing:

- The generated page is gitignored; never commit it. `npm run build` and the
  Netlify build regenerate it, so it cannot drift. `npm run docus:start` does
  not run the generator — run `npm run generate:changelog` once if you want the
  page in the dev server.
- Commit subjects become the public changelog text, so write pull request titles
  as if they were headings. A build with no full git history (a shallow
  checkout, for example) renders a fallback page linking GitHub's live merged-PR
  and commit views instead of failing.

## Style rules

- GitHub Flavored Markdown for all content.
- No emojis in content, code, or commit messages.
- Maintain the Docusaurus layout and `sidebars.js` configuration. Single-page
  sections (practitioners, events) intentionally have no sidebar; multi-page
  sections (architectures, which lists only its catalog and submission pages so
  imported architecture pages stay full-width; community which includes awards
  and members; resources) do.
- References in Markdown prose are machine-checked by
  `tests/markdown-references.test.mjs` across every Markdown file in the
  repository except the numbered decision records under `adr/` and the generated
  architecture pages. Each of these must resolve, or the "Validate repository"
  check fails: a site route in backticks, a link, a JSX `to`/`href` or an
  `https://endusers.cncf.io/...` URL (against docs, `src/pages`, blog and
  redirect routes); `npm run <script>` and a bare script name such as
  `validate:metrics` (against `package.json`); `just <recipe>`, inline or in a
  fenced block (against the `Justfile`); a workflow file path or bare file name;
  a workflow or job display name in quotes or backticks followed by workflow,
  check, job or gate; and a sentence stating an ADR's status, which must match
  the record. A deliberate historical reference goes in that test's
  `HISTORICAL_REFERENCES` with its reason.

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
   drops below its thresholds (99% lines / 100% source / 96% regions / 100%
   source regions). The harness under `tests/tools/` is floored separately (100%
   lines / 99% regions, and 98% regions per harness file): it is measured like
   source but reported in its own `harness files` row, so a gap in the test
   apparatus cannot be paid for out of `src/`'s slack. `npm run test:unit` alone
   skips the coverage gate, so a green `test:unit` locally does not guarantee a
   green PR check. If you changed a file under `src/` or `scripts/lib/`, also
   run its mutation tests — see [Mutation testing](#mutation-testing) below.
4. Verify with `npm run build` before opening a PR. If your change touches
   pages, components, or navigation, also run the end-to-end suite — see
   [End-to-end tests](#end-to-end-tests) below.
5. Run `npm run check:format`, `npm run check:spelling`,
   `npm run check:markdown`, `npm run check:duplication`, `npm run check:lint`
   and `npm run check:unused` — the required "Lint repository" check runs these
   six on every PR. If a check fails:
   - `check:format` — run `npm run fix:format` to auto-format.
   - `check:spelling` — add the flagged term to `.cspell.yml` if it's a
     legitimate project word, or fix the typo.
   - `check:markdown` — fix the reported issue, or add an inline disable comment
     per the rules in `.markdownlint.yaml` if the rule doesn't apply.
   - `check:duplication` — runs [jscpd](https://github.com/kucherenko/jscpd)
     twice and fails when either scan counts more exact clones than its ceiling
     in `scripts/check-duplication.mjs`: the code in `tests/`, `src/` and
     `scripts/` (settings in `.jscpd.json`, `CLONE_CEILING`), and the CSS in
     `src/` plus the workflows, composite actions and other YAML in `.github/`
     (settings in `.jscpd.css-yaml.json`, `CSS_YAML_CLONE_CEILING`). The second
     scan uses a lower minimum clone size, because a copied CSS rule or workflow
     step is much shorter than a copied function. Extract the repeated piece
     into a shared helper, CSS module or composite action rather than adding
     another copy; `npx jscpd --config <file>` lists every clone with its lines.
     The ceilings only ever go down: when your change removes enough clones, the
     gate fails with the new count and asks you to lower the constant to it,
     which keeps the headroom from being spent on the next copy.
   - `check:lint` — runs [ESLint](https://eslint.org/) over `src/`, `scripts/`,
     `tests/` and the root config files (settings in `eslint.config.mjs`),
     including the React, React Hooks and jsx-a11y rules for `src/`. Fix the
     reported code; `npx eslint --fix <file>` handles the auto-fixable rules. If
     a rule is wrong for one line, disable it there with
     `// eslint-disable-next-line <rule> -- <reason>`.
   - `check:unused` — runs [knip](https://knip.dev/) (settings in
     `knip.config.js`) and fails on files nothing imports, exports nothing uses,
     and dependencies that are unused or used without being declared in
     `package.json`. Delete the dead code or dependency, or drop the `export`
     keyword from a value used only in its own module. If knip is wrong because
     something is reached in a way it cannot see, add an ignore entry with a
     one-line reason to `knip.config.js`.

   The "Validate repository" check also runs `npm run check:audit` on every PR,
   which fails differently from the lint checks:
   - `check:audit` — fails the build on any high/critical dependency advisory
     not in the allowlist (see "Known unpatched dependency advisories" in
     [`SECURITY.md`](SECURITY.md)), and on any moderate/low advisory that
     `npm audit fix --package-lock-only` can already patch in range. The
     advisory database updates daily, so a branch that was green yesterday can
     fail with no code change. Do **not** run `npm audit fix --force`; flag the
     failure for maintainers, who own the allowlist in `scripts/audit-gate.mjs`.
     When the advisory has a patched release, first look for the Dependabot
     security update: a lockfile-only patch or minor fix is queued to merge
     automatically (see "Low-risk merge classes" in
     [`GOVERNANCE.md`](GOVERNANCE.md)), so a hand-made lockfile bump would
     duplicate it.

   `npm run check` runs the lint checks plus three more scripts that the PR
   gates enforce separately ("Validate repository") or not at all, so treat it
   as a superset rather than a drop-in for the CI checks:
   - `check:audit` — see above; part of "Validate repository", not "Lint
     repository".
   - `check:links` — runs `markdown-link-check` over every `*.md` file in the
     repository, including `docs/` and `blog/`, and then
     `scripts/check-data-links.mjs` over every outbound URL the site renders
     from `data/`. Both halves need network access and can fail for reasons
     unrelated to your change (a linked site being temporarily down, for
     example). If the failure is a rotted URL in a `data/` file, fix the URL
     there; if the fix belongs to an upstream source the data mirrors, add the
     URL to `KNOWN_BROKEN_URLS` in `scripts/lib/data-links.mjs` with a note on
     what tracks the upstream fix.
   - `check:community-group-links` — needs `GH_TOKEN` set to avoid the
     unauthenticated GitHub rate limit. It updates `data/community-groups.json`
     and its `generatedAt` timestamp only when group status content changes.

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

`--with-deps` runs `apt-get install`, so it needs root. Without the OS packages
the browser bundle is present but will not launch, and every test fails with
`browserType.launch: Target page, context or browser has been closed`, which
names neither the missing library nor the install step. On a machine where you
are not root (an unprivileged container, a shared dev host), unpack the same
packages into a private sysroot and point the loader at it instead. The browser
bundle itself installs fine as an ordinary user:

<!-- cspell:disable -->

```bash
npx playwright install chromium       # the browser bundle only, no --with-deps
mkdir -p /tmp/sysroot/apt/{state,cache}/ /tmp/debs
printf 'Dir::State "/tmp/sysroot/apt/state";\nDir::State::status "/tmp/sysroot/apt/state/status";\nDir::Cache "/tmp/sysroot/apt/cache";\n' > /tmp/sysroot/apt.conf
touch /tmp/sysroot/apt/state/status
export APT_CONFIG=/tmp/sysroot/apt.conf
apt-get update
cd /tmp/debs && apt-get download \
  libglib2.0-0t64 libnspr4 libnss3 libdbus-1-3 libatk1.0-0t64 \
  libatk-bridge2.0-0t64 libatspi2.0-0t64 libx11-6 libxcomposite1 libxdamage1 \
  libxext6 libxfixes3 libxrandr2 libgbm1 libxcb1 libxkbcommon0 libasound2t64 \
  libpango-1.0-0 libcairo2 libcups2t64 libexpat1 libudev1 libdrm2 \
  libwayland-client0 libxrender1 libxau6 libxdmcp6 libxi6 \
  libavahi-common3 libavahi-client3 libpng16-16t64 libfontconfig1 libfreetype6 \
  libxcb-render0 libxcb-shm0 libpixman-1-0 libfribidi0 libthai0 libharfbuzz0b \
  libgraphite2-3 libthai-data libdatrie1 libbrotli1 libbsd0 libmd0
for d in *.deb; do dpkg-deb -x "$d" /tmp/sysroot/fs; done
cd - && export LD_LIBRARY_PATH=/tmp/sysroot/fs/usr/lib/x86_64-linux-gnu:/tmp/sysroot/fs/lib/x86_64-linux-gnu
```

<!-- cspell:enable -->

The first 28 names are the packages Playwright itself installs on Debian and
Ubuntu plus the four the `chrome-headless-shell` binary needs beyond them; the
last 17 are what the full `chrome` binary additionally loads, so a headed or
`channel: 'chromium'` run works too. Both binaries have to resolve, so check
both. Zero `not found` lines on each is the goal:

```bash
for b in ~/.cache/ms-playwright/chromium*/*/chrome \
         ~/.cache/ms-playwright/chromium*/*/chrome-headless-shell; do
  echo "$b: $(ldd "$b" | grep -c 'not found') missing"
done
```

Two things that look like failures and are not: `apt-get download` may print
`rm: cannot remove '/var/cache/apt/archives/partial/*.deb': Permission denied`
on a host whose `/var/cache/apt` is root-owned (the download still succeeds and
exits 0), and the `LD_LIBRARY_PATH` export is per shell, so set it again in a
new terminal before `npm run test:e2e`. Do not set `XDG_CACHE_HOME` for the run:
Playwright resolves the downloaded browser under it, and overriding it makes
every test fail with "Executable doesn't exist at ...". On an `arm64` host
substitute `aarch64-linux-gnu` for `x86_64-linux-gnu` in the loader path.

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
  --check-source 100 --check-source-regions 96 \
  --require-source-files \
  --json "coverage/e2e/$RUN_ID-report.json" \
  --text "coverage/e2e/$RUN_ID-report.txt"
```

The report is source-mapped back to `src/**`. The thresholds above are the ones
the `e2e-coverage` job in `.github/workflows/ci.yml` enforces, so a local render
that omits them passes where CI fails; `tests/e2e-coverage-gate.test.mjs` holds
floors under them. Invalid maps, stale manifests, and empty aggregate
attribution fail visibly and leave their raw artifacts for review.

The report's "Uncovered regions" section lists each zero-count region by span. A
region that
[ADR 0007](adr/0007-scope-end-to-end-coverage-to-user-reachable-states.md)
classes as a `data-shape-guard` or `span-drift` may be recorded in
`tests/e2e/fixtures/accepted-regions.json` with that span, its class and a
one-line reason; the reporter then counts it as neither covered nor uncovered
and lists it under "Accepted regions" instead. Nothing else qualifies, and the
floors do not change. An entry whose span the run now covers, or no longer
reports, is stale and fails the report until it is removed.

Compare percentages from equivalent build, browser and reporting toolchains,
including the Node major CI pins. These are _region_ counts: the denominator can
move between toolchains even when the code and suite do not. The same commit
measures 97.29% source regions on the major the job pins and 97.73% on a newer
runtime, and per file the gap is wider still: `DirectoryFreshness.js` is 11/15
(73.33%) on the pinned major (node 22.23.3) and 9/10 (90.00%) on v26.10.0. A
local render on a newer runtime therefore reports headroom the gate does not
have, and ratcheting a floor to match it turns the required job red.
`tests/e2e-coverage-gate.test.mjs` records the major its floors were measured on
and fails if the job moves off it. The counts also move between patch releases
of that major, so a small same-major difference is not by itself evidence of a
code change.

Reports distinguish `buildRuntimes`, `captureRuntimes` and `reporterRuntime`.
Coverage builds record their Node/V8 identity; captures record Node/V8,
Playwright and the browser's product/V8 versions. Chromium V8 produces the raw
browser ranges, not the reporting process's V8. Sealing preserves producer
identities for later re-renders, while `reporterRuntime` identifies the current
renderer. Legacy artifacts explicitly report unknown producer metadata rather
than attributing it to the renderer.

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

An overlay in `tests/e2e/fixtures/data/` only helps where the missing shape is
an _additional_ record. A branch that turns on a document-level field — an
awards file with no verification date, an architectures source with no resolved
revision — cannot be reached that way: clearing the field swaps which arm the
one page renders rather than adding a case, trading covered lines for the arm it
displaces. Those branches get a build of their own. Every directory named
`tests/e2e/fixtures/data-<name>/` declares one: `npm run build:e2e:coverage`
compiles it into `build/e2e-coverage-<name>` with those overlays layered on top
of `tests/e2e/fixtures/data/`, under base URL `/e2e-coverage-<name>/`. One
`docusaurus serve` offers every site at once, so a single Playwright run visits
the real page and each fixture build, and the report unions what each reached —
the builds compile the same `src/**` sources, so their scripts fold onto the
same lines.

Adding a build is adding a directory; nothing else has to be told about it. Pair
the new route with the real one in the spec — on its own, an assertion that a
page omits something passes just as well when the page is broken. Each build is
a full Docusaurus compile, so the coverage job's wall time grows linearly in the
number of these directories: add one when the shape it needs provably conflicts
with every existing build, not as the first reach for a branch an additive
overlay could cover instead. `tests/e2e/data-variants.spec.js` and
`tests/e2e/member-directory-freshness-unlinked.spec.js` are worked examples.

Data overlays reach only components that read `data/*.json`. A branch whose
props arrive through generated MDX — the architecture pages under
`docs/architectures/` are committed files written by the submission importer, so
a prop shape absent from every page is absent from every build — needs the
second mechanism: MDX fixture pages committed under `tests/e2e/fixtures/docs/`.
When `E2E_COVERAGE=1`, `docusaurus.config.js` registers an extra docs-plugin
instance that serves them at the `/e2e-coverage-fixtures/` route, where a spec
can render the component with exactly the props the real corpus never supplies.
See `tests/e2e/cncf-project-card.spec.js` for a worked example. Like the data
overlays, nothing outside `E2E_COVERAGE=1` registers the instance, so these
pages never reach a production build or the deployed site.

`npm run build:production`, the gating end-to-end job and the deployed site are
unaffected: nothing outside `E2E_COVERAGE=1` registers the overlay. The coverage
build opts out of the bundler's persistent cache for the same reason — the cache
is keyed on neither the loader nor `E2E_COVERAGE`, so sharing it would replay
overlaid data into the next production build in the same working tree.

## Mutation testing

The unit coverage gate shows that a line ran under test, not that any test would
notice if it changed. Mutation testing checks the second part:
[StrykerJS](https://stryker-mutator.io/docs/stryker-js/introduction/) makes
small changes ("mutants") to the source, such as flipping a condition, emptying
a string or deleting a block, and reruns the unit tests that executed that code.
A mutant that makes a test fail is **killed**. A mutant every test still passes
with has **survived**: the code it changed is behaviour no test asserts.

```bash
npm run test:mutation                     # every file in src/ and scripts/lib/
npm run test:mutation -- --mutate scripts/lib/url-safety.mjs
npm run test:mutation -- --mutate 'src/components/shared/*.js,scripts/lib/changelog.mjs'
```

A full run takes about twenty minutes with the configured four workers (the
weekly CI run mutates the full tree in roughly that time); a run over one or two
files takes about a minute, most of it the initial test run that records which
test files reach which mutants. Configuration lives in `stryker.config.mjs`.
Stryker runs the suite in a copy of the repository under `.stryker-tmp/` and
writes its report to `reports/mutation/` (both gitignored).

The "Mutation testing" workflow (`.github/workflows/mutation.yml`) runs on every
pull request, but only over the `src/` and `scripts/lib/` files the pull request
adds or modifies, and fails when their combined mutation score is below the
`break` threshold in `stryker.config.mjs`. That threshold was set from the full
baseline on `main` and never sits above it. "Run workflow" mutates everything on
request and keeps the report as the `mutation-report` artifact; the `break`
threshold stands down there, because a red full-tree run over the standing
backlog gates nothing. There is no scheduled full-tree run: the list of
surviving mutants is a maintainer's diagnostic, not a work queue
([ADR 0008](adr/0008-scope-agent-findings-to-user-observable-change.md)). The
check is not required for merging.

Reading the result:

- The terminal table gives each file's score: killed and timed-out mutants over
  all valid mutants. "No cov" counts mutants that no in-process test executes;
  code reached only through a spawned `node scripts/...` child process shows up
  here, because Stryker cannot see coverage in a child process.
- Each surviving mutant is printed as a diff of the original and mutated line,
  for example `-  if (!url) return null;` / `+  if (false) return null;`. Open
  `reports/mutation/mutation.html` for the same list highlighted in the source.
- Kill a survivor by adding or tightening an assertion that fails under the
  mutated code. If the mutant cannot change observable behaviour (an equivalent
  mutant, such as a redundant guard), simplify the code instead, or as a last
  resort disable that mutator on the line with a
  `// Stryker disable next-line <mutator>: <reason>` comment. The directive
  attaches to the statement, declaration or expression that starts on the next
  line; for an `else if` test put the comment inline inside the parentheses, and
  for a node in the middle of a call chain or template literal wrap the
  enclosing statement in `// Stryker disable <mutator>: <reason>` and
  `// Stryker restore <mutator>` instead. A mutant that is already Ignored in
  the report has been triaged this way and does not need an issue.
- `stryker.config.mjs` excludes the `ArrayDeclaration` mutator (`[]` to
  `["Stryker was here"]`): every instance that survived on main seeded an
  accumulator or fallback whose contents are unobservable.

The tests run in Stryker's instrumented copy of the source, so a test that reads
a `src/` or `scripts/lib/` file as text fails there for reasons unrelated to any
mutant. `stryker.config.mjs` lists those test files and test names to leave out;
add a new source-text test to that list if the initial test run fails on it.

## Agent contributors

AI agents should start at [`AGENTS.md`](AGENTS.md) and the skill manifest in
[`.agents/skills/manifest.md`](.agents/skills/manifest.md).

## Project direction and policies

- [`GOVERNANCE.md`](GOVERNANCE.md) — how decisions get made and how pull
  requests land.
- [`SECURITY.md`](SECURITY.md) — how to report a vulnerability.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — community participation
  expectations.

## Maintainers

See [`MAINTAINERS.md`](MAINTAINERS.md) for who reviews and merges changes here,
and the process for becoming a maintainer.
