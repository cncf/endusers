---
title: Metrics
description: Current CNCF end user and ecosystem metrics.
sidebar_position: 1
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

Metrics are refreshed on demand from public CNCF sources via the "Import
reference architectures" workflow and validated before each site build. Values
unavailable from authoritative sources are omitted rather than estimated.
