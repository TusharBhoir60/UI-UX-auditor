import { Injectable } from '@nestjs/common';
import {
  RuleCategory,
  RuleConfidence,
  RuleEvaluationStatus,
  RuleFinding,
  RuleResult,
  RuleSeverity,
} from '../rules.types';
import { RULE_IDS } from '../rules.constants';
import { DeterministicRule, RuleEvaluationContext } from './rule.interface';

@Injectable()
export class HeadingOrderRule implements DeterministicRule {
  readonly id = RULE_IDS.HEADING_ORDER_VALID;
  readonly name = 'Heading Hierarchy and Sequence';
  readonly version = '1.0.0';
  readonly category = RuleCategory.ACCESSIBILITY;
  readonly defaultSeverity = RuleSeverity.MEDIUM;
  readonly standardReference = 'WCAG 1.3.1 (Level A)';
  readonly description =
    'Ensures headings follow a logical structural hierarchy, beginning with a top-level <h1> and avoiding skipped heading levels. Distinguishes structural hierarchy heuristics from definitive empty-heading barriers.';

  evaluate(context: RuleEvaluationContext): RuleResult {
    const { parsedDom, rawHtml } = context;

    if (!rawHtml || rawHtml.trim().length === 0 || parsedDom.isMalformed) {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        status: RuleEvaluationStatus.NOT_EVALUABLE,
        elementsEvaluatedCount: 0,
        findings: [],
        notEvaluableReason:
          'DOM snapshot is empty or malformed; heading hierarchy cannot be reliably evaluated',
      };
    }

    const findings: RuleFinding[] = [];
    const headings = parsedDom.headings;

    if (headings.length === 0) {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        status: RuleEvaluationStatus.PASS,
        elementsEvaluatedCount: 0,
        findings: [],
      };
    }

    // 1. Check if an <h1> exists (structural navigation heuristic)
    const hasH1 = headings.some((h) => h.level === 1);
    if (!hasH1) {
      findings.push({
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        severity: RuleSeverity.MEDIUM,
        confidence: RuleConfidence.DETERMINISTIC,
        title: 'Document lacks a top-level <h1> heading (structural navigation)',
        description: `The page contains section headings starting at <h${headings[0].level}>, but no top-level <h1> heading was found. A top-level <h1> establishes the primary document subject for assistive technologies.`,
        recommendation:
          'Add an <h1> heading to represent the primary title of the page before subordinate sections.',
        standardReference: `${this.standardReference} / Technique G141`,
        evidence: {
          selector: headings[0].selector,
          tagName: `h${headings[0].level}`,
          snippet: headings[0].rawSnippet,
          boundingBox: headings[0].matchingComputedStyle?.boundingBox ?? null,
          expected: 'Document contains a top-level <h1> heading',
          observed: `First heading is <h${headings[0].level}>: "${headings[0].textContent}"`,
        },
      });
    }

    // 2. Check for empty headings and skipped heading levels
    let prevLevel: number | null = null;

    for (const h of headings) {
      // Empty heading check (Definitive accessibility barrier)
      if (h.textContent.trim().length === 0) {
        findings.push({
          ruleId: this.id,
          ruleVersion: this.version,
          category: this.category,
          severity: RuleSeverity.MEDIUM,
          confidence: RuleConfidence.DETERMINISTIC,
          title: `Empty heading element <h${h.level}> (accessibility barrier)`,
          description: `The <h${h.level}> element has no text content, creating an empty landmark that screen readers cannot identify or announce.`,
          recommendation:
            'Provide descriptive heading text or remove the empty heading element.',
          standardReference: this.standardReference,
          evidence: {
            selector: h.selector,
            tagName: `h${h.level}`,
            snippet: h.rawSnippet,
            boundingBox: h.matchingComputedStyle?.boundingBox ?? null,
            expected: 'Heading contains visible descriptive text',
            observed: 'Heading is empty or contains whitespace only',
          },
        });
      }

      // Skipped level check (Structural hierarchy heuristic under WCAG 1.3.1 Advisory Technique G141)
      if (prevLevel !== null && h.level > prevLevel + 1) {
        findings.push({
          ruleId: this.id,
          ruleVersion: this.version,
          category: this.category,
          severity: RuleSeverity.LOW,
          confidence: RuleConfidence.DETERMINISTIC,
          title: `Heading level skipped (structural hierarchy): <h${prevLevel}> to <h${h.level}>`,
          description: `The heading structure jumps from <h${prevLevel}> directly to <h${h.level}> without an intervening <h${prevLevel + 1}>. Skipping heading levels is a structural navigation heuristic that may disorient screen reader users navigating by heading keys.`,
          recommendation: `Restructure heading levels sequentially so subordinate headings increase by one level (e.g., follow <h${prevLevel}> with <h${prevLevel + 1}>).`,
          standardReference: `${this.standardReference} (Advisory Technique G141)`,
          evidence: {
            selector: h.selector,
            tagName: `h${h.level}`,
            snippet: h.rawSnippet,
            boundingBox: h.matchingComputedStyle?.boundingBox ?? null,
            expected: `Sequential heading level <= <h${prevLevel + 1}>`,
            observed: `<h${h.level}> (skipped from <h${prevLevel}>)`,
          },
        });
      }

      prevLevel = h.level;
    }

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      category: this.category,
      status:
        findings.length > 0 ? RuleEvaluationStatus.FINDING : RuleEvaluationStatus.PASS,
      elementsEvaluatedCount: headings.length,
      findings,
    };
  }
}
