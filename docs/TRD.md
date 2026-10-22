# Technical Requirements Document (TRD)
## UI/UX Auditor System

**Version:** 1.0 (MVP Architecture)
**Companion to:** `PRD.md`, `DATA_MODEL.md`, `API_SPEC.md`, `ROADMAP.md`

---

## 1. Architecture Style

**Decision: Modular monolith (NestJS), not microservices, for MVP and Phase 2.**

Rationale: solo/small-team build, no independent-scaling requirement yet, and microservices add operational overhead (service discovery, distributed tracing, network failure handling) with no corresponding benefit at this stage. Module boundaries are still enforced in code (NestJS module/DI system, one module per bounded responsibility) so a future split to services remains possible without a rewrite.

## 1a. Tech Stack Decision

**Chosen stack: TypeScript end-to-end — Next.js (frontend) + NestJS (backend) + PostgreSQL + Redis (job queue via BullMQ) + Playwright (capture).**

This replaces an earlier default of Java + Spring Boot. Reasoning, compared against the alternatives seriously considered:

| Factor | Node.js/TS (NestJS) | Java (Spring Boot) | Python (FastAPI) |
|---|---|---|---|
| Headless browser support | Native/first-class — Playwright is a Node-ecosystem tool | Official bindings, but secondary ecosystem, weaker docs/examples | Official bindings, secondary ecosystem |
| Workload fit (I/O-bound: browser capture, AI API calls, job orchestration) | Event loop is well suited to exactly this | Fine, but designed more for CPU/thread-pool workloads | Fine with async/await, less mature tooling than Node here |
| Module boundary enforcement (needed for "modular monolith") | NestJS replicates Spring's DI/module system directly | Strong, this was the original rationale | Weaker by default, FastAPI is less opinionated |
| Language consistency with frontend | Same language (TypeScript) as Next.js frontend — shared types for Audit/Issue/Report models | Different language than frontend (context switching, no shared types) | Different language than frontend |
| Team familiarity (this project) | Existing hands-on experience | None | None |
| Job queue ecosystem | BullMQ + Redis — standard, simple, well-documented | Mature but heavier (Spring Batch-style) | Mature (Celery) but a separate paradigm |

**Decision:** Node.js/TypeScript across the stack. The capture module (headless browser automation) is the riskiest and most central part of the system per Section 4 below — building it where the tooling is native reduces implementation risk. Shared TypeScript types between Next.js and NestJS reduce integration bugs. NestJS's module/DI system preserves the same enforced-boundaries approach the modular-monolith decision was originally built around, so nothing is lost there.

**Constraint to design around:** Node's single-threaded event loop is not well suited to genuinely CPU-heavy work. This doesn't bite for MVP — headless rendering and AI inference both happen outside the Node process (Playwright drives a separate browser process; AI calls are external HTTP). If CPU-heavy work is added later (e.g. local image diffing for visual regression), it should run in a worker thread or separate process, not inline in the request/job handler.

**Frontend/backend split:** Next.js is used for the frontend UI only, not as the home for pipeline execution. Long-running headless-browser jobs don't belong in Next.js API routes (serverless/edge runtimes impose execution time limits) — the backend remains a separate NestJS service, consistent with the async-job-from-day-one requirement in Section 4.

**What did not change with this decision:** PostgreSQL (relational + JSONB), the pipeline stages, the module responsibilities (Section 3), and the security requirements (Section 6) — all of these were expressed generically and are not language-dependent.

## 2. High-Level System Architecture

```
┌─────────────────────────────────────────────┐
│         CLIENT (Next.js + TypeScript)        │
│  Dashboard │ Create Audit │ Results Viewer    │
└───────────────────┬───────────────────────────┘
                     │ REST (HTTPS)
┌────────────────────▼──────────────────────────┐
│        BACKEND (Modular Monolith, NestJS)      │
│  ┌────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Auth / │ │ Audit    │ │ Audit Orchestrator│ │
│  │ Users  │ │ Mgmt     │ │ (async job runner)│ │
│  └────────┘ └──────────┘ └─────────┬─────────┘ │
│                          ┌──────────┴─────────┐ │
│                          │ Capture Module      │ │
│                          │ (sandboxed headless │ │
│                          │  browser)           │ │
│                          ├─────────────────────┤ │
│                          │ Deterministic Rule  │ │
│                          │ Engine              │ │
│                          ├─────────────────────┤ │
│                          │ AI Analysis Module   │ │
│                          │ (vision + reasoning) │ │
│                          ├─────────────────────┤ │
│                          │ Aggregation /        │ │
│                          │ Severity / Report    │ │
│                          └─────────────────────┘ │
└──────────┬───────────────────────┬───────────────┘
           │                       │
   ┌───────▼──────┐        ┌───────▼──────┐
   │ PostgreSQL   │        │ Object Storage│
   │ (relational  │        │ (screenshots) │
   │  + JSONB)    │        └──────────────┘
   └──────┬───────┘
          │
   ┌──────▼───────┐
   │ Job Queue     │
   │ (BullMQ +     │
   │  Redis)       │
   └───────────────┘
```

## 3. Core Modules

| Module | Responsibility |
|---|---|
| Auth/Users | Registration, login, session/JWT issuance |
| Audit Management | CRUD for Audit entities, ownership, history listing |
| Audit Orchestrator | Coordinates the pipeline; enqueues/dequeues jobs; tracks job status |
| Capture Module | Launches sandboxed headless browser; captures screenshot, DOM, computed styles |
| Deterministic Rule Engine | Runs fixed, code-defined checks (contrast, alt text, touch targets, font size, spacing variance) |
| AI Analysis Module | Sends screenshot + relevant DOM excerpts to a vision-capable model; returns usability/visual-hierarchy findings |
| Aggregation/Report Module | Dedupes overlapping findings, assigns severity/confidence, builds final report |

