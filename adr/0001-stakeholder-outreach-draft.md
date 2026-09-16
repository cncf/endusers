# Stakeholder outreach draft for ADR 0001

This is a ready-to-send draft supporting [ADR 0001](./0001-site-ownership-and-cutover-path.md)
"Proposed next step" #1: opening a discussion with CNCF end-user/TAB
stakeholders on the long-term home for this site. It exists so a maintainer
can act on that step without first having to draft the outreach themselves.
Nothing here commits the project to an option — the decision still belongs to
the repo owner and CNCF stakeholders (see ADR 0001, "Decision").

## Who to loop in

- **CNCF End User TAB chairs/leads** — the group most directly represented by
  this site's content and audience.
- **CNCF TOC liaison for the End User community** — for org-transfer process
  and precedent from other CNCF-owned sites.
- **CNCF staff contact for cncf.io / contribute.cncf.io infrastructure** — for
  Option C feasibility (merging into an existing property) and DNS/hosting
  questions relevant to Option A.

Suggested venues: the End User TAB's regular meeting (add as an agenda item),
the TAB's mailing list or Slack channel, or a CNCF TOC issue if a formal
decision record is required.

## Draft message

```
Subject: Decision needed — long-term home for endusers.cncf.io

Hi TAB / TOC,

The endusers.cncf.io site (currently developed at castrojo/endusers) has
reached the point where its content pillars (architectures, metrics, awards,
community, events) are taking shape, but its long-term ownership is still
undecided. The repo currently:

- lives in a personal GitHub account, not a CNCF-owned org
- deploys to GitHub Pages at castrojo.github.io/endusers, not the
  endusers.cncf.io domain
- is otherwise built entirely from authoritative CNCF sources (cncf/tab,
  cncf/architecture, cncf/landscape)

We've recorded three options and their tradeoffs in an ADR for discussion:

1. Donate/transfer the repo into the cncf GitHub org and cut over DNS.
2. Keep it as a personal staging site for now and revisit ownership later.
3. Merge its content into an existing CNCF property (e.g. contribute.cncf.io
   or cncf.io) instead of standing up a new site.

Full writeup with pros/cons: [link to ADR 0001 in the merged repo]

Could we get this on an upcoming TAB agenda, or get a read from TOC on the
org-transfer process, so we can record a decision and unblock the Phase 2/3
roadmap items that depend on it (see ROADMAP.md)?

Thanks,
[maintainer name]
```

## After the conversation

1. Record the outcome in ADR 0001's "Decision" section (update Status from
   "Proposed" to "Accepted", with the chosen option and date).
2. Update `ROADMAP.md` Phase 2/3 to reflect the decision and unblock the
   dependent items (DNS cutover, cross-linking, or content-merge plan).
3. Delete or trim this file once the outreach has happened — it is a
   one-time aid, not a living document.
