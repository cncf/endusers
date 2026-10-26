---
title: Metrics
description: Current CNCF end user and ecosystem metrics.
sidebar_position: 4
hide_table_of_contents: true
---

# Metrics

A transparent snapshot of CNCF ecosystem and end user activity, collected from
public sources.

import MetricsDashboard from '@site/src/components/MetricsDashboard';

<MetricsDashboard />

<figure className="hero-photo">
  <img
    src={require('@site/static/img/metrics-reddit-keynote.jpg').default}
    alt="A Reddit engineer speaking on the KubeCon + CloudNativeCon keynote stage in front of a large Reddit logo"
    width="1748"
    height="673"
  />
  <figcaption>
    End users like Reddit share their production experience from the KubeCon +
    CloudNativeCon keynote stage.
  </figcaption>
</figure>

Metrics are refreshed weekly from public CNCF sources by the scheduled
[`refresh-metrics.yml`](https://github.com/cncf/endusers/blob/main/.github/workflows/refresh-metrics.yml)
workflow, which a maintainer can also run on demand from the Actions tab, and
are validated before each site build. Values unavailable from authoritative
sources are omitted rather than estimated.
