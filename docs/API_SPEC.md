# API Specification (MVP)
## UI/UX Auditor System

**Base path:** `/api/v1`
**Companion to:** `TRD.md`, `DATA_MODEL.md`

All endpoints except `/auth/*` require a valid session/JWT. All Audit-scoped endpoints enforce ownership (a user can only access their own Audits).

---

## Auth

### `POST /auth/register`
- **Body:** `{ email, password }`
- **Response:** `201` with user id, or `400` on validation failure (weak password, duplicate email)
- **Auth required:** No

### `POST /auth/login`
- **Body:** `{ email, password }`
- **Response:** `200` with session token/JWT, or `401` on invalid credentials
- **Auth required:** No

---

## Audits

### `POST /audits`
- **Purpose:** Create a new audit and enqueue the pipeline job
- **Body:** `{ url }`
- **Response:** `201` with `{ audit_id, status: "queued" }`
- **Auth required:** Yes
- **Notes:** Validates URL format server-side; SSRF/domain validation happens at capture time, not here, but obviously malformed input is rejected immediately with `400`

### `GET /audits`
- **Purpose:** List the current user's audit history
- **Response:** `200` with array of `{ audit_id, url, status, created_at, summary_counts }`
- **Auth required:** Yes

### `GET /audits/{auditId}`
- **Purpose:** Get audit status and, if complete, the full report
- **Response:** `200` with audit metadata + `report` object if `status == complete`; `404` if not found or not owned by requester
- **Auth required:** Yes

### `GET /audits/{auditId}/status`
- **Purpose:** Lightweight polling endpoint for job progress (used by the Audit Processing screen)
- **Response:** `200` with `{ status, stage, failure_reason (nullable) }`
- **Auth required:** Yes

---

## Issues

### `GET /audits/{auditId}/issues`
- **Purpose:** List issues for a completed audit
- **Query params:** `category`, `severity` (optional filters)
- **Response:** `200` with array of Issue objects (id, category, title, severity, confidence, standard_reference)
- **Auth required:** Yes

### `GET /audits/{auditId}/issues/{issueId}`
- **Purpose:** Full issue detail including evidence
- **Response:** `200` with full Issue object + Evidence (screenshot crop URL, highlighted region, dom_selector, recommendation)
- **Auth required:** Yes

---

## Reports

### `GET /audits/{auditId}/report`
- **Purpose:** Get the denormalized report summary (counts, top issues)
- **Response:** `200` with Report object
- **Auth required:** Yes

---

## Real-Time / Push (optional for MVP)

Job status changes are exposed via `GET /audits/{auditId}/status` polling in MVP. A lightweight WebSocket channel (`/ws/audits/{auditId}`) pushing status updates is a reasonable Phase 2 upgrade to reduce polling overhead — **not required for MVP**, since audit volume per user is low and polling is simpler to build and debug first.

---

## Explicitly Not in MVP API Surface

- `/audits/{id}/compare/{otherId}` (audit comparison — Phase 2)
- `/audits/{id}/export` (PDF export — Phase 2)
- `/teams`, `/projects/{id}/members` (collaboration — Phase 3)
- `/rules` (custom rule definitions — Phase 3)

---

## Error Handling Conventions

- `400` — malformed request (invalid URL format, missing fields)
- `401` — missing/invalid auth
- `403` — authenticated but not authorized (accessing another user's audit)
- `404` — resource not found
- `422` — audit could not be processed (e.g., URL unreachable) — returned via the audit's `status`/`failure_reason` fields, not as an HTTP error on creation, since the job is accepted and only fails asynchronously
- `429` — rate limit exceeded (per-user audit submission cap)
