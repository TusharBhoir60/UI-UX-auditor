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

### 4a. Capture Module / Pipeline Orchestration Boundary

To preserve strict modular boundaries and maintain testability, the Capture Module is decoupled from orchestration and storage concerns:

- **Interface Contract:**
  - **Invocation:** `CaptureService.capture({ url: string }, policy?: Partial<CapturePolicy>): Promise<CaptureResult>`
  - **Inputs:** A single URL string provided by the pipeline orchestrator. Destination validation (`DestinationGuardService`) is mandatory and enforced fail-closed prior to browser navigation.
  - **Outputs:** In-memory `CaptureResult` containing only:
    - `metadata`: `CaptureMetadata` (timestamps, duration, viewport, element/style/byte counts, resolved IPs, redirect count)
    - `screenshot`: Raw `Buffer` (validated PNG header)
    - `domSnapshot`: `string` (UTF-8 HTML)
    - `computedStyles`: `ElementComputedStyle[]` (bounded to `maxDomElements`)
    - `validatedDestination`: `ValidatedDestination` (normalized destination details)
  - **Encapsulation:** No browser handles, Playwright pages, browser contexts, or routing hooks escape `CaptureModule`.
- **Architectural Non-Goals for Capture Module:**
  - **No Database Persistence:** `CaptureModule` does not inject `PrismaService` or touch the database. Persisting `AuditCapture` records is the responsibility of the Stage 5 worker/orchestrator.
  - **No Queue Coupling:** Does not depend on BullMQ or Redis.
  - **No Object Storage Side-Effects:** Uploading screenshots or artifacts to S3/R2 is handled downstream in the pipeline.
  - **No HTTP Exposure:** `CaptureService` is an internal service, not bound to any HTTP controller or public route.
- **Error Semantics & Mapping:**
  - Throws typed `CaptureError` with stable codes (`INVALID_TARGET`, `BLOCKED_DESTINATION`, `BLOCKED_REDIRECT`, `DNS_RESOLUTION_FAILED`, `BROWSER_LAUNCH_FAILED`, `NAVIGATION_FAILED`, `TIMEOUT`, `ARTIFACT_GENERATION_FAILED`, `ARTIFACT_LIMIT_EXCEEDED`).
  - Error messages redact raw credentials (`user:pass@host`) and suppress internal stack traces.
  - The pipeline orchestrator maps `CaptureError` directly to `Audit.status = 'failed'` with `failureReason = err.safeReason`.
- **Lifecycle & Resource Ownership:**
  - `CaptureService` owns the full Chromium lifecycle, ensuring idempotent, bounded cleanup (`RESOURCE_CLEANUP_TIMEOUT_MS = 2,000ms`) on success, error, or cancellation.
- **Production Deployment Gates (Unchanged):**
  - Production readiness strictly requires network namespace egress firewalling (dropping RFC 1918 / link-local / cloud metadata), dedicated worker container isolation, kernel cgroups (`--cpus=1.0`, `--memory=1g`), and supervisor-level container restarts on timeout.

### 4b. Asynchronous Audit Queue Integration (BullMQ + Redis)

To decouple HTTP audit submission from browser execution and external network latency, an asynchronous queue is integrated using BullMQ and Redis:

- **Queue Topology & Responsibilities:**
  - **Queue (`audit-processing`):** Managed by `AuditQueueService`, responsible for job dispatch upon audit creation.
  - **Worker (`AuditWorkerProcessor`):** Consumes jobs from `audit-processing` with configurable concurrency (default: 1) and delegates job execution to `AuditOrchestratorService.processAudit(auditId)`.
  - **Execution Authority (`AuditOrchestratorService`):** Strictly owns all database state transitions (`queued` → `running` → `complete` / `failed`). The worker does not duplicate or alter state machine logic.
- **Job Payload Contract:**
  - Queue payloads carry strictly minimal, non-sensitive metadata: `{ auditId: string, createdAt?: string }`.
  - **Authoritative URL Resolution:** Raw URLs, credentials, or user inputs are never passed through queue payloads. The worker and orchestrator strictly load the target URL from PostgreSQL by audit ID, preventing payload spoofing or URL tampering.
  - **No Public HTTP Queue Exposure:** Queue management and internal job metrics are not exposed through public HTTP controllers.
- **Database-to-Queue Consistency Boundary & Dual-Write Gap:**
  - Dual writes across PostgreSQL and Redis are not atomic.
  - **Dispatch Workflow:**
    1. The audit record is committed to PostgreSQL in `queued` status.
    2. The job is enqueued in BullMQ with `jobId: audit.id`.
    3. If Redis enqueue fails (connection error or timeout):
       - A compensating update immediately transitions the audit to `failed` with `failureReason = 'Failed to enqueue audit for processing'`.
       - The API returns an observable HTTP 500 (`InternalServerErrorException`) to the client.
    4. If the compensating update itself fails, or if Redis accepted the job without API ACK, the audit could remain stranded in `queued`. This dual-write failure window is resolved by the Stale Audit Reconciliation mechanism.
  - **Transactional Outbox Evaluation:** An outbox pattern was evaluated. Since the source-of-truth database schema (`DATABASE.md`, `DATA_MODEL.md`) deliberately omits an outbox table for MVP, the immediate compensating failure update coupled with idempotent worker state claims and stale audit reconciliation provides observable recovery semantics without speculative schema additions.
