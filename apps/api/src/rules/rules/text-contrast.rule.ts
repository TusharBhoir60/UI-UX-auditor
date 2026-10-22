import { Injectable } from '@nestjs/common';
import {
  RuleCategory,
  RuleConfidence,
  RuleEvaluationStatus,
  RuleFinding,
  RuleResult,
  RuleSeverity,
} from '../rules.types';
import { RULE_CONSTANTS, RULE_IDS } from '../rules.constants';
import { DeterministicRule, RuleEvaluationContext } from './rule.interface';
import {
  getContrastRatio,
  getRelativeLuminance,
  parseCssColor,
} from '../dom/color-math';

@Injectable()
export class TextContrastRule implements DeterministicRule {
  readonly id = RULE_IDS.TEXT_CONTRAST_MINIMUM;
  readonly name = 'Text Contrast Minimum';
  readonly version = '1.0.0';
  readonly category = RuleCategory.ACCESSIBILITY;
  readonly defaultSeverity = RuleSeverity.HIGH;
  readonly standardReference = 'WCAG 1.4.3 (Level AA)';
  readonly description =
    'Ensures text elements provide sufficient color contrast against their rendered background (minimum 4.5:1 for standard text, 3.0:1 for large text). When background color is transparent or ambiguous, reports not-evaluable to prevent false positives.';

  evaluate(context: RuleEvaluationContext): RuleResult {
    const { computedStyles } = context;

    if (!computedStyles || computedStyles.length === 0) {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        status: RuleEvaluationStatus.NOT_EVALUABLE,
        elementsEvaluatedCount: 0,
        findings: [],
        notEvaluableReason:
          'No computed styles were captured; text contrast cannot be evaluated',
      };
    }

    const findings: RuleFinding[] = [];
    let evaluableCount = 0;
    let ambiguousCount = 0;

    for (const cs of computedStyles) {
      // Only evaluate visible elements with actual text
      if (
        !cs.textSnippet ||
        cs.textSnippet.trim().length === 0 ||
        cs.styles.display === 'none' ||
        cs.styles.visibility === 'hidden'
      ) {
        continue;
      }

      const fgColor = parseCssColor(cs.styles.color);
      const bgColor = parseCssColor(cs.styles.backgroundColor);

      // Check for transparent or ambiguous background colors
      if (!fgColor || !bgColor || bgColor.a < 0.99) {
        ambiguousCount++;
        continue;
      }

      evaluableCount++;

      const l1 = getRelativeLuminance(fgColor.r, fgColor.g, fgColor.b);
      const l2 = getRelativeLuminance(bgColor.r, bgColor.g, bgColor.b);
      const ratio = getContrastRatio(l1, l2);

      // Determine if large text: >= 24px (18pt) or >= 18.66px (14pt) with bold weight
      const fontSizePx = parseFloat(cs.styles.fontSize) || 16;
      const fontWeightNum = parseInt(cs.styles.fontWeight, 10) || 400;
      const isBold =
        fontWeightNum >= RULE_CONSTANTS.BOLD_FONT_WEIGHT_MIN ||
        cs.styles.fontWeight === 'bold';
      const isLargeText =
        fontSizePx >= RULE_CONSTANTS.LARGE_TEXT_MIN_PX ||
        (fontSizePx >= RULE_CONSTANTS.LARGE_TEXT_BOLD_MIN_PX && isBold);

      const requiredThreshold = isLargeText
        ? RULE_CONSTANTS.WCAG_CONTRAST_LARGE_TEXT
        : RULE_CONSTANTS.WCAG_CONTRAST_NORMAL_TEXT;

      if (ratio < requiredThreshold) {
        findings.push({
          ruleId: this.id,
          ruleVersion: this.version,
          category: this.category,
          severity: this.defaultSeverity,
          confidence: RuleConfidence.DETERMINISTIC,
          title: `Insufficient text contrast ratio (${ratio.toFixed(2)}:1)`,
          description: `The text element has a contrast ratio of ${ratio.toFixed(2)}:1 against its background, which fails the WCAG minimum threshold of ${requiredThreshold}:1 for ${isLargeText ? 'large' : 'standard'} text.`,
          recommendation: `Increase the contrast between foreground (${cs.styles.color}) and background (${cs.styles.backgroundColor}) to at least ${requiredThreshold}:1.`,
          standardReference: this.standardReference,
          evidence: {
            selector: cs.selector,
            tagName: cs.tagName,
            snippet: cs.textSnippet,
            boundingBox: cs.boundingBox,
            expected: `>= ${requiredThreshold}:1 contrast ratio`,
            observed: `${ratio.toFixed(2)}:1 (fg: ${cs.styles.color}, bg: ${cs.styles.backgroundColor})`,
            attributes: {
              color: cs.styles.color,
              backgroundColor: cs.styles.backgroundColor,
              fontSize: cs.styles.fontSize,
              fontWeight: cs.styles.fontWeight,
            },
          },
        });
      }
    }

    // If no elements had explicit opaque backgrounds, report not-evaluable instead of false pass
    if (evaluableCount === 0) {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        status: RuleEvaluationStatus.NOT_EVALUABLE,
        elementsEvaluatedCount: 0,
        findings: [],
        notEvaluableReason:
          ambiguousCount > 0
            ? 'Effective background color cannot be deterministically resolved from captured styles (transparent or inherited background detected; requires DOM parent background inheritance or screenshot pixel sampling)'
            : 'No text elements with computed styles found to evaluate',
      };
    }

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      category: this.category,
      status:
        findings.length > 0 ? RuleEvaluationStatus.FINDING : RuleEvaluationStatus.PASS,
      elementsEvaluatedCount: evaluableCount,
      findings,
    };
  }
}
