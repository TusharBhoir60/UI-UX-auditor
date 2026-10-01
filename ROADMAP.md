# Roadmap
## UI/UX Auditor System

**Companion to:** `PRD.md`, `TRD.md`

---

## 1. Phase Overview

| Phase | Theme | Depends on |
|---|---|---|
| MVP | Single-URL, single-page audit with accessibility + visual + usability checks | — |
| Phase 2 | Depth & usefulness: multi-page, comparison, export, sharing | MVP pipeline proven |
| Phase 3 | Breadth: collaboration, custom rules, extension, monitoring | Phase 2 stable |

## 2. MVP Feature Set (recap from PRD)

1. Account creation/login
2. Submit single URL, async audit job
3. Deterministic accessibility checks
4. Hybrid visual consistency checks
5. AI usability heuristic analysis (single page)
6. Evidence-backed issue list (severity + confidence)
7. Structured report (summary + categorized issues)
8. Audit history (list only)

## 3. Phase 2 — Depth & Usefulness

| Feature | User value | Complexity | Depends on |
|---|---|---|---|
| Multi-page audits | Audits real sites, not single screens | High — crawling, per-page capture, aggregated report | MVP capture pipeline |
| Audit comparison / re-audit diffing | Tracks whether fixes actually worked | Medium — needs two completed audits + diff logic | Issue `status` field (already in MVP schema) |
| PDF export | Shareable client-facing deliverable | Medium — report-to-PDF rendering | Report module |
| Shareable report links | Client/stakeholder review without an account | Low-medium — public read-only token-based link | Report module |
| Responsive/breakpoint audits | Catches mobile-specific issues | High — multiplies capture + analysis cost per audit | Capture module extension |
| Custom brand/design-system rules | Relevant for agencies auditing against a client's own standards | High — new Rule entity, rule authoring UI | Rule engine abstraction |

## 4. Phase 3 — Breadth

| Feature | User value | Complexity | Notes |
|---|---|---|---|
| Team accounts / permissions | Enables agency/team use | High — auth model expansion, data isolation rework | Real feature, but premature before MVP proves core value |
| Browser extension | Live-page auditing without a live server fetch | High — separate delivery surface entirely | Independent effort |
| Scheduled/monitoring audits | Ongoing regression detection | Medium — needs a scheduler + notification system | Depends on comparison (Phase 2) |
| Competitor comparison | Strategic UX benchmarking | High — needs multi-audit correlation logic | Depends on comparison (Phase 2) |
| Screenshot-only input mode | Lower-friction alternative input | Medium — but degrades check quality (no DOM access), so is a deliberate trade-off, not a pure upgrade | Independent of URL pipeline |

## 5. Development Stages (dependency-ordered)

| Stage | Goal | Key Dependencies | Test Before Proceeding |
|---|---|---|---|
| 0 | Product & architecture finalized | This document set | Team/self alignment on MVP scope |
| 1 | Project foundation (repo, CI, base NestJS + Next.js scaffolding) | — | App boots, basic health check endpoint works |
| 2 | Auth module | Stage 1 | Register/login/JWT flow works end-to-end |
| 3 | Audit management (CRUD, ownership) | Stage 2 | Can create/list/view Audit records (no pipeline yet) |
| 4 | Capture module (sandboxed headless browser) | Stage 3 | Given a URL, reliably produces screenshot + DOM + styles; handles unreachable URL gracefully |
| 5 | Async job orchestration | Stage 4 | Job moves queued → running → complete/failed correctly, including failure paths |
| 6 | Deterministic rule engine (accessibility + visual variance) | Stage 4 | Checks produce correct, verifiable results against known test pages (manually validated) |
| 7 | AI analysis module | Stage 4 | Given a capture, returns structured usability findings; failures degrade gracefully (partial report) |
| 8 | Aggregation, severity, confidence assignment | Stages 6, 7 | Merged issue list is deduped, severity/confidence assigned consistently |
| 9 | Report generation | Stage 8 | Report renders correctly for both full-success and partial-failure audits |
| 10 | Frontend: results viewer + issue detail | Stage 9 | User can go from submitted URL to viewed report through the UI |
| 11 | Audit history / dashboard | Stage 3, 9 | List view reflects real audit statuses accurately |
| 12 | Security hardening (SSRF, rate limiting, sanitization) | Stage 4 | Verified against a test suite of malicious/edge-case URLs before any public deployment |
| 13 | Testing pass (end-to-end) | All above | Full pipeline run against a diverse set of real websites |
| 14 | Deployment | Stage 13 | — |

**Note:** Stage 12 (security hardening) is placed deliberately before general testing/deployment, not as an afterthought — SSRF and sandboxing are MVP-required per the TRD, not a late-stage hardening pass.

## 6. Risks Table

| Risk | Why it matters | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| False positives (deterministic checks) | Erodes trust immediately if wrong | Low if checks are correctly implemented | High | Validate rule engine against known test pages before shipping |
| AI hallucination in usability findings | Undermines credibility of the whole report | Medium | High | Confidence field, grounding prompts in actual DOM/screenshot data, human-readable "this is AI judgment" labeling |
| Target site blocks headless browsers / bot detection | Common; audit fails to even capture | High | Medium | Clear failure messaging; do not silently fail |
| SSRF via arbitrary URL submission | Security breach potential | Medium (if unmitigated) | Critical | Mandatory sandboxing + IP-range validation (Stage 12) |
| AI API cost per audit | Could make the product economically unviable at scale | Medium | Medium | Estimate cost per audit before Phase 2 scaling; consider limiting screenshot/DOM payload size sent to AI |
| Dynamic/JS-heavy sites render incompletely | Incomplete or misleading capture | Medium | Medium | Headless browser must wait for network idle / render completion heuristics; document known limitations |
| Job stuck / never reaches terminal state | Poor UX, support burden | Low if timeouts implemented | Medium | Per-stage timeouts (TRD Section 9) |

---
*This roadmap should be revisited after MVP ships — priorities in Phase 2/3 may shift based on real usage.*
