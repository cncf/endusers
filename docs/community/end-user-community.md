---
title: End User Community
sidebar_position: 1
description:
  CNCF End User Community governance, groups, and ways to participate.
---

The CNCF End User Community connects organizations running cloud native
technologies in production. Find the people, groups, meetings, and practical
resources that help end users learn from one another and shape CNCF priorities.

## Start here

<div className="action-row">
  <a href="https://slack.cncf.io/">Join CNCF Slack</a>
  <a href="https://lists.cncf.io/g/cncf-enduser" className="secondary">Subscribe to the mailing list</a>
  <a href="https://www.cncf.io/enduser/" className="secondary">Bring your organization in</a>
</div>

- **Join the conversation:** Subscribe to the
  [End User mailing list](https://lists.cncf.io/g/cncf-enduser) or join the
  `#enduser` channel in [CNCF Slack](https://slack.cncf.io/).
- **Bring your organization in:** Learn about
  [joining the CNCF End User Community](https://www.cncf.io/enduser/).
- **Find a peer group:** Browse the [End User Groups](#end-user-groups) for
  industry-focused collaboration.
- **Share an architecture:** Follow the
  [Reference Architecture Submission Process](https://github.com/cncf/tab/blob/main/process/reference-architectures.md).
- **Explore adoption data:** Visit the
  [CNCF Technology Radar](https://radar.cncf.io/) and the
  [CNCF case studies](https://www.cncf.io/case-studies/).

## End User Technical Advisory Board (TAB)

The [CNCF End User Technical Advisory Board](https://github.com/cncf/tab)
represents end users within the CNCF community. The TAB helps surface end-user
needs, improve visibility into CNCF project adoption, advise on technical
direction, and review reference architectures.

import CommunityPeople from '@site/src/components/CommunityPeople';
import PeopleFreshness from '@site/src/components/PeopleFreshness';
import GroupLinkStatus from '@site/src/components/GroupLinkStatus';

### TAB members

<PeopleFreshness />

<CommunityPeople section="tab" />

### TAB responsibilities

- Facilitate communication between end users and CNCF governing bodies.
- Advise the
  [CNCF Technical Oversight Committee (TOC)](https://github.com/cncf/toc) on
  technical directions and challenges in the cloud native ecosystem.
- Improve visibility into end-user adoption of CNCF projects.
- Provide feedback on project usability, reliability, and performance.
- Review and approve reference architectures.
- Advise on End User Radar tools and techniques.
- Provide oversight for End User Groups and Special Interest Groups.

See the
[TAB membership and charter](https://github.com/cncf/tab/blob/main/README.md),
[open issues](https://github.com/cncf/tab/issues), and
[discussions](https://github.com/cncf/tab/discussions).

## Community meeting and communication channels

- [CNCF End User mailing list](https://lists.cncf.io/g/cncf-enduser)
- [CNCF Slack](https://slack.cncf.io/), including the `#tab` and `#enduser`
  channels
- [CNCF community platform](https://community.cncf.io/)
- [Public TAB meeting project](https://github.com/orgs/cncf/projects/60)
- [TAB public meeting](https://zoom.us/j/96509520391) — third Monday of each
  month at 8:00 AM Pacific Time

## End User Groups

End User Groups are focused communities for organizations with shared
operational, regulatory, or industry concerns. Each group page links to its
charter, meeting details, and participation channels.

<GroupLinkStatus />

<div className="group-cards">
  <div className="group-card">
    <h3><a href="./financial-services-user-group.md">Financial Services User Group</a></h3>
    <p>Security, regulatory, compliance, and cloud native practices for financial services.</p>
    <div className="group-meta">
      <span className="group-tag">Biweekly Tuesdays</span>
      <span className="group-tag">11:00 AM US/Eastern</span>
    </div>
    <div className="group-actions">
      <a href="https://github.com/cncf/financial-user-group">GitHub</a>
      <a href="https://lists.cncf.io/g/financial-user-group/join">Mailing list</a>
    </div>
  </div>
  <div className="group-card">
    <h3><a href="./research-user-group.md">Research User Group</a></h3>
    <p>Research computing using cloud native technologies, including workloads, resources, and best practices.</p>
    <div className="group-meta">
      <span className="group-tag">1st & 3rd Wednesdays</span>
    </div>
    <div className="group-actions">
      <a href="https://github.com/cncf/research-user-group">GitHub</a>
    </div>
  </div>
  <div className="group-card">
    <h3><a href="./public-sector-user-group.md">Public Sector User Group</a></h3>
    <p>Cloud native computing in public-sector environments, from compliance to operational patterns.</p>
    <div className="group-meta">
      <span className="group-tag">Biweekly Wednesdays</span>
      <span className="group-tag">2:00 PM US/Eastern</span>
    </div>
    <div className="group-actions">
      <a href="https://github.com/cncf/public-sector-user-group">GitHub</a>
      <a href="https://community.cncf.io/public-sector-user-group/">Community page</a>
    </div>
  </div>
  <div className="group-card">
    <h3><a href="./telecom-user-group.md">Telecom User Group</a></h3>
    <p>Telecom-focused cloud native collaboration and resources.</p>
    <div className="group-actions">
      <a href="https://github.com/cncf/telecom-user-group">GitHub</a>
    </div>
  </div>
  <div className="group-card">
    <h3><a href="./transportation-user-group.md">Transportation User Group</a></h3>
    <p>Transportation-focused end-user collaboration.</p>
    <div className="group-actions">
      <a href="https://github.com/cncf/transportation-user-group">GitHub</a>
    </div>
  </div>
  <div className="group-card">
    <h3><a href="./cartografos-working-group.md">Cartografos Working Group</a></h3>
    <p>Helps adopters navigate the CNCF landscape through the Cloud Native Maturity Model and reference guides.</p>
    <div className="group-actions">
      <a href="https://github.com/cncf/cartografos">GitHub</a>
      <a href="https://maturitymodel.cncf.io/">Maturity Model</a>
    </div>
  </div>
</div>

## Reference architectures

The TAB-led
[Reference Architecture Submission Process](https://github.com/cncf/tab/blob/main/process/reference-architectures.md)
describes how to submit a real-world architecture for peer and TAB review.
Browse the [architecture catalog](/architectures/).

Submissions can begin with a
[GitHub issue using the reference architecture template](https://github.com/cncf/tab/issues/new?template=reference-architecture.yml),
or with the
[pull request template](https://github.com/cncf/tab/blob/main/operations/templates/template-reference-architecture.md)
when the material is ready.

## End User Technology Radar

The
[CNCF Technology Radar](https://github.com/cncf/tab/tree/main/end-user-tech-radar)
captures end-user technology adoption data. The repository includes the
[radar data](https://github.com/cncf/tab/tree/main/end-user-tech-radar) and the
[CNCF Radar application](https://github.com/cncf/radar).

## Contribution ladder

You do not need to be a maintainer to contribute to the End User Community.
Start small and move up as your time and interest allow.

1. **Listen and connect** — Join `#enduser` on
   [CNCF Slack](https://slack.cncf.io/) and subscribe to the
   [End User mailing list](https://lists.cncf.io/g/cncf-enduser).
2. **Show up** — Attend the public [TAB meeting](https://zoom.us/j/96509520391)
   or an [End User Group](#end-user-groups) call.
3. **Share what you know** — Answer questions, recommend a resource, or point
   peers to a [case study](https://www.cncf.io/case-studies/) from your
   experience.
4. **Contribute a reference architecture** — Document a real-world design
   through the
   [reference architecture submission process](https://github.com/cncf/tab/blob/main/process/reference-architectures.md).
5. **Help shape direction** — Join an End User Group or the End User TAB to
   advise on priorities and represent end-user needs.

## Projects born at end user organizations

import ProjectsBorn from '@site/src/components/ProjectsBorn';

<ProjectsBorn />

## End User Awards

CNCF recognizes outstanding end user organizations with the
[Top End User Award](/awards). See the [Awards page](/awards) for every winner
since 2018 and how to nominate an organization.

## Related CNCF metrics

- [CNCF End User Community](https://www.cncf.io/enduser/)
- [CNCF TAB repository](https://github.com/cncf/tab)
- [CNCF architecture repository](https://github.com/cncf/architecture)
- [CNCF End User Technology Radar](https://radar.cncf.io/)

## CNCF End User Support Staff

Your membership in the CNCF
[funds full time staff](https://www.cncf.io/membership-hub/) to help coordinate
community efforts. This includes access to community experts with hundreds of
years of collective OSS experience, as well as world class marketing and event
support.

<PeopleFreshness />

<CommunityPeople section="staff" />
