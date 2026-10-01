# Data Model
## UI/UX Auditor System

**Companion to:** `TRD.md`

---

## 1. Storage Strategy

**Hybrid relational + JSONB (PostgreSQL).**

- **Relational:** User, Audit, Job, Issue, Evidence metadata — anything queried, filtered, sorted, or joined regularly (e.g., "list all Critical issues across my audits").
- **JSONB:** Raw captured DOM snapshot, computed style dump, raw AI response payload — large, semi-structured, rarely queried directly, and shape may evolve as checks are added without requiring migrations.

## 2. Core Entities

### User
- `id`, `email`, `password_hash`, `created_at`
- Owns: Audits
- Lifecycle: created at signup, soft-delete only (never hard-delete, to preserve audit history integrity)

### Audit
- `id`, `user_id` (FK), `url`, `status` (`queued` | `running` | `complete` | `failed`), `failure_reason` (nullable), `created_at`, `completed_at`
- Owns: one AuditCapture, many Issues, one Report
- Lifecycle: created on submission → updated as job progresses → terminal state complete/failed

### AuditCapture
- `id`, `audit_id` (FK), `screenshot_url` (object storage reference), `dom_snapshot` (JSONB), `computed_styles` (JSONB), `captured_at`
- Represents the raw evidence base for an audit; exists once per Audit in MVP (multi-page/multi-capture is a Phase 2 extension of this entity)

### Issue
- `id`, `audit_id` (FK), `category` (`accessibility` | `visual` | `usability`), `title`, `description`
- `severity` (`Critical` | `High` | `Medium` | `Low`)
- `confidence` (`deterministic` | `high` | `medium` | `low`) — reflects whether this came from a rule engine or AI judgment
- `standard_reference` (nullable — e.g. `WCAG 1.4.3`, `Nielsen Heuristic #4`)
- `recommendation` (text)
- `status` (`open` | `acknowledged` | `fixed`) — field exists in MVP schema but UI/workflow for changing it is Phase 2 (needs audit comparison to be meaningful)
- Relationships: belongs to one Audit, has one or more Evidence records

### Evidence
- `id`, `issue_id` (FK), `screenshot_crop_url`, `highlighted_region` (bounding box coordinates, JSONB), `dom_selector` (nullable, for DOM-groundable issues)
- Purpose: ties every Issue to a verifiable location in the captured page, not just prose

### Report
- `id`, `audit_id` (FK), `summary` (JSONB — counts by severity/category), `generated_at`
- A denormalized snapshot for fast rendering of the results page; derivable from Issues but stored to avoid recomputation on every view

### Job
- `id`, `audit_id` (FK), `stage` (`capture` | `deterministic_checks` | `ai_analysis` | `aggregation`), `status`, `started_at`, `finished_at`, `error_message` (nullable)
- Tracks pipeline progress per stage — allows partial-failure handling (e.g., AI stage fails but deterministic stage succeeded)

## 3. Entity Relationships

```
User (1) ──< (many) Audit
Audit (1) ──  (1) AuditCapture
Audit (1) ──< (many) Issue
Audit (1) ──  (1) Report
Audit (1) ──< (many) Job   [one per pipeline stage]
Issue (1) ──< (many) Evidence
```

## 4. Notes on Evolution

- **Multi-page audits (Phase 2):** AuditCapture becomes one-to-many per Audit; Issue gains a `page_id` reference. Designing AuditCapture as its own entity now (rather than fields inline on Audit) makes this change additive, not a restructure.
- **Audit comparison (Phase 2):** requires a new `AuditComparison` entity referencing two Audit IDs and a diff of Issues between them — not needed for MVP schema but the Issue `status` field is already in place to support it.
- **Custom rules / brand guidelines (Phase 3):** would introduce a `Rule` entity scoped per-user/project, referenced by Issue in place of (or alongside) the fixed `standard_reference`.

## 5. Fields Deliberately Excluded from MVP Schema

- Team/project sharing fields on Audit (no multi-user ownership in MVP)
- `comparison_id` on Issue (no comparison feature yet)
- Any responsive/breakpoint dimension on AuditCapture (single-viewport capture only in MVP)
