---
title: Resources
description: Case studies and Technology Radar reports from CNCF end users.
sidebar_position: 1
---

import Link from '@docusaurus/Link';

# Resources

Curated, regularly refreshed pointers into the wider CNCF library of end-user
research — real production stories and survey-based technology trend reports.

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
</div>

Both pages are generated from the public [cncf.io](https://www.cncf.io/)
WordPress API and regenerated manually by a maintainer running
`npm run collect:case-studies` / `npm run collect:radar-reports`; there is no
scheduled workflow yet. See
[`data/case-studies.json`](https://github.com/cncf/endusers/blob/main/data/case-studies.json)
and
[`data/radar-reports.json`](https://github.com/cncf/endusers/blob/main/data/radar-reports.json)
for the raw, machine-readable data behind each page.
