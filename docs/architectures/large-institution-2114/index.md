---
title: Agentic RAG on Kubeflow — Implementation Deep Dive
sidebar_label: Large Institution
architecture:
  organization: Large Institution
  summary: A Kubeflow docs agent combines Kagent, read-only MCP tools, Kubeflow Pipelines, Milvus hybrid retrieval, and KServe-hosted models to answer documentation questions with citations.
  tags:
    - agentic ai
    - rag
    - kubeflow
    - kubernetes
    - kserve
    - mcp
    - vector search
    - observability
    - ai platform
    - gitops
    - demo
  projects:
    - Kubeflow
    - Kubernetes
    - KServe
    - Knative
    - Istio
    - Envoy
    - OpenTelemetry
    - Argo
  sourceUrl: https://github.com/cncf/endusers/issues/2114
  sourceIssue: 2114
  published: 2026-11-08
  updated: 2026-11-08
---

import CNCFProjectCard from '@site/src/components/CNCFProjectCard';

> Submitted by the community via [reference architecture issue #2114](https://github.com/cncf/endusers/issues/2114). Documentation is distributed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Relevant CNCF projects

<CNCFProjectCard name={"Kubeflow"} logo={"/img/cncf-projects/kubeflow-kubeflow-icon.svg"} description={"Provides the AI platform and documentation corpus the agent serves."} />

<CNCFProjectCard name={"Kubernetes"} logo={"/img/cncf-projects/kubernetes-kubernetes-icon-color.svg"} description={"Runs the agents, model serving, vector database, and data pipelines."} />

<CNCFProjectCard name={"KServe"} logo={"/img/cncf-projects/kserve-k-serve-icon-color.svg"} description={"Serves the language model and text-embedding inference workloads."} />

<CNCFProjectCard name={"Knative"} logo={"/img/cncf-projects/knative-knative-icon-color.svg"} description={"Provides serving dependencies used by KServe."} />

<CNCFProjectCard name={"Istio"} logo={"/img/cncf-projects/istio-istio-icon-color.svg"} description={"Provides the public gateway, route policies, and JWT validation."} />

<CNCFProjectCard name={"Envoy"} logo={"/img/cncf-projects/envoy-envoy-icon-color.svg"} description={"Applies gateway filtering and local rate limiting through Istio."} />

<CNCFProjectCard name={"OpenTelemetry"} logo={"/img/cncf-projects/opentelemetry-opentelemetry-icon-color.svg"} description={"Carries agent, MCP, and retrieval traces to the observability stack."} />

<CNCFProjectCard name={"Argo"} logo={"/img/cncf-projects/argo-argo-icon-color.svg"} description={"Argo CD reports Git-to-cluster drift for the Helm releases in observe-only mode."} />

## Describe your organisation

A large institution has been cloud-first on AWS since 2015 and has a large AWS footprint. The architecture described here is a Kubeflow docs-agent implementation and demo, submitted on behalf of Kubeflow; it is not presented as a production deployment of the institution.

## Describe your entity and/or team

Authors: Rohit Kumar, Santhosh Toorpu, and Chase Christensen.

## Brief overview of your architecture and any potential goals you are trying to achieve with it?

### Implementation deep dive

**Authors:** Rohit Kumar , Santhosh Toorpu , Chase Christensen
**Status:** Draft for community review. Revised October 2026 (v2.1) for the Agents Working Group.
**Working repo:** [github.com/kubeflow/docs-agent](https://github.com/kubeflow/docs-agent)
**Related meeting doc:** [Kubeflow Agentic RAG Community Call](https://docs.google.com/document/u/0/d/1E1SGYGhKHhvIHRDsk--0vIVOmboKWByZy45H-obZ3sc/edit)
**Scope of this revision:** docs-agent is now part of the new Agents Working Group. This revision brings every layer up to what runs today, and adds the observability, evaluation, feedback and delivery layers that the first revision listed as gaps.

#### **Overview**

Please join kubeflow-discuss@googlegroups.com for edit access.
This document is the implementation counterpart to the Reference Architecture. That document defines the target; this one records what is actually running on the OCI demo cluster today, mapped one-to-one onto the same five layers, so the proposal can be checked against a running system rather than a design.
Every layer below follows the same shape:

* **Reference architecture** — what the proposal calls for.
* **Current implementation** — what is deployed, with the files that own it.
* **Gap** — what is missing, and what it blocks.

Where the implementation diverges from the proposal on purpose, the reasoning is in **Appendix C: Open Design Questions** rather than buried in the layer.
The two documents are intended to merge. This one should collapse into the Reference Architecture once the gaps close.

#### **What Changed Since the Last Revision**

The first revision described a system that was correct but largely unmeasured. Since then the model, the retrieval path and the edge changed, and three layers were added around them: tracing, evaluation and drift visibility. The table summarizes the changes; each layer section below carries the detail.

| Area | Last revision | Now (October 2026) |
| :---- | :---- | :---- |
| Model | Qwen2.5-7B-Instruct-AWQ behind a tool-choice proxy | Gemma 4 E4B served by vLLM on KServe through a catalog-driven Helm chart (Qwen kept as a fallback profile). No proxy. A third or less of the latency on the evaluation harness. |
| Retrieval | Dense-only search; routing by prompt | Hybrid dense plus BM25 on the docs collection, a deterministic intent router in the MCP server, date-aware ranking, structured citations. |
| Public edge | Catch-all route to the kagent UI; session JWT in canary; 30s timeout | Only the chat paths are routed; session JWT enforced; upstream CORS headers stripped; 300s deadline for streamed answers. |
| Observability | None; tracing listed as the largest gap | Self-hosted Langfuse fed by an OpenTelemetry collector: traces across agent, tools and retrieval, versioned prompts, scores and dashboards. |
| Evaluation | No golden dataset | Repeatable evaluation on a 24-question seed set (retrieval rank, faithfulness, correctness, abstention) with failures attributed to a layer. A 97-case tool-use evaluation drove model selection. Not yet a CI gate. |
| Feedback | Gap | Prototype triage: a thumbs-down trace is diagnosed by layer and component and a suggested owner is named. Widget buttons are not built. |
| Delivery | Push-based CD for one chart; drift tolerated | Same CD, plus a drift register and Argo CD in observe-only mode over three Helm releases. |
| Governance | Not applicable | docs-agent is part of the Agents Working Group. |

#### **Agents Working Group Context**

docs-agent is now one of the projects in the Agents Working Group. This document stays the implementation reference for docs-agent, and it is written so that the parts that are not specific to documentation can be reused or discussed across the group.
**Candidates for sharing across agent projects** (offered as a starting point for discussion, not as decisions):

* **Agent definition and runtime:** declarative agents, model configurations and tool servers as Kubernetes resources, rendered from a Helm chart.
* **Tool conventions:** read-only MCP tools that return bounded, cited evidence, never write links themselves and never change cluster state.
* **Public edge pattern:** anonymous but accountable session identity, a route allow-list with no catch-all, and rate limiting.
* **Observability and evaluation:** a common trace shape (agent, model call, tool call, retrieval), shared score names, a shared evaluation harness, and golden sets that grow from feedback.
* **Delivery:** GitOps for the charts, with drift made visible before it is enforced.

**Questions for the working group:**

* Should trace attribute names and score names be standardized across agent projects, so that one dashboard can serve several of them?
* Where should cross-cutting charts and the evaluation harness live, and who owns them?
* How should feedback that exposes a content gap reach the component working groups, and what do they need from it in order to act?
* Which parts of the platform (model serving, vector store, observability) should be shared infrastructure rather than per-project?

#### **Motivation**

The Reference Architecture argues that a monolithic retrieval script will not scale and that the system must be decoupled into Frontend, Middleware/Agent, Pipelines, and Vector DB. The repository is already built along those lines, which makes the proposal testable rather than aspirational.
The value of writing this down is that a reference architecture is only credible if someone can point at a cluster and say which parts exist. Several items in the proposal — scale-to-zero, guardrail models and a learned semantic router — are not built yet, and stating that plainly is more useful to adopters than implying a finished system. Telemetry, which the first revision listed as missing, now exists and is described under Observability, Evaluation and Feedback.

#### **User Value**

* **Accurate Discovery:** Live. The public chatbot answers from three grounded sources with citations and refuses to answer from general knowledge (enforced in the Agent system message). Deployed at the [Kubeflow demo chatbot](https://kubeflowdemochatbot.netlify.app).
* **Developer Efficiency:** Partial. The MCP server is reachable over Streamable HTTP at /mcp and an IDE agent can connect to it today, but the “Thin Context” contract — a bounded snippet plus validation URL, with synthesis offloaded to local compute — is not implemented. Tools currently return full formatted Markdown. Concrete proposal in Appendix C.2.
* **Reference Architecture:** Partial. The full platform (namespaces, Knative/KServe, Milvus, TEI, KFP, kagent, Istio edge) is reproducible from Terraform plus three Helm charts (docs-agent, llm-runtime, gateway-guardrails). One thing still blocks a clean fresh-cluster claim: Kubernetes Secrets must pre-exist. The edge chart’s personal defaults are gone: the domain and the ACME contact are now required values. See Graduation Criteria.

#### **Personas**

* **Data Scientists / End Users:** Served today through the web widget. The public path is TLS-terminated, rate-limited, and CORS-locked.
* **MLOps / Platform Engineers:** Served today through Terraform plus three Helm charts, with Langfuse traces for debugging and an Argo CD trial that reports drift. Not yet served by a documented rollback or a staging environment.
* **Contributors / Developers:** Partially served. The MCP endpoint exists; the IDE-oriented Thin Context flow does not.
* **Working group members and component maintainers:** Served in design only. Feedback that exposes a content gap is meant to reach the owning component working group; the triage prototype exists, the routing workflow does not.

#### **Summary**

* The four-layer decoupling in the proposal is implemented: frontend widget, Kagent + MCP middleware, KFP ingestion, Milvus data layer, all on Terraform-managed infrastructure.
* Agents are Kubernetes-native: Agent, ModelConfig, and RemoteMCPServer CRDs, as the proposal specifies.
* Ingestion is idempotent. The drop-before-reinsert failure mode noted in the Reference Architecture is fixed; details in Layer 2.
* The public edge is hardened and packaged as a single Helm chart — TLS, a 60 req/min limit, a CORS allow-list with the upstream’s wildcard headers stripped, only the chat paths routed (the kagent UI and API are not reachable), a 300s deadline for the streamed answer, and enforced anonymous session JWTs. This answers the open question left under “Frontend Handshake” in the proposal; see Layer 5.
* **Retrieval is hybrid and intent-aware.** The docs collection carries a dense vector and a native BM25 sparse vector. A deterministic router in the MCP server picks dense, BM25 or hybrid per query and ranks release questions by date. Citations travel as structured data, not as links written by the model.
* **The model is Gemma 4 E4B,** served by vLLM on KServe through a catalog-driven Helm chart. Qwen2.5-7B stays as a fallback profile and the tool-choice proxy is retired.
* **The system is observable.** Self-hosted Langfuse receives traces from the agents, the MCP tools and the retrieval step through an OpenTelemetry collector. Prompts are versioned there, and scores and dashboards are built on the same data.
* **Quality is measured.** A repeatable evaluation reports retrieval (hit@5, MRR), answer faithfulness and correctness, and attributes failures to ingestion, retrieval or generation. A prototype triage loop turns a thumbs-down trace into a diagnosis and a suggested component owner.
* **Delivery drift is visible.** Argo CD runs in observe-only mode over the three Helm releases and has already surfaced real differences between Git and the cluster.
* Not built: KEDA scale-to-zero, a guardrail model, a learned (semantic) router, prompt-injection classification, an evaluation gate in CI, the user-facing feedback buttons, and automatic reconciliation of cluster state from Git.

#### **Design Details**

The system is divided into the same five functional layers used by the Reference Architecture.

##### **1. Infrastructure & Deployments (The Foundation)**

**Reference architecture:** Terraform and Helm for idempotent K8s deployment; Kagent CRDs for agent management; KEDA cron + Prometheus autoscaling with scale-to-zero overnight; OCI budget alerts.
**Current implementation:**

* **IaC:** Ten Terraform files own the platform. Namespaces are variables (var.namespace_ml_infra, var.namespace_docs_agent), so the stack is namespace-portable at the Terraform layer.

| Area | File | Notes |
| :---- | :---- | :---- |
| Namespaces | namespaces.tf | Creates ml-infra and docs-agent; names are variables. |
| KServe and Knative | knative.tf | Installs serving dependencies. |
| Milvus | milvus.tf | Installs Milvus Operator and a standalone Milvus CR. |
| Embeddings | embeddings.tf | Deploys TEI as a KServe InferenceService. |
| Kubeflow Pipelines | kubeflow_pipelines.tf | Deploys KFP standalone. |
| Kagent | kagent.tf | Installs kagent CRDs, controller, and UI. |
| Edge + Istio policies | gateway_guardrails.tf | Installs the gateway-guardrails Helm chart. Replaces the former istio_policies.tf and kagent_ingress.tf. |

* **Agent Management:** Agents are declared as CRDs and rendered by the docs-agent Helm chart: three agents (docs, docs with reasoning enabled, and debug), two model configurations that differ only in reasoning effort, and one RemoteMCPServer pointing at the MCP Service. The earlier manifests/kagent/setup.yaml is kept as a legacy reference and must not be applied to a Helm-managed install.
* **Namespace split:** ml-infra holds Milvus, TEI, and the LLM; docs-agent holds the MCP server and Kagent resources; kubeflow holds KFP standalone.

**Gap — Cost & Scaling.** No KEDA ScaledObject exists. The LLM runs as a continuously-resident KServe InferenceService on a single GPU, with no cron window and no scale-to-zero. Consequently the cold-start gate in the Reference Architecture (first response &lt; 45s from zero replicas) has never been measured, because the pod never reaches zero. Work on cncf/tab#47 has not started.
The deployed model is now **Gemma 4 E4B**, served by vLLM through an OpenAI-compatible endpoint. It replaced Qwen2.5-7B-Instruct-AWQ; the proposal had named Llama 3.1-8B. The llm-runtime chart carries a small catalog of validated profiles; each pins the vLLM image by digest, the model by revision, and the tool and reasoning parsers, and one value switches the profile. Clients always call a fixed served-model name, so changing the model never touches the agent chart.
The choice was made with a tool-use evaluation: 97 cases, three repeats, and pass/fail gates fixed before any candidate ran. Gemma scored highest with reasoning on (270 of 291, against 168 for the earlier Qwen2.5-7B setup). With reasoning off, its default, it scored 258 at about a third of the median latency (1.34 s against 4.07 s), but it misses one pre-set gate: small talk that should not trigger a search. The reasoning-enabled agent passes that gate at roughly twice the latency, so both are deployed and the widget exposes a toggle. Tool-use scores say nothing about answer quality, which is measured separately under Observability, Evaluation and Feedback.
One operational consequence worth recording: CD deliberately does **not** restart the model on every push. It installs the llm-runtime release only when it is missing or when the workflow is dispatched with the deploy_llm input, because the model runs on one GPU with a Recreate rollout and a restart means downtime. Any autoscaling work has to respect that constraint or acquire a second GPU.
OCI budget alerts are not configured.
**Delivery and drift (new).** Deployment is still push-based from GitHub Actions and covers one release. Hand-applied changes accumulated during demo preparation, so a drift register now lists every difference between Git and the cluster. Argo CD has been installed in observe-only mode: one Application each for docs-agent, llm-runtime and gateway-guardrails tracks the chart in Git and reports differences without changing the cluster. Its first reading flagged every object, only because objects adopted from Helm lack Argo’s tracking annotation; once that annotation is ignored, what remains is real. The first real difference was a live system prompt that did not match Git, which has since been reconciled; a configuration checksum difference remains.
The path from here: clear the known drift, point the Applications at the upstream main branch, enable manual sync, then automatic sync with self-heal for stateless releases, while GPU and stateful releases stay manual. CI would then commit the new image tag to Git instead of running helm upgrade.

##### **2. Ingestion Pipelines (The KFP Layer)**

**Reference architecture:** KFP handles continuous ETL, chunking, and embedding. Docs ingestion from kubeflow.org; parallel code ingestion over kubeflow/manifests with AST parsing; cryptographic signature checks on source repositories. Flagged concern: the pipeline drops the entire Milvus collection before reinserting, so a mid-run GitHub rate limit leaves the collection empty.
**Current implementation — the drop-and-recreate concern is resolved.** The docs, issues, and code pipelines delete by file_unique_id and insert, rather than dropping the collection. A rate limit mid-run now leaves previously indexed content in place; the run fails without destroying the index.

| Pipeline | Target collection | Role |
| :---- | :---- | :---- |
| kubeflow-pipeline.py | kubeflow_docs | Downloads, cleans, chunks, embeds, and stores Kubeflow docs. |
| issues-pipeline.py | issues_rag | Ingests GitHub issues and comments for troubleshooting context. |
| code-pipeline.py | code_rag | Ingests code and YAML manifests with resource metadata (kind, name, namespace, file type). |
| incremental-pipeline.py | Existing records | Handles changed-file updates: deletes old vectors by id, inserts new chunks. |

**Docs ingestion changed (v4 path).** The docs pipeline now parses Hugo content with a dedicated parser, chunks to an estimated token budget (about 350 tokens, with overlap), extracts release dates as typed metadata, and writes the v4 schema, which adds a native BM25 sparse vector next to the dense one. The issues and code pipelines are unchanged.
Two additional safeguards not in the proposal but worth adopting into it:

* **Schema version guard.** Each collection carries v=&lt;SCHEMA_VERSION> in its Milvus CollectionSchema description. A pipeline refuses to run against a collection whose version does not match, which turns silent schema drift into a loud failure and makes a future migration a controlled operation (bump the version, drop, re-run).
* **Code ingestion is structure-aware.** code_utils.py chunks along code structure and extracts Kubernetes resource metadata, which is what makes manifest questions answerable by resource name rather than by prose similarity.

**Gap — chunking is bounded in characters, TEI is bounded in tokens (narrowed).** The docs path no longer has this problem, because the v4 chunker budgets tokens and keeps inputs under the model limit. The issues and code paths still chunk by characters, so what follows still applies to them. It is a live bug with two halves.
The first half is a silent mismatch: utils.py truncates each embedding input at MAX_TEI_INPUT_CHARS = 1000, while issues_utils.py still chunks at a default of 1500. A stored chunk can therefore be longer than the text that was actually embedded — the vector does not represent the row. PR #212 fixes this half by clamping the chunker.
The second half survives that fix. The embedding model’s limit is roughly 384 **tokens**, and the ~1000-character equivalence only holds for prose. YAML, Go, stack traces, and long URLs tokenize far more densely, so a chunk can sit inside the character cap and still overflow the model. TEI answers 413 Payload Too Large, and raise_for_status() turns that into a dead pipeline step rather than a degraded one.
This is measured, not theoretical: seeding issues_rag and code_rag on the demo cluster, 14 of 253 chunks hit it — every one of them YAML or Go. Two probe inputs of exactly 1000 characters each: prose returned 200, dense YAML returned 413.
The fix is either to count tokens with the model’s tokenizer, or to retry on 413 by splitting the batch and then shrinking the individual input. The retry needs no new dependency. This also relates to Issue cncf/tab#181 (align content truncation across all server paths).
**Gap — Security.** No cryptographic signature checks on source repositories. The pipelines trust whatever the GitHub API and kubeflow.org return.
**Gap — index quality, found by evaluation.** Measuring answers end to end showed that coverage and metadata matter more than retrieval tuning. Several components are thinly covered or absent (notebook culling, Trainer custom runtimes and Spark operator allocation are examples), the version field is empty so superseded and legacy pages can outrank current ones, and the issues index spans many repositories unevenly. The proposed fix is to add version and component metadata, exclude legacy and superseded content, cap issues per repository, fill the coverage gaps, and re-run the evaluation to confirm the effect. Re-indexing changes the live index, so it is a deliberate, reviewed step.

##### **3. Backend Vector Database (The Data Layer)**

**Reference architecture:** Stateful Milvus for ANN storage. Open question on collection strategy — the proposal argues for a single collection with partitions plus native hybrid search (dense + BM25 sparse, fused with Reciprocal Rank Fusion), rather than separate collections with per-domain embedding models.
**Current implementation:**

* **Storage engine:** Milvus Operator installed via milvus.tf, with a lightweight standalone Milvus CR in ml-infra. Runtime clients connect to milvus-milvus.ml-infra.svc.cluster.local:19530.
* **Embedding service:** Hugging Face Text Embeddings Inference running as a **dedicated KServe InferenceService** — this closes Issue cncf/tab#78. Model sentence-transformers/all-mpnet-base-v2, 768 dimensions, CPU-backed. One service is shared by both the runtime MCP path and the ingestion pipelines, which keeps query-time and index-time embeddings in the same space by construction.
* **Current collections:** three, each with its own schema.

| Collection | Content | Distinct schema fields |
| :---- | :---- | :---- |
| kubeflow_docs | Kubeflow documentation chunks. | content_text (BM25 input), sparse_vector, release_date, doc_type |
| issues_rag | GitHub issue and comment chunks. | issue_number, issue_state, issue_labels |
| code_rag | Code and YAML manifest chunks. | resource_kind, resource_name, resource_namespace, file_type |

The docs collection uses the v4 schema: a dense vector with a FLAT cosine index, a native BM25 sparse vector generated from the chunk text with a sparse inverted index, and typed release-date metadata. Hybrid search fuses the two. The issues and code collections remain dense-only with IVF_FLAT and cosine similarity; the search planner falls back to dense search for any collection that lacks the sparse field. All three share the same 768-dimension dense embedding.
**Divergence — collection strategy.** The implementation uses separate collections; the proposal argues for one collection with partitions. This is the one place where the two documents disagree substantively, and it is worth settling with the golden dataset rather than in advance. The full argument, including where the proposal’s reasoning holds and where it may be conservative, is in **Appendix C.1**. Hybrid search now exists inside the docs collection, which answers the exact-identifier half of the proposal’s argument; the cross-source ranking question remains open.

##### **4. Middle Agent & Router (The Logic Layer)**

**Reference architecture:** Semantic router and intent detection; MCP tool handshake returning a Thin Context package; a local guardrail model (e.g. Llama-Guard) on inputs and outputs; zero write-access to cluster state.
**Current implementation:**

* **MCP tool layer.** A FastMCP server serving Streamable HTTP on port 8000 at /mcp. It initializes the Milvus client lazily and requires MILVUS_PASSWORD from a Kubernetes Secret. Each tool embeds the query through TEI, searches its collection, and returns evidence text with scores and metadata. Citations are returned as structured data that the UI renders, so the model never writes links itself.

| MCP tool | Milvus collection | Use case |
| :---- | :---- | :---- |
| search_kubeflow_docs | kubeflow_docs | Documentation concepts, setup, APIs, how-to questions. |
| search_github_issues | issues_rag | Bugs, errors, stack traces, issue discussions, community fixes. |
| search_kubeflow_code | code_rag | Source code, Kubernetes YAML, resource names, manifest questions. |

* **Zero write-access:** Met. All three tools are read-only searches. There is no tool that mutates cluster state.
* **Retrieval planning (new).** The docs tool runs a deterministic, rule-based planner in the MCP server. It classifies the query — comparison, release date, latest or current, exact version or config key or error term, conceptual, or default — and picks dense, BM25 or hybrid search, a candidate depth, an optional release filter and date-aware ranking. This is pattern matching on the query, not an LLM decision, so it can be tested on its own and does not degrade with model quality.

**Gap — Routing.** There is still no learned (semantic) router. What changed is that the retrieval mode is now chosen by the deterministic planner above. Which tool to call (docs, issues or code) is still chosen by the model, under system-message rules such as “errors and stack traces: search issues first”. Evaluation showed the cost: we saw traces that answered without calling any tool, and a question whose answer was in a GitHub issue that was searched in docs only. A component-aware router (pipelines, notebooks, Trainer and so on) is the natural next layer, and it would also feed the feedback routing described later.
**Gap — Tool Handshake Flow.** Steps 1 and 2 of the proposal’s four-step flow exist (intercept the query, execute precision retrieval). Steps 3 and 4 do not: tools return full formatted chunks rather than a bounded ~150-token snippet plus validation URL, and there is no mechanism to offload synthesis to the caller’s compute. See Appendix C.2 for a concrete contract.
**Gap — Guardrails.** No Llama-Guard, no output filter, no input classifier. All abuse protection today lives at the network edge (Layer 5), not at the model. That distinction matters: the edge stops volume, not content. Two related facts: the tools are read-only, and the Terraform install now disables the bundled kagent tool server, which ran with cluster-admin rights and was used by no docs agent. Retrieved GitHub issue text is untrusted input, so indirect prompt injection through issues remains an open risk.

##### **5. Frontend & Interface (The Presentation Layer)**

**Reference architecture:** Chat UI embedded in kubeflow.org with structured responses and visible tool execution; explicit feedback loop feeding a golden dataset; frontend handshake that is rate-limited and identity-bearing so random IPs cannot hit the agent. The **Authentication** bullet is left open in the proposal.
**Current implementation:**

* **Chat Frontend:** A self-contained JS widget (frontend/docs_scripts/chatbot.js, frontend/docs_styles/chatbot.css) overlaid on the docs site. It is running against a fork of kubeflow/website for demo purposes; the intended end state is the upstream site.
* **Process Transparency:** Partial. Responses carry citations, rendered in a Sources panel from structured tool results, and the widget has a reasoning toggle. It does not yet show explicit tool-execution status (“Searched in Kubeflow docs ✓”).
* **Feedback Loop: Designed, not shipped.** The widget has no thumbs up/down yet. The groundwork exists: each chat is traced with its session identifier, so a feedback score can be attached to the right trace, and a triage prototype (see Observability, Evaluation and Feedback) diagnoses the failing layer and suggests the component owner. This is on the critical path for Graduation Criteria, because it is also how the golden dataset grows.

**Authentication and Frontend Handshake — filling in the open bullet.**
The proposal asks: “rate-limited to our agent. Must not allow random IPs to hit it. MCP must have source of identity/etc to prevent spam. (something we need to think about)”. This is now built and deployed. The whole edge ships as one Helm chart, docs-agent-mcp/charts/gateway-guardrails, installed by Terraform — a single source of truth, adopted onto the live cluster with zero downtime.

| Control | Configuration | State |
| :---- | :---- | :---- |
| TLS | Istio Gateway, Let’s Encrypt via cert-manager; HTTP redirects to HTTPS. | Live |
| Global rate limit | 60 req/min, EnvoyFilter local rate limit scoped to the chatbot HTTPS listener (port 443) only. | Live — verified, 429s tagged x-ratelimit-scope: global |
| CORS | Allow-list of exact origins; no wildcard. The upstream’s own permissive CORS headers are removed on the chat route, so only the allow-list answers. | Live |
| Route allow-list | Only the session endpoint, its public key set and the A2A chat paths are routed. There is no catch-all, so the kagent UI and API return 404. | Live |
| Route deadline | 300s deadline on the streaming agent route (a shorter cap cut answers mid-token); 10s on the session endpoint. | Live |
| Session auth | Anonymous RS256 JWTs, 30-minute TTL, minted by a session-issuer service at POST /api/session with no user accounts. Istio RequestAuthentication validates signature and expiry at the gateway. | **Enforced** |
| Per-IP rate limit | Packaged (Envoy ratelimit service + Redis) but shipped disabled. | Disabled |

Three things about this are worth carrying into the Reference Architecture, because they are the non-obvious parts:
**Per-IP limiting does not work, and per-session limiting is the better answer anyway.** The ingress runs externalTrafficPolicy: Cluster, so client IPs are rewritten to node IPs and a per-IP limit would bucket the entire internet into a handful of nodes. Fixing that requires either externalTrafficPolicy: Local or trusted-proxy configuration. But the stronger primitive is already in place: rate-limit on the JWT sub claim, which gives a stable per-session key that survives NAT, requires no infrastructure change, and is the direct answer to “MCP must have source of identity to prevent spam”. Recommended as the next step over fixing per-IP.
**Anonymous-but-accountable is the right default for a public docs bot.** No accounts, no PII, no login friction — but every request carries a short-lived server-issued identity that can be rate-limited, revoked by key rotation, and expired. Admin surfaces (Kagent UI, KFP dashboard) need real authentication and should get ingress-level OAuth separately; they are a different threat model.
**One shared rate-limit bucket.** The global limit applies to every host on the gateway’s HTTPS listener. Any other public host (an observability UI, for example) needs its own per-host override, or it competes with the chatbot for the same 60 requests per minute. We applied such an override.
**Two gaps from the first revision, and where they stand:**

1. *The CORS policy is weaker than it reads.* Istio’s corsPolicy only **adds** response headers for origins that match the allow-list. A preflight from a non-matching origin does not get rejected — it falls through to the upstream kagent-ui, which answers with Access-Control-Allow-Origin: \*. The allow-list therefore documents intent without enforcing it. The fix is an explicit deny for non-allow-listed Origin values at the gateway. **Status: closed.** The chat route now strips the upstream’s access-control response headers, so a preflight from a non-allow-listed origin no longer receives a wildcard answer.
2. *istiod caches JWKS, including a failed fetch.* If istiod resolves the issuer’s JWKS endpoint before the issuer pod is serving, it caches an empty or invalid key set and then rejects every valid token with Jwt verification fails — indefinitely, with no retry. The recovery is kubectl -n istio-system rollout restart deploy/istiod. This is a startup-ordering hazard that only surfaces when enforcement is switched on, so it belongs in the reference deployment documentation rather than in a runbook nobody reads first. **Status: still a hazard.** Enforcement is now on, so the restart-ordering note applies to every fresh install and belongs in the deployment documentation.

#### **Security & Constraints Checklist**

| Constraint (from the Reference Architecture) | Status | Detail |
| :---- | :---- | :---- |
| Agent Communication: MCP standard, zero write-access | **Met** | All three tools are read-only searches; no state-mutating tool exists. The bundled cluster-admin tool server is disabled in the platform install. |
| Network: Istio enforcing mTLS between agent, tools, and Vector DB | **Partial** | AuthorizationPolicies restrict who may reach Milvus, etcd, and MinIO, and mesh authz ships in the chart. A repo-level STRICT PeerAuthentication is not declared, so mTLS is inherited from cluster defaults rather than asserted by this project. |
| Prompt Injection: segregated system prompts; classifier before the LLM | **Not started** | System prompts are segregated in the Agent CRDs. No input classifier exists. Retrieved issue text is untrusted; read-only tools limit the blast radius. |
| Resilience: exponential backoff with jitter; transparent degradation | **Partial** | A bounded route deadlines and a non-blocking LLM smoke test exist. There is no backoff-with-jitter on Milvus or TEI calls, and the TEI 413 path aborts rather than degrades (Layer 2). The LLM, Milvus and its metadata store each run as a single replica, and no backups are configured. |
| Edge exposes only the chat paths (added) | **Met** | No catch-all route; the kagent UI and API return 404; a session JWT is enforced on the chat paths. |
| Observability data: access and privacy (added) | **Partial** | Langfuse is invitation-only, with sign-up disabled and a read-only role. Traces contain real user questions, so a separate sanitized project is planned before any wider access. |

#### **Repository Structure**

Current layout:

```text
kubeflow/docs-agent/
├── frontend/                 # Chat widget (JS + CSS overlay)
├── docs-agent-mcp/
│   ├── mcp-server/           # FastMCP server, intent router, Milvus search, smoke test
│   ├── pipelines/            # KFP ingestion: docs, issues, code, incremental
│   ├── manifests/            # Legacy kagent setup, MCP Deployment, mesh policies
│   ├── charts/               # docs-agent, llm-runtime, gateway-guardrails Helm charts
│   ├── session-issuer/       # Anonymous session JWT service
│   └── terraform/            # Platform IaC
├── tests/                    # pytest suite and evaluation harness (tests/eval)
├── docs/                     # Architecture notes, agent triage instructions
├── scripts/                  # Deploy and smoke helpers
├── legacy/                   # Pre-restructure code, retained for reference
└── .github/workflows/        # CI + OKE CD
```

The Reference Architecture proposes a flatter top-level split (agent/, pipelines/, backend/, deployments/). The current tree consolidates all of those under docs-agent-mcp/ and has no top-level agent/ — the agent definitions now live in the charts/docs-agent Helm chart and the tool implementations in mcp-server/.
**Recommendation:** decide this before Phase 3. A rename is cheap while the contributor count is small and expensive afterward, since every issue, PR, and deployment doc encodes the paths. If the flat layout is the intent, doing it as one mechanical commit now costs less than the drift.

#### **Architecture Diagram**

The current system has four connected paths:

| Path | Flow |
| :--- | :--- |
| Serving | Web widget -> Istio edge -> Kagent agents -> KServe-hosted LLM. Agents call the MCP server, which retrieves evidence from Milvus through TEI embeddings. |
| Ingestion | Kubeflow documentation, GitHub issues, and code -> Kubeflow Pipelines -> parsing, chunking, and embedding -> Milvus collections. |
| Observe and improve | Agent and MCP traces -> OpenTelemetry collector -> Langfuse -> evaluation and feedback triage -> human-reviewed work for component teams. |
| Delivery | Git -> CI -> Helm releases for docs-agent, llm-runtime, and gateway-guardrails. Argo CD observes Git-to-cluster drift without syncing. |

For a user query, the widget first requests an anonymous session token. Istio enforces TLS, the global rate limit, the CORS policy, the route allow-list, and the token before forwarding the chat request. Kagent selects read-only MCP tools; the MCP server embeds the query through TEI, plans dense, BM25, or hybrid retrieval, and searches Milvus. The agent sends the retrieved evidence to the KServe model and streams a cited answer back to the widget. OpenTelemetry spans from the agent and retrieval path are sent to Langfuse.

The earlier diagrams in the source draft describe superseded model and edge settings. They are omitted here to avoid presenting the older Qwen model and 30-second route deadline as current.

#### **Phased Work Breakdown**

**Phase 1 (Foundation)**

| Item | Status | Notes |
| :---- | :---- | :---- |
| Namespace portability (PR #135) | **Mostly done** | Terraform namespaces are variables. Manifests still hardcode namespace: docs-agent in setup.yaml and mcp-server.yaml; those need templating to complete it. |
| Embedding service as dedicated KServe InferenceService (Issue cncf/tab#78) | **Done** | TEI runs as its own InferenceService, shared by runtime and pipelines. |
| Scale-to-Zero on LLM pod (Issue cncf/tab#47) | **Not started** | No KEDA. Blocked by the single-GPU constraint described in Layer 1. |
| Align content truncation across all server paths (Issue cncf/tab#181) | **Partial** | MAX_TEI_INPUT_CHARS = 1000 is applied on both the server and pipeline paths, but the chunker default is still 1500 and the underlying limit is tokens, not characters. See Layer 2. |
| KEDA scale measurements on OCI | **Blocked** | Depends on Issue cncf/tab#47. |

**Phase 2 (Data)**

| Item | Status | Notes |
| :---- | :---- | :---- |
| Docs ingestion, idempotent upsert | **Done** | Delete-by-id and insert; no collection drop. |
| Issues ingestion pipeline | **Done** | Includes issue comments and label metadata. |
| Code ingestion (kubeflow/manifests, AST) | **Done** | Structure-aware chunking with Kubernetes resource metadata extraction. |
| Hybrid retrieval and intent router (BM25 + dense) | **Done** | Docs collection v4 schema; deterministic planner in the MCP server. |
| Structured citations in the UI | **Done** | Citations travel as structured tool results and render in a Sources panel. |

**Phase 3 (Solidification) — proposed**
Per mentor alignment, the priority is hardening what exists before adding capability. The LLM gateway remains deferred. The evaluation harness and monitoring dashboards, first deferred, now exist in a first version (see Observability, Evaluation and Feedback). Incoming issues should map to one of these work streams:

* **CI/CD hardening:** validate the Helm chart and Terraform on every PR, add post-deploy smoke gates, and document and test rollback.
* **Auth rollout completion:** enforcement is on and the CORS gap is closed. What remains is the JWKS startup-ordering note, per-session rate limiting, and ingress-level OAuth for admin surfaces.
* **Decoupled container images:** split the heavy pipeline base image (PyTorch plus the embedding model) from thin per-change app layers, pin by digest instead of tag, and add a GHCR retention policy.
* **Ingestion cadence:** scheduled recurring runs (issues daily; docs and code weekly) with manual triggers, incremental updates instead of full re-embeds, and atomic collection swaps during reindex.
* **Evaluation as a gate:** move the harness into the repository, run it on merged changes against score floors, and publish results to Langfuse.
* **Feedback loop:** thumbs up/down in the widget with a small feedback endpoint, a scheduled triage job, and human-approved routing to the component working groups.
* **GitOps:** finish the drift clean-up, then move Argo CD from observe-only to synced for stateless releases.
* **Index quality:** version and component metadata, legacy exclusion, coverage gaps, then re-evaluate.

#### **Tests**

Status against the four categories in the Reference Architecture.
**Unit — Partial.** A pytest suite covers the MCP server, code utilities, issues pipeline, and session issuer, and runs on every PR. The specific contract the proposal names — *each tool returns source_url, chunk_text, score* — is not asserted anywhere. That test is cheap and should be added; it also becomes the natural place to pin the Thin Context contract once it exists (Appendix C.2).
**Integration — Done for the web path, missing for the IDE path.** smoke_tools.py runs inside the deployed MCP pod on every CD run and validates the runtime contract rather than process startup:

1. POST initialize to the MCP endpoint.
2. Read the Mcp-Session-Id response header.
3. POST notifications/initialized.
4. POST tools/list and assert all three tools are registered.
5. POST tools/call for each of the three tools.
6. Fail if any tool returns no text or a Search failed: response.
7. If EMBEDDINGS_URL is set, call TEI and verify the returned vector dimension is 768.

This covers the proposal’s stated web flow end to end — Kagent → MCP → Milvus → KServe — because it exercises FastMCP session handling, tool registration, Milvus connectivity, TEI connectivity, and post-deploy retrieval health in one pass. The IDE-agent flow has no equivalent and cannot have one until the Thin Context contract exists.
**Regression — Partial.** A seed evaluation set now exists: 24 questions, including some that the index deliberately does not cover, scored for retrieval rank, faithfulness, correctness and abstention, with failures attributed to a layer. A separate 97-case tool-use evaluation (tests/eval) drives model selection. Neither runs automatically on merge yet, and the seed set is small enough that its scores are a baseline, not a verdict. Wiring the harness into CI with score floors is the next step, and it is also the instrument that settles the collection-strategy question.
**Scale — Gap.** Blocked on Issue cncf/tab#47. No KEDA behavior to measure, and the cold-path number cannot be produced while the pod never scales to zero.

#### **Graduation Criteria**

| Criterion | Status | Notes |
| :---- | :---- | :---- |
| All 3 MCP tools returning cited answers | **Met** | Asserted by smoke_tools.py on every deploy. |
| Ingestion pipelines idempotent (no data loss on re-run) | **Met** | Delete-by-id and insert, plus a schema version guard. |
| KEDA cron + Prometheus autoscaling validated on OCI | **Not started** | Issue cncf/tab#47. |
| RAGAS context precision > 0.75 | **Partially measured** | RAGAS itself is not run. Equivalent retrieval measures on the 24-question seed set: the right page is in the top five for every answerable question and ranked first about two thirds of the time (MRR 0.78). Faithfulness is about 0.7 on a judge scaled to 1.0; the judge is a cluster-hosted model, so treat it as a trend. |
| End-to-end latency &lt; 5s (warm pod) | **Met on the seed set** | Mean 4.4 s per answer with Gemma (Qwen2.5-7B: 17.3 s), measured by the evaluation harness, not by production telemetry. No p95 yet. |
| Cold start from zero replicas &lt; 45s | **Not applicable yet** | No scale-to-zero, so there is no cold path to measure. |
| Zero hardcoded credentials | **Met** | Secrets are Kubernetes Secrets (MILVUS_PASSWORD via secretKeyRef) and no credentials are in git. The edge chart no longer carries a personal domain or contact: both are required values. |
| Deploys cleanly to a fresh namespace | **Partial** | mcp-server.yaml requires the Secret mcp-server-secret to already exist; CD fails without it. It should either be created by the pipeline or documented as an explicit prerequisite. Manifest namespaces are also still hardcoded. |
| README covers local + OCI setup | **Partial** | docs-agent-mcp/README.md covers the manual path. The Terraform and Helm path is not documented end to end. |
| Evaluation gate in CI | **Not started** | The harness exists but is not wired to merges. |
| Feedback captured as golden data | **Prototype** | Triage script validated on controlled chats; widget buttons and the feedback endpoint are not built. |
| Delivery drift visible | **Trial** | Argo CD in observe-only mode; known drift listed; no automatic reconciliation. |

#### **CI/CD**

Two workflows: .github/workflows/tests.yml (PR safety — ruff, format check, compileall, pytest) and .github/workflows/oke-cicd.yaml (compile pipelines, run tests, build and push the MCP image, deploy to OKE, run in-cluster smoke tests). The standalone image-build workflow referenced in earlier drafts has been removed as redundant.
Status against the minimum continuous-delivery checklist adopted by the Reference Architecture:

| Requirement | Status | Detail |
| :---- | :---- | :---- |
| Use continuous integration | **Met** | Every PR runs lint, compile, and the full test suite. |
| The application pipeline is the only way to deploy to any environment | **Not met** | Cluster changes have been applied by hand (helm upgrade, kubectl apply) during demo preparation. A drift register lists the differences and Argo CD, in observe-only mode, now reports them continuously. This remains the largest single gap, but it is now measured. |
| The pipeline decides releasability; its verdict is definitive | **Partial** | The pipeline gates on tests and in-cluster smoke checks, but a hand-applied change bypasses it entirely (see above). |
| Artifacts meet a definition of deployable | **Partial** | No published definition; in practice “smoke test passes” is the bar. |
| Immutable artifact, no human changes after commit | **Partial** | The image is tagged :&lt;sha7> only — immutable, but there is no promotion path and no latest. Separately, mcp-server.yaml pins ghcr.io/kubeflow/mcp-kubeflow-docs:v0.1.0, a tag that has never been published; CD rewrites it with sed at deploy time. The manifest in git is therefore not deployable as written. Publishing a real tag and pinning by digest would fix both. The llm-runtime chart pins the vLLM image by digest and the model by revision. |
| All feature work stops when the main pipeline is red | **Adopted informally** | Worth making explicit. main sat red from 1 to 8 August because an unpinned ruff picked up a widened default rule set on a new minor release — nothing in the repo changed, the linter did. Fixed by pinning ruff==0.15.9 and declaring [tool.ruff.lint] select explicitly, so the enforced rule set is a repo decision rather than a transitive one. |
| Production-like test environment | **Not met** | One cluster. No staging environment, so the proposal’s rule — an issue is not closed until confirmed in staging — cannot be applied yet. |
| Rollback on demand | **Partial** | helm rollback works for the edge chart and has been exercised. The MCP deployment has no documented or tested rollback. |
| Application configuration deploys with the artifact | **Met for the edge** | The gateway-guardrails chart carries its own configuration. |
| ArgoCD for manifest updates and promotion | **Trial (observe-only)** | Applications for docs-agent, llm-runtime and gateway-guardrails track the charts without syncing. Next: clear drift, point them at upstream main, enable manual sync, then auto-sync stateless apps. Deployment is otherwise still push-based. |
| Evaluation runs on merged code | **Not started** | The harness exists but is not wired into the pipeline. A score floor on retrieval and faithfulness would make the pipeline’s verdict cover answer quality, not only deployability. |

**One operational note for whoever configures the CD environment.** The deploy job is gated on vars.ENABLE_OKE_DEPLOY == 'true'. A job-level if: is evaluated *before* the job’s environment: is resolved, so an ENABLE_OKE_DEPLOY set inside the environment is invisible to it and the job will skip silently, forever. It must be a **repository** variable. The first post-merge CD run skipped for exactly this reason. A one-line step that echoes why the deploy was skipped would have saved a debugging cycle and is worth adding.

#### **Observability, Evaluation and Feedback**

This section was “Monitoring”: deferred by mentor alignment, and the largest gap in the first revision. It now has three parts, built in this order: tracing, evaluation, and a feedback loop that uses both.

##### **Tracing with Langfuse**

**What exists.** Self-hosted Langfuse (v4) receives traces through an OpenTelemetry collector. One chat is one trace: the agent invocation, each model call, each MCP tool call, the retrieval step (query, search mode, hit count) and the query embedding. Retrieved chunks, scores and the final answer are recorded, so a bad answer can usually be attributed to a layer from the trace alone. CD post-deploy gates and Kubernetes visibility into the kagent CRDs remain as before.
**Noise and identity.** The collector drops framework spans (HTTP wrappers and A2A internals), which cut a typical chat from about forty spans to sixteen. The widget carries a session identifier. Per-user attribution is staged behind the identity header, so today every chat maps to one gateway identity and is grouped by session instead.
**What Langfuse is used for:**

* **Prompt management:** versioned system prompts with labels (for example the prompt running on the cluster versus the one in the repository), and a playground wired to the cluster model through an LLM connection.
* **Scores and dashboards:** categorical scores on traces, and charts grouped by evaluation run or by diagnosis.
* **Experiments:** compared by run name today. Langfuse Datasets and Experiments are the planned next step.

**Honest status.** The MCP-side instrumentation currently runs from a fork build on the demo cluster and has not been merged upstream, and the retrieval span does not yet record scores. Access is invitation-only, with sign-up disabled and a read-only role for the community. The traces hold real questions, so a sanitized community project comes before any wider access. No alerts or SLOs exist.

##### **Evaluation harness**

A repeatable evaluation sends 24 seed questions through the real agent path, some answerable from the index and some deliberately not, then scores retrieval and answers. Retrieval is judged by mapping the returned chunks back to their source pages: hit@5 and mean reciprocal rank. Answers are judged for faithfulness and correctness on a 1–5 scale, and refusals on uncovered questions are checked separately. Results are written back to Langfuse as scores under a run name, which is what lets runs be compared.

| Measure | Qwen2.5-7B | Gemma 4 E4B |
| :---- | :---- | :---- |
| Right page in the top five (hit@5) | 22 of 22 | 22 of 22 |
| Right page ranked first | 14 of 22 | 15 of 22 |
| Mean reciprocal rank | 0.78 | 0.78 |
| Faithfulness (scaled to 1.0) | 0.71 | 0.69 |
| Correctness (scaled to 1.0) | 0.75 | 0.75 |
| Mean latency per answer | 17.3 s | 4.4 s |

**What the numbers say.** Retrieval finds the right page every time. The weakness is ranking and, more than either, what is in the index. Failures split into ingestion gaps (missing components, and legacy pages ranking above current ones), retrieval (query rewriting and ranking), and generation (small models partly ignore “say you could not find it”). Moving from Qwen to Gemma changed latency far more than quality.
**Caveats.** The set is small. The judge is a cluster-hosted model from one of the two families being compared, so a judge from a third family is planned. The harness lives outside the repository for now.

##### **Feedback loop and routing (prototype)**

The mentors’ idea was to close the loop: when someone does not find a solution, record it, find out which layer failed, and route it to the right group. The prototype does this offline, on traces:

* **Signal.** A thumbs-down becomes a categorical score on the trace. The widget already holds the session identifier, which is enough to find the trace. The buttons and a small feedback endpoint are not built; in testing, the score was added by hand.
* **Diagnosis.** A job reads the trace (question, tool calls, retrieved chunks, answer), searches the docs and issues indexes independently, and asks a judge whether any passage actually answers the question. It then labels the failing layer: ok, generation, retrieval, tool routing, content gap (handled or hallucinated), or agent skipped retrieval.
* **Component.** The component (pipelines, notebooks, Trainer, Katib, KServe, Spark and so on) is guessed from the question and the retrieved sources, with a suggested repository for a person to confirm.
* **Routing rule.** Route by layer first, then by component. Retrieval, tool-routing and generation problems belong to the docs-agent maintainers. Content gaps go to the owning component working group as a drafted request for documentation or an issue. Nothing is filed automatically.

**Status.** On five controlled chats (four on topics the index does not cover, one that it does), four were diagnosed correctly; the control was mislabelled once the judge was made strict. The judge needs calibrating on the labelled seed set before its verdicts can be trusted at scale, and it is the same family as the answering model. Both are known limits.
**Gaps that remain:**

* No alert rules or SLOs for latency, errors, empty retrievals or abstention rate.
* The evaluation is not a CI gate, and the harness is not yet in the repository.
* The retrieval span does not record scores, and per-user attribution is pending.
* No thumbs up/down in the widget, and no feedback endpoint.

The assistant persona from the Reference Architecture is implemented: the agent introduces itself as **Flo**.

#### **Appendix A: Runtime Configuration**

| Setting | Current value |
| :---- | :---- |
| MCP transport | FastMCP Streamable HTTP |
| MCP endpoint | /mcp |
| MCP port | 8000 |
| Docs collection | kubeflow_docs |
| Issues collection | issues_rag |
| Code collection | code_rag |
| Embedding model | sentence-transformers/all-mpnet-base-v2 |
| Embedding dimension | 768 |
| Vector index | Docs: FLAT cosine (dense) plus sparse inverted index (BM25). Issues and code: IVF_FLAT, cosine |
| LLM model | Gemma 4 E4B (served as flo-llm). Qwen2.5-7B-Instruct-AWQ is kept as a fallback profile |
| LLM serving | vLLM on KServe (Standard mode), max-model-len 32768, gpu-memory-utilization 0.90; reasoning off by default |
| LLM API style | OpenAI-compatible KServe endpoint |
| Global rate limit | 60 req/min on the chatbot HTTPS listener (EnvoyFilter local rate limit) |
| Session token | Anonymous RS256 JWT, 30-minute TTL, issued at POST /api/session (enforced) |
| Route deadline | 300 seconds on the streaming agent route; 10 seconds on the session endpoint |
| Retrieval mode | auto: a deterministic intent planner chooses dense, BM25 or hybrid per query (docs collection) |
| Tracing | OpenTelemetry collector to self-hosted Langfuse; framework spans filtered |

The model name in ModelConfig must match the served model name in the llm-runtime chart (flo-llm). vLLM’s OpenAI-compatible endpoint answers an unknown model name with a 404, so a mismatch breaks every agent request with no useful error. This is worth calling out because it is invisible in the CRD and was a real failure.

#### **Appendix B: Execution Flows**

**Query execution**

1. User asks a Kubeflow question in the widget or the Kagent UI.
2. The request crosses the Istio gateway: TLS, rate limit, CORS, session-JWT validation, chat-path allow-list, 300s stream deadline.
3. Kagent follows the Agent system message and selects one or more MCP tools.
4. The MCP server receives the tool call over Streamable HTTP.
5. The MCP server embeds the query through TEI.
6. The MCP server plans the search (dense, BM25 or hybrid) and searches the matching Milvus collection.
7. The MCP server returns the evidence text with scores and metadata, plus structured citations.
8. Kagent sends the retrieved context to the KServe LLM.
9. The answer returns to the user with citations.
10. Every step above is recorded as spans, exported to the collector, and forwarded as a filtered trace to Langfuse.

**Ingestion execution**

1. The KFP pipeline downloads source material from docs, issues, or code repositories.
2. The pipeline cleans content and creates chunks.
3. The pipeline calls TEI to create embeddings.
4. The pipeline deletes superseded records by file_unique_id and inserts the new chunks.
5. Runtime MCP tools retrieve the new records as soon as the Milvus load and index succeed.

**Feedback and evaluation execution**

* A user marks an answer not helpful (planned widget buttons), which stores a score on the trace through the session identifier.
* The triage job reads the trace, probes the docs and issues indexes independently, and has a judge decide whether any passage answers the question.
* It writes the failing layer and the suggested component back to Langfuse as scores.
* A report (planned) groups diagnoses by layer and component; people decide what is filed and with whom.
* Confirmed cases are added to the golden question set.

#### **Appendix C: Open Design Questions**

##### **C.1 Collection strategy**

**Update (October 2026).** The docs collection now has native BM25 hybrid search with a deterministic router in front of it, so option (b) below partly exists for docs. The open question is cross-source ranking across docs, issues and code, and the instrument to measure it is closer: the evaluation harness described under Observability, Evaluation and Feedback.
The Reference Architecture argues for a single collection with partitions plus native hybrid search, and against per-domain embedding models. Three parts of that argument hold, and two are worth reopening.
**Where the proposal is right.** Cross-domain ranking across separate collections is genuinely awkward, and the “federated search problem” is real: a query like *“are there open issues about KServe timeout configuration?”* wants docs and issues ranked together, and today nothing does that. Milvus hybrid search with a BM25 sparse vector is also clearly the correct mechanism for exact identifiers such as scaleToZeroGracePeriod or issue IDs, which dense embeddings handle poorly. And avoiding a second embedding model avoids a real operational cost — a second GPU-or-CPU service, a second version to track, and a second thing to keep in sync between query time and index time.
**Two points worth reopening.**
*First, the incomparable-latent-spaces objection is weaker than it appears, because RRF is the standard fix for exactly that.* Reciprocal Rank Fusion merges **rank positions**, not scores. It does not require the underlying scores to be comparable — that is the property that makes it useful for fusing BM25 with dense vectors in the first place, since those are also incomparable. The same property means RRF can fuse ranked lists retrieved from two different collections under two different models. Separate collections therefore do not strictly force manual score merging; they force a second RPC and the latency that comes with it. That is a real cost, but a smaller and more measurable one than “inaccurate”.
*Second, the proposal’s own criterion for separate collections is arguably already met.* It lists “completely different metadata schemas” as a valid reason to separate. The three collections do have materially different schemas today — issues_rag carries issue_number, issue_state, and issue_labels; code_rag carries resource_kind, resource_name, resource_namespace, and file_type. Consolidating means a union schema in which most rows leave most columns empty, which is workable but makes filtered search and future schema changes noisier.
**Recommendation: settle it empirically, with the same method the proposal already proposes for CodeBERT.** Build the 20-query golden dataset (C.3) first, then measure NDCG@5 for:

* **(a)** today’s separate collections with per-tool routed retrieval;
* **(b)** a single collection with partitions, dense + BM25 sparse, fused with RRF;
* **(c)** optionally, separate collections with RRF fusion across them — which tests whether the federated-search penalty is latency-only.

Adopt whichever wins on cross-source queries specifically, since that is the only query class where the options actually differ. Single-domain queries are routed to one collection either way and should score identically.
Two practical notes. The migration is not expensive to attempt: the schema version guard already exists to make a drop-and-reindex a controlled operation (bump to v=2, drop, re-run). And the decision should be made before Phase 3 ingestion-cadence work lands, because atomic collection swaps are designed differently for one collection than for three.

##### **C.2 Thin Context contract**

The proposal specifies “exact 150-token snippet + validation URL” with synthesis offloaded to the caller. A concrete contract:

```json
{
  "source_url": "https://...",
  "chunk_text": "<= 150 tokens>",
  "score": 0.83,
  "collection": "code_rag",
  "chunk_index": 4
}
```

Three implementation notes:

* Add a mode argument to each MCP tool — full for the Kagent path (which needs prose to synthesize from) and thin for IDE clients. One tool, two response shapes, rather than duplicate tools.
* Enforce the 150-token bound with the **tokenizer**, not a character count. This is the same bug class as the ingestion 413 in Layer 2, and getting it wrong here means an IDE client silently receives more context than it budgeted for.
* This contract makes the proposal’s stated unit test directly implementable: assert that every tool returns source_url, chunk_text, and score.

##### **C.3 Golden dataset**

Twenty questions, each with expected source URLs, run after every ingestion, scored on context precision, citation correctness, latency, and answer usefulness. Suggested distribution:

| Category | Example | Why it is in the set |
| :---- | :---- | :---- |
| Docs | How do I install or configure a Kubeflow component? | Baseline retrieval quality. |
| Issues | Has anyone reported this specific error? | Exact-match behavior on stack traces and error strings. |
| Code | Where is this Kubernetes resource or setting defined? | Identifier retrieval — the case that motivates BM25 or CodeBERT. |
| Cross-source | What do the docs say, and are there known issues? | The only class that distinguishes the collection strategies in C.1. |

The feedback loop in Layer 5 (thumbs up/down plus a webhook capturing prompt, retrieved context, and response) is the mechanism for growing this set beyond the seed, and is a prerequisite for the Katib tuning described in the Reference Architecture. **Status:** a 24-question seed set exists outside the repository and a 97-case tool-use set exists in tests/eval. Feedback triage is the intended way to grow the first.

#### **Appendix D: Reference File Index**

| Topic | File |
| :---- | :---- |
| MCP server | docs-agent-mcp/mcp-server/server.py |
| Embeddings client | docs-agent-mcp/mcp-server/embeddings_client.py |
| MCP smoke script | docs-agent-mcp/mcp-server/smoke_tools.py |
| MCP Kubernetes manifest | docs-agent-mcp/manifests/mcp-server/mcp-server.yaml |
| Kagent Agent / ModelConfig / RemoteMCPServer | docs-agent-mcp/charts/docs-agent/ (legacy: docs-agent-mcp/manifests/kagent/setup.yaml) |
| LLM runtime Helm chart | docs-agent-mcp/charts/llm-runtime/ |
| Terraform platform stack | docs-agent-mcp/terraform/ |
| Docs ingestion pipeline | docs-agent-mcp/pipelines/kubeflow-pipeline.py |
| Issues ingestion pipeline | docs-agent-mcp/pipelines/issues-pipeline.py |
| Code ingestion pipeline | docs-agent-mcp/pipelines/code-pipeline.py |
| Incremental ingestion pipeline | docs-agent-mcp/pipelines/incremental-pipeline.py |
| Shared pipeline utilities (TEI, truncation) | docs-agent-mcp/pipelines/utils/ |
| Gateway guardrails Helm chart | docs-agent-mcp/charts/gateway-guardrails/ |
| Session token issuer | docs-agent-mcp/session-issuer/ |
| Edge Terraform entry point | docs-agent-mcp/terraform/gateway_guardrails.tf |
| Chat widget | frontend/docs_scripts/chatbot.js |
| PR safety workflow | .github/workflows/tests.yml |
| OKE CI/CD workflow | .github/workflows/oke-cicd.yaml |
| Test suite | tests/ (MCP server, smoke tools, code utils, issues pipeline, pipeline utils, session issuer) |
| Intent router (retrieval planner) | docs-agent-mcp/mcp-server/intent_router.py |
| Milvus search (dense, BM25, hybrid) | docs-agent-mcp/mcp-server/milvus_search.py |
| Structured citations | docs-agent-mcp/mcp-server/citations.py |
| Canonical docs ingest (v4) | docs-agent-mcp/pipelines/utils/canonical_rag_ingest.py |
| Model-selection evaluation and results | tests/eval/ |
| Runtime design decisions | docs-agent-mcp/charts/RUNTIME_DECISIONS.md |
| RAG v4 architecture notes | docs/RAG_V4_ARCHITECTURE.md |
