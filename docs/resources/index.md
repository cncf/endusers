---
title: Resources
description:
  Case studies, Technology Radar reports, ecosystem metrics, and the site
  changelog for CNCF end users.
sidebar_position: 1
---

import Link from '@docusaurus/Link';

# Resources

Curated, regularly refreshed pointers into the wider CNCF library of end-user
research — real production stories, survey-based technology trend reports, a
transparent snapshot of ecosystem metrics, and a record of what changed on this
site.

## What's here

<div className="pillars pillars-duo">
  <div className="pillar">
    <h3><Link to="/resources/case-studies">Case Studies</Link></h3>
    <p>A searchable, filterable table of every CNCF end-user case study — browse by CNCF project, industry, or country and jump straight to the full write-up on cncf.io.</p>
  </div>
  <div className="pillar">
    <h3><Link to="/resources/radar-reports">Radar Reports</Link></h3>
    <p>Brief summaries of every CNCF Technology Radar report, with links to the full survey-based research on cloud native technology adoption.</p>
  </div>
  <div className="pillar">
    <h3><Link to="/resources/metrics">Metrics</Link></h3>
    <p>A transparent snapshot of CNCF ecosystem and end user activity — reference architecture lifecycle, project counts, and trends — collected from public sources, with every value linked to where it came from.</p>
  </div>
  <div className="pillar">
    <h3><Link to="/resources/changelog">Changelog</Link></h3>
    <p>What changed on this site, newest first, grouped by month and linked to the pull request or commit behind each entry.</p>
  </div>
</div>

Case studies and Radar reports are generated from the public
[cncf.io](https://www.cncf.io/) WordPress API. Radar reports refresh
automatically via the daily
[`refresh-radar-reports.yml`](https://github.com/cncf/endusers/blob/main/.github/workflows/refresh-radar-reports.yml)
workflow, which runs `npm run collect:radar-reports` and opens an automation PR;
case studies are still regenerated manually by a maintainer running
`npm run collect:case-studies`. See
[`data/case-studies.json`](https://github.com/cncf/endusers/blob/main/data/case-studies.json)
and
[`data/radar-reports.json`](https://github.com/cncf/endusers/blob/main/data/radar-reports.json)
for the raw, machine-readable data behind each page.

Metrics are rendered from
[`data/metrics.json`](https://github.com/cncf/endusers/blob/main/data/metrics.json),
refreshed by `npm run collect:metrics` and validated before each site build. The
changelog is generated from git history at build time by
[`scripts/generate-changelog.mjs`](https://github.com/cncf/endusers/blob/main/scripts/generate-changelog.mjs).
