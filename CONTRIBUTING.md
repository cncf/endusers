# Contributing to endusers.cncf.io

Thanks for your interest in contributing to the CNCF End User Community site.
This document covers the development workflow and the data contribution model.

## Development setup

Prerequisites: Node.js 22+ (LTS recommended) and npm.

```bash
npm install
npm run docus:start
```

The dev server runs at `http://localhost:3000`. In the devcontainer:

```bash
npm run docusaurus start -- --host 0.0.0.0 --port 3000 --poll 10000
```

## Content audience

Content on this site speaks to **end users** — the practitioners, architects,
and organizations adopting cloud native — not to project contributors, who are
served by [contribute.cncf.io](https://contribute.cncf.io/). Keep this audience
in mind for every page.

## Data contribution model

Most pages are generated from data files. Contribute by editing the data, not by
hand-building pages:

| Page                            | Data source                                                                                 | Validation                        |
| ------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------- |
| `/awards`                       | `data/awards.json`                                                                          | `npm run validate:awards`         |
| `/metrics`                      | `data/metrics.json` (generated)                                                             | `npm run validate:metrics`        |
| `/architectures`                | `data/architectures/records/*.json`                                                         | `npm run validate:architectures`  |
| `/members`                      | `data/members.json` (generated from `data/awards.json` + `data/architectures/catalog.json`) | `npm run generate:members`        |
| Community people lightboxes     | `data/community-roster.json` (curated) → refreshed into `data/community-people.json`        | `npm run fetch:community-people`  |
| ProjectsBorn (`/practitioners`) | `data/projects-born.json`                                                                   | manual edit, no validation script |

Rules:

- **Never edit `data/metrics.json` by hand.** Refresh it with
  `npm run collect:metrics`; change `scripts/collect-metrics.mjs` instead. Set
  `GH_TOKEN` to a GitHub personal access token with public-repo read access
  before running it — this script makes enough GitHub API calls to exceed the
  unauthenticated rate limit.
- Verify award entries against the linked cncf.io announcement before adding.
- Reference architectures are imported from
  [cncf/architecture](https://github.com/cncf/architecture) — fix content
  upstream, then re-import.
- Verify CNCF facts (award winners, TAB scope, architecture counts) against
  authoritative sources. Never assert numbers without a source.
- **Adding or editing an award winner requires re-running
  `npm run generate:members`** so `/members` stays in sync with
  `data/awards.json`.
- **Never edit `data/community-people.json` by hand.** Add or fix a person in
  `data/community-roster.json`, then refresh with
  `npm run fetch:community-people`. This enriches roster entries with bio,
  location, image, and social links from
  [cncf/people](https://github.com/cncf/people)'s `people.json`, matched by
  GitHub handle; roster name, company, and role stay authoritative.
- `data/projects-born.json` has no generator; edit it directly and verify the
  origin story against a reliable source before adding an entry.

## Blog contributions

The blog is hand-authored Markdown in `blog/`, not generated from a data file.
See [`docs/skills/blog-management.md`](docs/skills/blog-management.md) for
post format, front matter (`blog/authors.yml`/`blog/tags.yml` keys), and the
publishing cadence.

## Style rules

- GitHub Flavored Markdown for all content.
- No emojis in content, code, or commit messages.
- Maintain the Docusaurus layout and `sidebars.js` configuration. Single-page
  sections (practitioners, events, metrics, awards) intentionally have no
  sidebar; multi-page sections (architectures, community) do.

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
`good first issue` and mention in your pull request which one you picked up.
If the query is empty, the docs/typo sweep above is always available, or
check the [open issues list](https://github.com/cncf/endusers/issues) for
something scoped enough for a first contribution.

## Making changes

1. Fork the repository and create a branch from `main`.
2. Make your change and run the relevant validation script.
3. Run `npm run test:unit` — the required "Validate repository" check runs this on every PR.
4. Verify with `npm run build` before opening a PR.
5. Commit with a DCO sign-off: `git commit -s`. CI enforces this and will fail
   the PR if any commit is missing a `Signed-off-by` trailer. If you forget,
   fix it before pushing (or after, then force-push) with
   `git rebase --signoff main`.
6. Open a pull request against `main` describing what changed and why.

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