- **Duplicate Delivery & Retry Policy:**
  - **Stable Job Identity:** Jobs use `auditId` as the BullMQ `jobId`, preventing duplicate enqueue requests from creating concurrent jobs in Redis.
  - **Conservative Retries (`attempts: 1`):** The current schema lacks fencing tokens or attempt ownership columns. Automatic retries by BullMQ could race with concurrent workers or overwrite audit state; therefore, automatic retries are disabled (`attempts: 1`).
  - **Bounded Retention:** Completed jobs are retained for 24 hours (or up to 1,000 jobs) and failed jobs for 7 days (or up to 5,000 jobs) for operational diagnosis without unbounded memory growth.
- **Stale Queued Audit Reconciliation:**
  - Managed by `AuditReconciliationService`, running as a periodic background reconciliation loop.
  - **Configuration:**
    - `AUDIT_RECONCILIATION_INTERVAL_MS`: Polling interval in ms (default: `60000` / 1 minute; set to `0` to disable the recurring timer).
    - `AUDIT_RECONCILIATION_STALE_THRESHOLD_MS`: Age threshold in ms before a `queued` audit is considered stale (default: `300000` / 5 minutes; minimum: `10000` / 10 seconds).
    - `AUDIT_RECONCILIATION_BATCH_SIZE`: Maximum audits processed per batch (default: `50`; range: `1..500`).
  - **Discovery Query:** Selects audits matching `status = 'queued'` and `createdAt <= (now - staleThreshold)`, sorted by `createdAt ASC`, strictly bounded by `take: batchSize`. Terminal (`complete`, `failed`) and running (`running`) audits are strictly excluded.
  - **Concurrency & Overlap Prevention:**
    - Single-process mutex (`isReconciling` flag) prevents overlapping runs within a single instance.
    - Across multi-replica deployments, BullMQ stable `jobId` deduplication and PostgreSQL atomic conditional status claims (`updateMany where status = 'queued'`) prevent duplicate execution.
  - **BullMQ Idempotency & Re-Enqueue Semantics:**
    - BullMQ will reject/ignore `queue.add()` for jobs whose `jobId` already exists in `failed` or `completed` state under retention.
    - `AuditQueueService.reconcileAuditJob` inspects existing job status:
      - If `waiting`, `delayed`, or `prioritized`: Logged as `already_waiting` and left untouched.
      - If `active`: Logged as `already_active` and left untouched.
      - If `completed` or `failed` (retained terminal job in Redis while PostgreSQL still records `queued`): Stale job is removed via `existingJob.remove()` and re-enqueued fresh with `jobId: auditId`.
      - If non-existent in Redis: Freshly enqueued with `jobId: auditId`.
  - **Resilience & Fault Isolation:**
    - Database query errors are safely caught, logged, and abort the current cycle without crashing the host process.
    - Redis errors during per-audit re-enqueue are caught and logged individually without aborting remaining batch items.
- **Queue and Module Lifecycle:**
  - Validated environment configuration: `REDIS_HOST` (default `localhost`), `REDIS_PORT` (default `6379`), optional `REDIS_PASSWORD`, and optional `REDIS_TLS`.
  - `WORKER_ENABLED` (boolean, default: `true`): Allows splitting API and Worker deployments into distinct container roles.
    - API container: `WORKER_ENABLED=false` (handles HTTP ingestion, queue dispatch, and reconciliation without initializing Playwright or browser processes).
    - Worker container: `WORKER_ENABLED=true` (processes background capture jobs with browser sandboxing and OS-level cgroups).
  - Queue, worker, and reconciliation lifecycle managed via NestJS `OnModuleInit` and `OnModuleDestroy` hooks (`queue.close()`, `worker.close()`, `clearInterval()`).
  - Bounded connection timeouts (5,000ms) and retry strategies prevent worker or startup hangs during Redis unreachability.
  - **Module Dependencies & `forwardRef()`:**
    - Monolithic packaging uses `forwardRef()` between `AuditsModule` and `QueueModule` because `AuditsService` creates queue jobs while `AuditWorkerProcessor` delegates to `AuditOrchestratorService`.
    - In container-isolated production deployments, API containers omit `AuditWorkerProcessor` and Worker containers omit `AuditsController`, eliminating cyclic dependencies.
- **Remaining Limitations & Future Enhancements:**
  - *Indefinite Infrastructure Outages:* Reconciliation cannot guarantee recovery if Redis or PostgreSQL remains permanently unavailable; recovery occurs deterministically once services become reachable.
  - *Fencing Tokens:* Stage 6+ multi-stage pipeline extension should introduce a fencing token or attempt-counter on `Audit` to allow safe multi-attempt automatic retries.

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
