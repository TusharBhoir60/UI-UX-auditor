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

### `GET /audits/{auditId}/results`
- **Purpose:** Full audit results endpoint returning authoritative audit metadata, aggregated finding counts by severity and category, persisted issues, and associated grounded evidence.
- **Route:** `GET /api/v1/audits/{auditId}/results`
- **Auth required:** Yes (JWT via Bearer header)
- **Ownership:** Scoped strictly to the authenticated user. If the audit does not exist or belongs to another user, returns `404 Not Found` with `{"statusCode": 404, "message": "Audit not found"}` (anti-enumeration).
- **Ordering:** Issues are deterministically sorted by severity (`Critical` -> `High` -> `Medium` -> `Low`), then `createdAt` ascending (oldest first), with `id` ascending as a tie-breaker. Evidence records within each issue are ordered by `createdAt` ascending, `id` ascending.
- **Incomplete / Failed Audits:** The audit `status` remains authoritative (`queued`, `running`, `complete`, `failed`). The API never falsely reports an audit as `complete` merely because Issue rows exist.
- **Zero Findings:** A completed audit with zero findings returns `status: "complete"`, `summary.total: 0`, all category/severity counts `0`, and `issues: []`.
- **Response:** `200` with:
  ```json
  {
    "audit_id": "22222222-2222-4222-8222-222222222222",
    "url": "https://example.com",
    "status": "complete",
    "failure_reason": null,
    "created_at": "2026-10-23T01:00:00.000Z",
    "completed_at": "2026-10-23T01:01:00.000Z",
    "summary": {
      "total": 2,
      "by_severity": {
        "Critical": 1,
        "High": 0,
        "Medium": 0,
        "Low": 1
      },
      "by_category": {
        "accessibility": 1,
        "visual": 1,
        "usability": 0
      }
    },
    "issues": [
      {
        "id": "33333333-3333-4333-8333-333333333333",
        "audit_id": "22222222-2222-4222-8222-222222222222",
        "category": "accessibility",
        "title": "Button lacks an accessible name",
        "description": "The <button> has no visible text or label.",
        "severity": "Critical",
        "confidence": "deterministic",
        "standard_reference": "WCAG 4.1.2",
        "recommendation": "Add visible text or aria-label.",
        "status": "open",
        "created_at": "2026-10-23T01:00:30.000Z",
        "evidence": [
          {
            "id": "44444444-4444-4444-8444-444444444444",
            "issue_id": "33333333-3333-4333-8333-333333333333",
            "dom_selector": "button#submit",
            "snippet": "<button id=\"submit\"></button>",
            "highlighted_region": { "x": 10, "y": 20, "width": 100, "height": 40 },
            "screenshot_crop_url": null,
            "created_at": "2026-10-23T01:00:30.000Z"
          }
        ]
      }
    ]
  }
  ```


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
