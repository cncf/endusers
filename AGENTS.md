# Agent Entry Point: CNCF End User Community Repository

This repository hosts endusers.cncf.io, the Docusaurus site for the CNCF End User
Community. It serves practitioners, architects, and organizations running cloud
native technologies in production.

## Navigation

- **Core Documentation**: `/docs/`
- **Blog**: `/blog/`
- **Static Assets**: `/static/`
- **Components/UI**: `/src/`
- **Data (generated + curated)**: `/data/`

## Skills & Capabilities

This repository defines specific skills for AI agents to follow when contributing or managing documentation.

- [Skill Manifest](docs/skills/manifest.md) - Index of all available agent skills.

## Hive Configuration

This repository does not contain a `hive.yaml` or any authorized-repository
allowlist. The Hive orchestrator's `project.repos` configuration is
maintained outside this codebase. If a Hive-filed issue reports a stale or
nonexistent repo entry (for example, a 404 on an authorized repo), that
config lives elsewhere and cannot be corrected with a PR here — flag it to
the Hive maintainers directly.

## Build & Test

- **Install**: `npm install`
- **Start Dev Server**: `npm run docus:start`
- **Build**: `npm run build`

## Guidelines for Agents

- **Audience**: Content is for CNCF end users (adopters), not project contributors.
  Contributor-facing material belongs on contribute.cncf.io.
- **Documentation Standards**: Follow GFM (GitHub Flavored Markdown).
- **No Client Secrets**: Never include proprietary or client-specific framing.
- **No Emojis**: Do not use emojis in content, code, or commit messages.
- **Lazy Loading**: Use the `docs/skills/` manifest to discover detailed instructions for specific tasks (e.g., blog posts, documentation updates).
- **Structure**: Maintain Docusaurus file layout and sidebar configurations (`sidebars.js`).
  Single-page sections (practitioners, events, metrics, awards) intentionally have no
  sidebar; multi-page sections (architectures, community) do.
- **Facts**: Verify CNCF facts (award winners, TAB scope, architecture counts) against
  authoritative sources: cncf/tab, cncf/architecture, cncf/landscape, and cncf.io
  announcements. Never assert numbers without a source.

## Metrics

The `/metrics` page is generated from `data/metrics.json`. Refresh it with `npm run collect:metrics`, validate with `npm run validate:metrics`, and build with `npm run build`. Do not edit generated metrics data manually; update `scripts/collect-metrics.mjs` instead.

## Awards

The `/awards` page is generated from `data/awards.json`. Winners are data entries, not
hand-built pages. Verify each entry against its cncf.io announcement link.
