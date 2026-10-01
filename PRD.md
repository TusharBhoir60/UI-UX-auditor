# Product Requirements Document (PRD)
## UI/UX Auditor System

**Version:** 1.0 (MVP Definition)
**Status:** Draft for review

---

## 1. Product Summary

A web-based system that audits an existing website's UI/UX by accepting a URL, capturing its rendered state (screenshot + DOM + computed styles), and producing a structured, evidence-backed report of accessibility, visual consistency, and usability issues — each with severity, confidence, and a concrete recommendation.

**One-line pitch:** Automated, evidence-based UX audits — not an AI opinion generator.

## 2. Problem Statement

- Manual UX/accessibility audits are slow and expensive (agency/consultant-driven).
- Automated tools (e.g., Lighthouse) cover a narrow technical slice — mostly performance and basic a11y — and don't reason about usability or visual design.
- Asking a general-purpose chatbot to "review my site" produces unstructured, unverifiable, non-repeatable output with no evidence trail and nothing to track over time.

## 3. Goals

1. Let a user submit a URL and receive a structured audit within a reasonable wait time (job-based, not instant).
2. Ground every finding in evidence (screenshot region + DOM reference), not just prose.
3. Distinguish deterministic facts (WCAG contrast failure) from AI judgment (weak visual hierarchy) via a confidence field.
4. Produce a report that answers "what should I fix first?" without collapsing everything into a meaningless single score.
5. Persist audits so a history exists, laying groundwork for comparison in a later phase.

## 4. Non-Goals (explicitly out of scope for MVP)

- Multi-page / full-site crawling audits
- Responsive design audits across breakpoints
- Live interaction testing (hover, loading, error states)
- Audit comparison / re-audit diffing
- Team accounts, permissions, comments, sharing links
- Browser extension
- Screenshot-only (no-DOM) input mode
- Custom brand guideline / design-system consistency rules
- Competitor comparison

These are real, valuable features (see `ROADMAP.md`) but are deliberately deferred so the core single-audit loop can be built and proven first.

## 5. Target Users

| Persona | Goal | MVP Relevance |
|---|---|---|
| Solo developer / student | Sanity-check a project before shipping | Primary MVP user |
| Freelancer / small agency | Produce a professional-looking report for a client | Primary MVP user |
| Product team / PM | Prioritize a backlog of UX fixes | Secondary — benefits from MVP but not designed around |
| UI/UX designer | Validate design decisions against heuristics | Secondary |

Team/admin personas requiring collaboration and permissions are **not** MVP users.

## 6. Core User Workflow (MVP)

```
Sign up / Login
  → Dashboard (list of past audits)
    → Create Audit → enter URL
      → Job runs asynchronously (status: queued → running → complete/failed)
      → Audit Results page
          → Summary (issue counts by category/severity)
          → Issue list (filterable by category/severity)
          → Issue detail (evidence, explanation, recommendation)
      → Audit saved to history (list view only, no comparison)
```

### Failure handling (must be designed, not an edge case)
- Invalid/unreachable URL → clear failure reason shown to user, job marked `failed`.
- Site blocks headless browsers / requires auth → same, with a specific "could not render this page" message rather than a silent empty report.
- Partial failure (e.g., AI call fails but deterministic checks succeed) → report is still generated with deterministic findings, and this partial state is visibly flagged, not hidden.

## 7. Audit Scope (What Gets Audited)

### In MVP
| Category | Method | Notes |
|---|---|---|
| Accessibility | Deterministic (contrast ratio, alt text, font size, touch target size, basic semantic structure) | WCAG-referenced where applicable |
| Visual consistency | Hybrid (deterministic variance detection + AI judgment on significance) | Spacing, alignment, button/style consistency |
| Usability heuristics | AI (vision + reasoning) on a single-page snapshot | Based on Nielsen's 10 heuristics |

### Deferred (Phase 2+)
- Full user-flow / task-completion analysis
- Responsive/breakpoint audits
- Interaction-state audits (hover, loading, error)
- Design-system/brand consistency
- Competitor comparison

## 8. Issue Model (Product-Level Requirements)

Every issue surfaced to the user must include:
- Category, title, plain-language description
- Evidence: screenshot crop with highlighted region + DOM reference
- Severity (Critical / High / Medium / Low)
- Confidence (reflects whether the finding is deterministic fact or AI judgment)
- Standard/heuristic reference where one exists (WCAG success criterion, named heuristic), or none for pure visual findings
- A concrete, actionable recommendation (not just "improve this")

Full technical schema is defined in `DATA_MODEL.md`.

## 9. Report Requirements

The audit report must:
- Lead with a summary (counts by severity/category), not a single opaque score.
- Group issues by category with the ability to sort/filter by severity.
- Clearly visually distinguish deterministic findings from AI-derived findings (via confidence).
- Answer "what should I fix first?" — Critical/High issues surfaced prominently.
- Avoid reducing everything to a single arbitrary numeric score; if a summary score is shown, it must be explained (e.g., "based on N Critical, N High issues") rather than presented as a black box.

## 10. Input Requirements

- MVP accepts a single **URL** as input.
- The system performs a live capture via a sandboxed headless browser: screenshot + DOM snapshot + computed styles.
- Screenshot-only upload and HTML/CSS file upload are explicitly deferred (see `TRD.md` for rationale).
- Because arbitrary user-submitted URLs are fetched server-side, SSRF protection and sandboxing are **MVP-required security features**, not later hardening.

## 11. MVP Feature List

1. Account creation / login (email + password)
2. Create audit by submitting a URL
3. Async audit job with visible status (queued/running/complete/failed)
4. Deterministic accessibility checks
5. Deterministic + AI-assisted visual consistency checks
6. AI-based usability heuristic analysis (single page)
7. Issue list with evidence, severity, confidence, recommendation
8. Structured report view (summary + categorized issues)
9. Audit history (list of past audits, no comparison)

## 12. Success Criteria for MVP

- A user can go from "paste URL" to "readable, evidence-backed report" without manual intervention.
- Deterministic checks (contrast, alt text, touch targets) produce zero false positives on a set of manually verified test pages.
- AI-derived findings are visibly marked as lower-confidence/judgment-based in the UI.
- Failed audits (blocked sites, invalid URLs) fail clearly and informatively rather than silently or with a generic error.

## 13. Open Questions for Review

- What is the acceptable wait time for an audit job before we consider UX unacceptable?
- Do we cap audit submissions per user/day for cost control (AI + headless browser compute) in MVP, or defer rate limiting design?
- Should Critical/High severity thresholds be fixed constants for MVP or configurable later?

---
*See `TRD.md` for architecture and implementation detail, `DATA_MODEL.md` for schema, `API_SPEC.md` for endpoints, and `ROADMAP.md` for phased delivery plan.*
