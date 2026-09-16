---
slug: month-in-metrics-august-2026
title: "Month in Metrics: August 2026"
authors: [castrojo]
tags: [metrics, community]
---

This is the first in a monthly series pulled straight from the numbers behind
[/metrics](/metrics/) and [/architectures](/architectures/) — no editorializing, just what
changed and where the data comes from.

{/* truncate */}

## The landscape, by the numbers

As of the latest [CNCF Landscape](https://landscape.cncf.io/) sync, there are **254 CNCF
projects** carrying an official maturity level, spanning categories from Provisioning (64
projects) to newer areas like Wasm and Inference (3 each). That range is the clearest
signal of how far "cloud native" has spread beyond its container-orchestration roots.

## Reference architectures: steady growth

The [cncf/architecture](https://github.com/cncf/architecture) repository — the source for
every [reference architecture](/architectures/) on this site — has grown from 5 submitted
architectures in September 2024 to **27 by June 2026**. Seven of those are currently
published on this site, reviewed through the [End User TAB's submission
process](https://github.com/cncf/tab/blob/main/process/reference-architectures.md).

Behind that growth is an active review pipeline. Per the [TAB's public submission
tracking](https://github.com/cncf/tab/issues?q=is%3Aissue+label%3Aarea%2Freference-architecture),
there are currently **13 open submissions** and **5 open architecture pull requests**, with
a median public PR cycle (creation to merge) of about **1.2 days** once a PR is opened —
though the median time an open submission issue has been waiting is **103.7 days**,
underscoring that the bottleneck is authoring and review, not process throughput.

## Reading these numbers yourself

Every figure above traces back to an authoritative source — the [Metrics
page](/metrics/) links each one, and nothing here is asserted without a source URL. If a
number can't be sourced, it's left out entirely (a handful of figures, like end-user
member counts and Slack membership, currently are, for exactly that reason).

## Bring your own architecture

If your organization has a production cloud native story worth documenting, the [reference
architecture submission
process](https://github.com/cncf/tab/blob/main/process/reference-architectures.md) is how
it ends up in next month's numbers.
