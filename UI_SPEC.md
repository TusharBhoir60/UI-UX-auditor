# UI Specification (MVP)
## UI/UX Auditor System

**Companion to:** `PRD.md`, `API_SPEC.md`
**Stack:** Next.js + TypeScript (see `TRD.md` Section 1a)

---

## 1. Screen Inventory (MVP)

| Screen | Purpose | Auth required |
|---|---|---|
| Login / Register | Account access | No |
| Dashboard | List of past audits, entry point to create a new one | Yes |
| Create Audit | Submit a URL to audit | Yes |
| Audit Processing | Live status of a running job | Yes |
| Audit Results | Summary + issue list + issue detail | Yes |

Not in MVP: team settings, project settings, comparison view, export/share screens (see `ROADMAP.md` Phase 2/3).

## 2. Screen Details

### Login / Register
- Email + password fields, validation inline (not just on submit)
- Register/login toggle, no social auth in MVP (keep auth surface small)

### Dashboard
- Table/list of audits: URL, status badge (queued/running/complete/failed), created date, quick severity summary (e.g. "3 Critical, 5 High")
- Primary CTA: "New Audit"
- Clicking a row with `status: complete` → Audit Results; `status: failed` → shows failure reason inline, with a retry action; `status: queued/running` → Audit Processing

### Create Audit
- Single field: URL input, with client-side format validation before submit
- Submit → immediately navigates to Audit Processing (job is created and queued server-side)

### Audit Processing
- Shows current stage (capture → deterministic checks → AI analysis → aggregation) reflecting the `Job.stage` field from `DATABASE.md`
- Polls `GET /audits/{id}/status` (interval-based, not aggressive — this is not a real-time-critical screen)
- On `failed`: shows the specific failure reason from the backend (never a generic error) with a retry option
- On `complete`: auto-navigates to Audit Results

### Audit Results
This is the highest-value screen and the one to get right per the PRD's "what should I fix first" principle.

**Layout:**
```
┌────────────────────────────────────────────┐
│ Audit Header (URL, date, status)             │
├────────────────────────────────────────────┤
│ Summary: counts by severity, counts by       │
│ category — NOT a single opaque score          │
├──────────────────┬───────────────────────────┤
│ Issue List        │ Issue Detail               │
│ (filterable by     │  - Description              │
│  category/severity)│  - Evidence: screenshot     │
│  Each row shows:    │    crop with highlighted    │
│  - title            │    region                    │
│  - severity badge   │  - Why it matters             │
│  - confidence        │  - Standard/heuristic ref     │
│    indicator         │  - Recommendation              │
│    (deterministic    │                                 │
│    vs AI-judged)      │                                 │
└──────────────────┴───────────────────────────┘
```

- **Confidence must be visually distinct**, not just a text label — e.g., a solid badge for deterministic findings ("Fact: fails WCAG 1.4.3") vs. a softer/outlined badge for AI judgment ("AI assessment: weak visual hierarchy"). This is the direct UI expression of the PRD's core trust requirement.
- Filtering by category/severity should update the list without a full page reload.
- Partial-failure audits (AI stage failed but deterministic succeeded) must show a visible banner explaining the report is partial — never silently present an incomplete report as complete.

## 3. Design Principles

- **Evidence-first, not score-first.** The summary should never be the only thing on screen — it's a way in, not the conclusion.
- **No dark patterns around severity.** Don't visually minimize Critical/High issues to make the report "feel" more positive; the product's credibility depends on this.
- **Distinguish fact from judgment everywhere confidence applies** — this is a recurring UI pattern, not a one-off on the results screen.
- **Fail loudly, not silently.** Every failure state (job failure, partial report, unreachable URL) gets a specific, visible explanation.

## 4. State Management Notes

- Server state (audits, issues, job status) fetched via a caching data layer (e.g. React Query or Next.js server components + revalidation) — not manually managed global state.
- Local UI state (active filters, selected issue in the detail pane) stays component-local; it does not need to be persisted or synced.
- No complex client-side document model is required — unlike a design editor, this frontend is a viewer over server-computed results, which keeps frontend complexity low relative to the backend pipeline.

## 5. Out of Scope for MVP UI

- Real-time push updates (polling is sufficient at MVP audit volumes — see `API_SPEC.md`)
- Comparison view between two audits
- PDF export / shareable public links
- Any settings/customization screens
