# AI Rules
## UI/UX Auditor System

**Companion to:** `TRD.md` Section 5, `PRD.md` Section 7-8, `SECURITY.md` Section 3

This document is the canonical reference for **where AI is used, where it is deliberately not used, and how its output is constrained** — the core trust mechanism of the whole product.

---

## 1. Governing Principle

> If a check has an exact, standard-defined threshold, compute it deterministically and cite the standard. Reserve AI for judgment calls a spec cannot fully capture.

This principle exists because the product's differentiation (per `PRD.md`) is being *trustworthy*, not just "an AI that reviews your site." Every AI-derived finding is a credibility risk (false positive, hallucination); every deterministic finding is a credibility asset (verifiable, citable, reproducible). The system should default to deterministic wherever possible and only reach for AI where no formula exists.

## 2. Deterministic vs. AI Split (authoritative table)

| Check | Method | Rationale |
|---|---|---|
| Contrast ratio | **Deterministic** — compute from actual rendered colors | Exact math; WCAG gives exact thresholds |
| Touch target size | **Deterministic** — measure DOM bounding boxes | Exact, measurable |
| Alt text presence | **Deterministic** — DOM query | Exact |
| Font size / readability | **Deterministic** — computed styles | Exact |
| Semantic structure (headings, landmarks) | **Deterministic** — DOM/ARIA tree analysis | Exact, rule-based per WCAG |
| Spacing/alignment consistency | **Hybrid** — deterministic variance detection (e.g. margin/padding variance across similar elements) + AI judgment on whether the variance is *meaningfully* inconsistent | Raw statistical variance alone is noisy; AI adds "does this actually matter" judgment on top of a deterministic signal |
| Visual hierarchy | **AI** (vision-capable model on screenshot) | No deterministic formula for "does this draw the eye correctly" |
| Usability heuristics (Nielsen's 10) | **AI** (reasoning over DOM + screenshot) | Inherently qualitative, no fixed threshold exists |
| Severity assignment | **Hybrid** — deterministic base score derived from standard conformance level (e.g. WCAG A/AA/AAA), AI may adjust within a bounded range for context | Prevents severity from being arbitrary AI output while still allowing contextual nuance |

**Rule for future checks:** before adding any new check, first ask "is there a spec, standard, or measurable formula for this?" If yes, it goes in the deterministic engine, even if that's more implementation effort than a prompt — the trust payoff is worth it.

## 3. Confidence Field Semantics

Every Issue carries a `confidence` value (see `DATABASE.md`). This is not a vague quality score — it directly reflects *how the finding was produced*:

| Confidence | Meaning |
|---|---|
| `deterministic` | Produced by a rule-engine check with an exact formula/standard — not an estimate |
| `high` | AI-derived, but grounded in strong, unambiguous visual/structural evidence |
| `medium` | AI-derived, some judgment involved, evidence is present but interpretation matters |
| `low` | AI-derived, primarily inferential — should be visually de-emphasized in the UI per `UI_SPEC.md` |

The AI Analysis Module must self-report a confidence tier as part of its structured output; this is not assigned after the fact.

## 4. AI Input Constraints

- The AI Analysis Module receives: the page screenshot, a *curated* subset of relevant DOM excerpts (not the full raw DOM dump), and a fixed system prompt defining its task and output schema.
- Full raw HTML/DOM is **not** sent wholesale to the AI — this controls cost (token volume) and reduces the injection attack surface (see `SECURITY.md` Section 3).
- The AI's task is scoped narrowly per call (e.g., "evaluate visual hierarchy" as one call, "evaluate against Nielsen heuristics" as another) rather than one open-ended "review this page" prompt — narrower scope produces more consistent, parseable, and citable output.

## 5. AI Output Constraints

- Output must conform to a strict structured schema (category, title, description, severity suggestion, confidence, standard/heuristic reference if applicable, recommendation) — free-form prose responses are rejected/re-requested, not passed through to users.
- The AI is never given the ability to directly set final severity — it proposes, the Aggregation Module (per `ARCHITECTURE.md`) applies the rule-anchored adjustment described in Section 2 above.
- The AI is never granted tool-use/action capability in this pipeline — it returns findings only, with no ability to trigger side effects. This is both a security boundary (`SECURITY.md` Section 3) and a correctness boundary (keeps the system's actions auditable and deterministic outside of the analysis step itself).

## 6. Reducing False Positives / Hallucination Risk

- Every AI finding must reference specific evidence (a screenshot region or DOM excerpt) it was derived from — findings with no groundable evidence are discarded before reaching the user, not surfaced with a disclaimer.
- Where a deterministic check and an AI finding overlap (e.g., both flag the same button), the Aggregation Module dedupes in favor of the deterministic finding — AI should not be allowed to "re-discover" and duplicate what a rule already caught with more precision.
- No AI finding is presented without its confidence tier visible in the UI (`UI_SPEC.md` Section 2/3) — the user should never have to guess whether something is a verified fact or a model's opinion.

## 7. What AI Should Not Be Trusted For (explicit non-uses)

- Assigning final severity unilaterally (Section 5)
- Determining WCAG conformance pass/fail where a deterministic check exists (contrast, alt text, etc.) — AI may *explain* a deterministic failure in plain language, but does not decide it
- Any action beyond returning findings (no auto-fixing, no direct database writes, no triggering external calls)
- Serving as the sole source of truth for anything the PRD or this document has designated deterministic

## 8. Cost Awareness

- AI calls are the primary per-audit cost driver (per `TRD.md` Section 5, decision #8). The input constraints in Section 4 (curated excerpts, not full DOM) exist as much for cost control as for injection resistance.
- Before Phase 2 scaling decisions, actual per-audit AI cost should be measured against real audits, not estimated in the abstract — this affects rate limiting design in `SECURITY.md` Section 5.
