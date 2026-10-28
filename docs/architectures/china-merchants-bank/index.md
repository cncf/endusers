---
title: "Unified Training and Inference on Kubernetes for Heterogeneous AI Compute at China Merchants Bank"
sidebar_label: "China Merchants Bank"
architecture:
  organization: China Merchants Bank
  summary: China Merchants Bank runs large-model training, LoRA fine-tuning, and online inference on one Kubernetes-based pool of nearly 10,000 heterogeneous accelerator cards, with separate operating policies for each workload type.
  industries:
    - financial-services
    - banking
  tags:
    - ai
    - machine learning
    - llm training
    - llm inference
    - gpu scheduling
    - heterogeneous accelerators
    - multi-tenancy
    - autoscaling
    - platform engineering
  projects:
    - Kubernetes
    - KEDA
    - Prometheus
    - HAMi
    - Fluid
  sourceUrl: https://github.com/cncf/tab/issues/140
  published: 2026-10-28
  updated: 2026-10-28
---

import CNCFProjectCard from '@site/src/components/CNCFProjectCard';

> Submitted by China Merchants Bank and Alibaba Cloud to the CNCF End User Technical Advisory Board via [cncf/tab#140](https://github.com/cncf/tab/issues/140). Documentation is distributed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Relevant CNCF projects

<CNCFProjectCard name="Kubernetes" href="https://www.cncf.io/projects/kubernetes/" logo="/img/cncf-projects/kubernetes-kubernetes-icon-color.svg" description="Shared control plane, Pod orchestration, Deployments, scheduling foundation, and common resource interfaces for both the training and inference paths." />

<CNCFProjectCard name="KEDA" href="https://www.cncf.io/projects/keda/" logo="/img/cncf-projects/keda-keda-icon-color.svg" description="Converts service and demand signals from Prometheus into scaling decisions for online inference workloads." />

<CNCFProjectCard name="Prometheus" href="https://www.cncf.io/projects/prometheus/" logo="/img/cncf-projects/prometheus-prometheus-icon-color.svg" description="Collects QPS, request-queue depth, inference latency, and other operational metrics used for observability and demand-driven scaling." />

<CNCFProjectCard name="HAMi" href="https://www.cncf.io/projects/hami/" logo="/img/cncf-projects/hami-hami-icon-color.svg" description="Pools heterogeneous accelerator resources and allocates accelerator capacity at fine granularity for workloads that can safely share it." />

<CNCFProjectCard name="Fluid" href="https://www.cncf.io/projects/fluid/" logo="/img/cncf-projects/fluid-fluid-icon-color.svg" description="Kubernetes-native access to datasets, model weights, and checkpoints, with a compute-side cache that reduces repeated remote reads and model-loading delays." />

## Organization

China Merchants Bank (CMB) is a nationwide joint-stock commercial bank headquartered in Shenzhen, China. The bank operates an enterprise AI platform with nearly 10,000 heterogeneous accelerator cards sourced from three mainstream domestic vendors. The platform supports Qwen models ranging from 4 billion to 1.6 trillion parameters, along with DeepSeek, GLM, and other model families, and serves large-model training, fine-tuning, online inference, and other AI use cases for the bank.

## Teams

This architecture is owned by the Architecture Management Team in China Merchants Bank's Information Technology Department and was developed together with Alibaba Cloud. The team integrates open source infrastructure and AI runtimes with CMB's internal platforms through Kubernetes-native interfaces.

## Architecture overview and goals

### Context and problem space

China Merchants Bank operates an enterprise AI platform with nearly 10,000 heterogeneous accelerator cards sourced from three mainstream domestic vendors. The platform supports Qwen models ranging from 4 billion to 1.6 trillion parameters, along with DeepSeek, GLM, and other model families. Its workloads include large-model training, fine-tuning, online inference, and other AI use cases. These workloads share the same high-value compute pool but have fundamentally different operating requirements.

Distributed training jobs are long-running and throughput-oriented. They require stable capacity and should begin only when all required workers and accelerator resources are available. Online inference is request-driven and latency-sensitive, so it must scale with changing traffic while avoiding the cost of keeping excess capacity continuously active. Multi-tenant LoRA fine-tuning adds another challenge: tenant state must remain isolated without loading a separate copy of the same large base model for every tenant.

The bank's goal was not simply to add more accelerator cards. It was to use existing capacity more efficiently while preserving workload isolation, operational control, and the ability for training and inference technologies to evolve independently.

### Goals

- Provide one Kubernetes-based control plane while preserving separate execution policies for training and inference.
- Manage training admission and quotas before compute and data resources are provisioned.
- Scale inference services from live demand signals rather than static peak-capacity reservations.
- Share heterogeneous accelerator capacity at fine granularity without allowing smaller workloads to monopolize a full card.
- Reuse one base-model runtime across multiple LoRA tenants while keeping adapters, configurations, and tenant state separate.
- Provide shared access to datasets, model weights, checkpoints, the model registry, and operational metrics.
- Allow training frameworks, inference engines, and models to evolve without tightly coupling the entire platform to one runtime or vendor stack.

### Architecture

The architecture uses one shared Kubernetes foundation with two decoupled workload paths.

**Training path:** Training requests enter through the Training API, a CMB-built pipeline, UI, and scheduler entry point. Kueue applies queue-, quota-, and admission-based control before the workload starts. After admission, Kubernetes Scheduler selects suitable nodes, HAMi assigns accelerator capacity, and Fluid provides access to datasets and checkpoints. Twinkle runs multi-tenant training on Ray and passes the resulting checkpoints into the downstream model-management process. Built on verl, verl-SpeCo supports draft-model training and integrates speculative decoding with vLLM and SGLang.

**Inference path:** Online requests enter through the Inference Gateway. In production, RBG orchestrates role-based and multi-node LLM inference workloads served by vLLM or SGLang, with Ray providing the distributed runtime. Prometheus collects service and demand metrics, and KEDA uses those signals to add or remove replicas. Kubernetes Scheduler and HAMi place new Pods and allocate accelerator resources, while Fluid supplies cached model weights so newly created replicas can become ready more quickly.

Both paths share the Kubernetes control plane, accelerator node pool, data and model access layer, model registry, and observability foundation. They remain separate at the workload-policy and runtime levels so each can use the behavior best suited to its demand pattern.

![Kubernetes-native training and inference architecture. A workload layer holds a training deployment (Twinkle multi-tenant LoRA training, verl-SpeCo draft-model training, and a Ray runtime) fed by the Training API, and an inference deployment (RBG role-based orchestration, vLLM or SGLang serving engine, and a Ray runtime) fed by the Inference Gateway. A platform control layer holds KEDA event-driven autoscaling, Kueue admission and quota, Kubernetes Scheduler Pod placement, HAMi vGPU, memory, and core quota, and the Fluid control plane for datasets, runtimes, and PVCs. A data and resource layer holds the heterogeneous accelerator pool of nearly 10,000 cards from three vendors with the HAMi device plugin, the Fluid cache runtime for datasets, models, and checkpoints, object storage, and the model registry. Arrows show business requests, data and model paths, control and scaling signals, and GPU allocation, with a model lifecycle of train, checkpoint, evaluate and register, deploy, online metrics, and retrain trigger.](./images/architecture.png)

### Component ownership and responsibility boundaries

The architecture combines four types of components. CMB's proprietary platforms integrate the open source infrastructure and AI runtimes through Kubernetes-native interfaces and provide the bank's internal platform capabilities.

| Category | Components and platforms |
| --- | --- |
| CNCF-hosted and Kubernetes ecosystem open source projects | Kubernetes, Kueue (Kubernetes SIG), KEDA, Prometheus, HAMi, and Fluid |
| Third-party open source projects | Ray, RBG, vLLM, SGLang, and verl |
| Open source projects jointly developed by CMB and the community | Twinkle and verl-SpeCo |
| CMB proprietary platforms | CMB-built MaaS, training, heterogeneous accelerator management, model asset, and data asset platforms |

The proprietary platforms do not replace the responsibilities of the open source components. Kueue controls workload admission, Kubernetes Scheduler places Pods, HAMi allocates accelerator capacity, Fluid provides data and model access, and RBG orchestrates LLM inference workloads.

### Key design decisions and trade-offs

- **Share infrastructure without forcing one operating policy.** Training uses queue- and quota-based admission through Kueue, while inference uses metric-driven elasticity through Prometheus and KEDA.
- **Separate admission from placement and allocation.** Kueue decides when a training workload may enter the cluster; Kubernetes Scheduler and HAMi determine where Pods run and how accelerator capacity is allocated.
- **Treat compute sharing and model sharing as different concerns.** HAMi allocates physical accelerator capacity, while Twinkle enables multiple LoRA tenants to reuse one base-model instance. Neither mechanism replaces the other.
- **Treat model readiness as part of inference elasticity.** Creating a replica is not sufficient if it must still wait for model weights. Fluid's compute-side cache reduces this model-loading delay.
- **Use unit cost to assess efficiency at growing scale.** Cost per one million input and output tokens is more meaningful than total spend when business volume is changing.
- **Prefer a composable Kubernetes-native architecture over a vertically integrated platform.** CMB also evaluated vertically integrated platforms, which could reduce initial integration effort within a single supported stack. CMB selected the Kubernetes-native approach because its modular design supports independent evolution of admission control, scheduling, accelerator allocation, data access, and workload runtimes across a heterogeneous hardware environment. This flexibility enabled CMB to introduce Twinkle's shared base-model runtime independently, contributing to the reported fivefold increase in tenant density. The trade-off is the need for ongoing integration and compatibility testing.

### Operating context for the reported results

The reported results come from a shared production platform managing nearly 10,000 heterogeneous accelerator cards sourced from three mainstream domestic vendors. The platform supports Qwen models ranging from 4 billion to 1.6 trillion parameters, along with DeepSeek, GLM, and other model families. For online inference, the primary service-level objectives are a time to first token (TTFT) of no more than 5 seconds and a time per output token (TPOT) of no more than 50 milliseconds. In a Qwen3-14B startup test with model weights cached by Fluid, the measured model-loading time was under 2 seconds.

## Can you expand on why you are using those projects/services?

The value of the architecture comes from the interaction of admission, scheduling, accelerator allocation, data access, observability, elasticity, and model-runtime reuse rather than from any single component.

### CNCF projects

- **Kubernetes:** Provides the shared control plane, Pod orchestration, Deployments, scheduling foundation, and common resource interfaces for both workload paths.
- **KEDA:** Converts service and demand signals into scaling decisions for online inference workloads.
- **Prometheus:** Collects QPS, request-queue depth, inference latency, and other operational metrics used for observability and demand-driven scaling.
- **HAMi:** Pools heterogeneous accelerator resources and allocates accelerator capacity at fine granularity for workloads that can safely share it.
- **Fluid:** Provides Kubernetes-native access to datasets, model weights, and checkpoints, and caches model data near compute to reduce repeated remote reads and model-loading delays.

### Kubernetes ecosystem projects

- **Kueue (Kubernetes SIG subproject):** Manages training queues, quotas, and workload admission so distributed jobs do not partially start and hold capacity while waiting for the remaining resources.

### Third-party open source projects and technologies

- **Ray:** Provides the distributed runtime used by both the training and inference paths.
- **RBG:** Provides the Kubernetes workload abstraction used in production for role-based and multi-node LLM inference services.
- **vLLM / SGLang:** Serve online inference workloads behind the Inference Gateway.
- **verl:** Provides the upstream reinforcement-learning training framework used by verl-SpeCo.

### Open source projects jointly developed by CMB and the community

- **Twinkle:** Runs multi-tenant LoRA training on Ray, enabling tenants to share one base-model instance while retaining separate adapters, configurations, and state.
- **verl-SpeCo:** Extends verl with draft-model training and speculative-decoding integration for vLLM and SGLang.

## What has worked well?

### Production outcomes

| Metric | Result |
| --- | --- |
| Average accelerator compute utilization | Increased from 35% to more than 60% |
| Inference unit cost | Decreased by more than 60% per one million tokens, counting input and output tokens together |
| Duplicated base-model runtime footprint for the default five-tenant configuration | Decreased by 80% by reducing base-model replicas from five to one |
| Multi-tenant training density | Increased fivefold; eight concurrent tenants have been validated and five are used by default in production |
| Fluid-cached model loading | Under 2 seconds in a Qwen3-14B startup test |

These results use the bank's internally consistent before-and-after methodology and comparable model and service conditions.

### Reusable lessons

- A shared compute pool does not require training and inference to use the same operating policy.
- Inference elasticity depends on model readiness, not only on replica scheduling.
- Physical accelerator sharing and base-model runtime reuse solve different sources of waste.
- Kubernetes-native interfaces allow the control plane, resource layer, data path, monitoring system, and workload runtimes to evolve with limited coupling.
- Accelerator utilization, inference cost per token, and training density measure different problems and should be defined and evaluated separately.

## What has not worked well?

A current limitation is that support maturity varies across combinations of accelerator generations, model architectures, and training or inference runtimes. CMB mitigates this by qualifying each new combination before production rollout and continues to expand compatibility coverage and operational automation while preserving the Kubernetes-native interfaces described above.

The composable, Kubernetes-native approach also carries a standing cost: because admission control, scheduling, accelerator allocation, data access, and workload runtimes evolve independently, CMB must perform ongoing integration and compatibility testing that a vertically integrated platform would absorb within a single supported stack.

## What sort of "glue" have you had to develop to enable usage of your architecture?

CMB-built platforms integrate the open source components through Kubernetes-native interfaces and provide the bank's internal platform capabilities:

- MaaS and inference service capabilities, including the Inference Gateway that fronts production inference services.
- Training platform capabilities, including the Training API (pipeline, UI, and scheduler entry point) that submits workloads for Kueue admission.
- Heterogeneous accelerator management capabilities.
- Model asset management capabilities.
- Data asset management capabilities.

These platforms do not replace the responsibilities of the open source components: Kueue controls workload admission, Kubernetes Scheduler places Pods, HAMi allocates accelerator capacity, Fluid provides data and model access, and RBG orchestrates LLM inference workloads.

CMB also co-developed two open source projects with the community to close gaps in the training path:

- **Twinkle** runs multi-tenant LoRA training on Ray so that multiple tenants share one base-model instance while keeping adapters, configurations, and state separate.
- **verl-SpeCo** extends verl with draft-model training and speculative-decoding integration for vLLM and SGLang.

## What's next for your architecture? What are you looking to do next?

CMB continues to expand compatibility coverage across accelerator generations, model architectures, and training and inference runtimes, and to increase operational automation, while preserving the Kubernetes-native interfaces that keep the control plane, resource layer, data path, monitoring system, and workload runtimes loosely coupled. Areas identified for further work include dynamic tenant concurrency for multi-tenant training, broader hardware and runtime support, and unit-cost-based capacity management.