## 4. Processing Pipeline (MVP)

```
1. User submits URL
2. Create Audit record + Job (status: queued)
3. [async worker] Launch sandboxed headless browser
4. Capture: screenshot + DOM snapshot + computed styles
5. Run deterministic rule engine → raw findings A
6. Send screenshot + relevant DOM excerpts to AI → raw findings B
7. Merge A + B: dedupe, assign severity + confidence
8. Persist Issues + Evidence
9. Generate Report
10. Mark job complete → notify frontend (poll or lightweight push)
```

Failure at any stage (esp. step 3-4: page unreachable, blocked, requires auth) marks the job `failed` with a specific, user-facing reason — never a silent empty report. If step 6 (AI) fails but step 5 succeeded, the report is still generated from deterministic findings, flagged as partial.

## 5. Key Architectural Decisions

| # | Decision | Chosen Approach | Reasoning | Reversible later? |
|---|---|---|---|---|
| 1 | Input method | URL + sandboxed headless browser (Playwright/Puppeteer) | Provides DOM + computed styles + screenshot in one pass; screenshot-only input cannot support real contrast/semantic checks | Costly to change — input method shapes every downstream check |
| 2 | Sync vs async processing | Async job queue from day one | Headless capture + AI calls take seconds-to-minutes; a sync request would time out or block the UI | Hard to retrofit — build async from the start |
| 3 | Sandboxing/SSRF protection | Isolated network policy + container sandbox for the browser process | Users submit arbitrary URLs server-side fetches; without this, SSRF is a direct vulnerability | Must be in place before any public deployment |
| 4 | Deterministic vs AI split | Deterministic for anything with an exact numeric/standard threshold (contrast, touch target size, alt text, font size); AI for qualitative judgment (visual hierarchy, heuristics); hybrid for variance-type checks (spacing consistency) | Reduces false positives/hallucination risk; keeps trust high | Split can be refined but the principle should hold long-term |
| 5 | Data storage model | Hybrid relational + JSONB: relational for Audit/Issue/User metadata, JSONB for raw DOM/style snapshots | Raw captured data is unstructured and rarely queried directly; metadata needs relational integrity and query flexibility | Low risk to commit now |
| 6 | Modular monolith vs microservices | Modular monolith | No independent scaling need yet; avoids premature distributed-systems complexity | Revisit only if a specific module (e.g. AI analysis) needs independent scaling |
| 7 | Severity scoring | Rule-anchored base score (e.g., WCAG conformance level maps to a severity floor) + AI contextual adjustment, never pure AI scoring | Avoids arbitrary "AI vibes" severity, keeps the report defensible | Adjust weighting later without changing the architecture |
| 8 | AI model / cost | Vision-capable LLM, exact model choice deferred; must estimate per-audit cost before Phase 2 planning (screenshots are token/cost-heavy) | Cost directly affects rate limiting and pricing decisions later | Model swap should be isolated to AI Analysis Module |

## 6. Security Requirements (MVP-mandatory, not deferred)

- **SSRF protection:** validate/deny requests to private IP ranges, localhost, cloud metadata endpoints before the headless browser fetches a URL.
- **Sandboxing:** headless browser runs in an isolated process/container with no access to internal network segments.
- **Upload/content validation:** any future file upload path (screenshots, HTML) must validate MIME type and size before processing (Phase 2+, but design now).
- **Prompt injection resistance:** page content is passed to an LLM — treat all extracted DOM text/attributes as untrusted input; never let page content override system instructions to the AI module.
- **AuthN/AuthZ:** standard JWT/session-based auth; every Audit is scoped to its owning user; no cross-user data access.
- **Rate limiting:** per-user submission limits are required at MVP given the cost of headless browser + AI calls per audit.
- **Standard web hygiene:** XSS/CSRF protection on all endpoints, especially anywhere captured page content or AI output is rendered back into the frontend (captured content must be sanitized before display).

## 7. Performance & Scalability Notes (MVP-appropriate, not over-engineered)

- Single headless browser instance per job; concurrency limited by a worker pool size (configurable), not by building a distributed browser farm prematurely.
- Screenshots and raw DOM snapshots stored once; large DOM payloads (JSONB) should be size-capped with truncation/handling for excessively large pages.
- AI calls are the primary latency and cost driver — batch/limit what's sent (relevant DOM excerpts + screenshot, not full raw HTML) rather than optimizing infrastructure first.
- Job queue table (or lightweight queue like Redis-backed) is sufficient for MVP concurrency; no need for a heavyweight message broker yet.

## 8. Frontend Architecture (MVP)

**Stack:** Next.js + TypeScript. Used for UI rendering and client-side data fetching only — pipeline execution (capture, job orchestration, AI calls) lives entirely in the NestJS backend, not in Next.js API routes, per the constraint noted in Section 1a.

**Screens:** Login/Register, Dashboard (audit history list), Create Audit, Audit Processing (job status), Audit Results (summary + issue list + issue detail).

**State management:** Server state (audits, issues) via a data-fetching layer (e.g., React Query-style caching) rather than manual global state; local UI state (filters, selected issue) kept component-local. No complex client-side document model is needed here (unlike a design editor) — the frontend is primarily a viewer over server-computed results.

## 9. Non-Functional Requirements

- Audit job should reliably reach a terminal state (`complete` or `failed`) — no jobs stuck indefinitely; implement a timeout per stage.
- All timestamps stored in UTC.
- API responses versioned (`/api/v1/...`) to allow schema evolution without breaking the frontend during active development.

---
*See `DATA_MODEL.md` for entity detail and `API_SPEC.md` for endpoint contracts.*
