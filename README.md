# endusers.cncf.io

The home of the [CNCF End User Community](https://www.cncf.io/enduser/): the
organizations running cloud native technologies in production. This site
collects the community's reference architectures, awards, metrics, events, and
pathways to participate.

## What lives here

- **Practitioners** — the landing page for people operating cloud native systems
  in production
- **Architectures** — real-world reference architectures imported from
  [cncf/architecture](https://github.com/cncf/architecture)
- **Community** — the End User Technical Advisory Board (TAB), End User Groups,
  ways to engage, the directory of member organizations, and the organizations
  recognized with CNCF End User awards
- **Projects from end users** — open source projects born at end-user
  organizations
- **Metrics** — ecosystem and end-user metrics generated from authoritative
  public sources
- **Events** — end user gatherings at KubeCon + CloudNativeCon
- **Blog** — stories and updates from the CNCF End User Community

## Setup locally

### Prerequisites

Ensure you have the following installed:

- [Node.js](https://nodejs.org/) (LTS version 22 or above recommended)
- [npm](https://www.npmjs.com/) (comes with Node.js)

### Install dependencies

```bash
npm install
```

### Run the site

```bash
npm run docus:start
```

This starts the development server, typically at `http://localhost:3000`.

If you are using the devcontainer:

```bash
npm run docusaurus start -- --host 0.0.0.0 --port 3000 --poll 10000
```

## Deployment

The site currently deploys to GitHub Pages at
[cncf.github.io/endusers](https://cncf.github.io/endusers/). The build process
is configured with:

- `SITE_URL: 'https://castrojo.github.io'` (temporary override; see below)
- `BASE_URL: '/endusers/'` (temporary override; see below)

(These are set in `.github/workflows/deploy-gh-pages.yml` and will be updated
when a custom domain is active.)

The long-term target is [endusers.cncf.io](https://endusers.cncf.io/), which is
currently a pending DNS cutover. When that domain is verified and active, the
workflow will update the configuration to:

- `url: 'https://endusers.cncf.io'`
- `baseUrl: '/'`

See [ADR 0001](./adr/0001-site-ownership-and-cutover-path.md) and
[issue #46](https://github.com/cncf/endusers/issues/46) for the ownership and
cutover plan.

## Metrics data

The `/metrics` page is generated from public CNCF repositories. Before running
the refresh, set `GH_TOKEN` to a GitHub personal access token with public-repo
read access — the script makes enough GitHub API calls to exceed the
unauthenticated rate limit. Then run `npm run collect:metrics` to refresh
`data/metrics.json`, followed by `npm run validate:metrics` and `npm run build`.
Generated metrics data should not be edited manually. Landscape-derived values
come from `cncf/landscape/landscape.yml`; architecture counts come from
`cncf/architecture`. Values without an authoritative source are intentionally
omitted.

## Awards data

The `/awards` page is generated from `data/awards.json`. Each winner is a data
entry (year, award, organization, logo, citation, links) — see the schema notes
in that file. Verify new entries against the linked cncf.io announcement before
adding them.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and data
contribution model. File issues with your ideas, or dive in with a pull request.
Content should speak to end users — the practitioners, architects, and
organizations adopting cloud native — rather than to project contributors, who
are served by [contribute.cncf.io](https://contribute.cncf.io/). See
[MAINTAINERS.md](./MAINTAINERS.md) for who reviews changes and how to become a
maintainer.

## License

Content in this repository is licensed under
[Creative Commons Attribution 4.0 International (CC-BY-4.0)](LICENSE),
consistent with the `license` field in `package.json`.
