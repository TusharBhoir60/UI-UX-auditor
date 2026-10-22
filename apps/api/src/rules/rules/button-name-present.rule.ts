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
export class ButtonNamePresentRule implements DeterministicRule {
  readonly id = RULE_IDS.BUTTON_NAME_PRESENT;
  readonly name = 'Button Accessible Name';
  readonly version = '1.0.0';
  readonly category = RuleCategory.ACCESSIBILITY;
  readonly defaultSeverity = RuleSeverity.CRITICAL;
  readonly standardReference = 'WCAG 4.1.2 (Level A)';
  readonly description =
    'Ensures every interactive <button> element has an accessible name through visible text, an aria-label, aria-labelledby, or title attribute.';

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
          'DOM snapshot is empty or malformed; button elements cannot be reliably evaluated',
      };
    }

    const findings: RuleFinding[] = [];
    const buttons = parsedDom.buttons;

    for (const btn of buttons) {
      // Hidden from accessibility tree
      if (btn.ariaHidden === true) {
        continue;
      }

      const hasText = btn.textContent && btn.textContent.trim().length > 0;
      const hasAriaLabel = btn.ariaLabel && btn.ariaLabel.trim().length > 0;
      const hasAriaLabelledBy =
        btn.ariaLabelledBy && btn.ariaLabelledBy.trim().length > 0;
      const hasTitle = btn.title && btn.title.trim().length > 0;

      if (!hasText && !hasAriaLabel && !hasAriaLabelledBy && !hasTitle) {
        findings.push({
          ruleId: this.id,
          ruleVersion: this.version,
          category: this.category,
          severity: this.defaultSeverity,
          confidence: RuleConfidence.DETERMINISTIC,
          title: 'Button lacks an accessible name',
          description:
            'The <button> element has no visible text content, aria-label, aria-labelledby, or title attribute. Screen reader users cannot determine the button action or purpose.',
          recommendation:
            'Add meaningful text content inside the button or provide an aria-label describing its specific action.',
          standardReference: this.standardReference,
          evidence: {
            selector: btn.selector,
            tagName: 'button',
            snippet: btn.rawSnippet,
            boundingBox: btn.matchingComputedStyle?.boundingBox ?? null,
            expected: 'Accessible name via inner text, aria-label, aria-labelledby, or title attribute',
            observed: 'No accessible name found (empty text and no accessible label attributes)',
            attributes: {
              ...(btn.type ? { type: btn.type } : {}),
              ...(btn.id ? { id: btn.id } : {}),
            },
          },
        });
      }
    }

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      category: this.category,
      status:
        findings.length > 0 ? RuleEvaluationStatus.FINDING : RuleEvaluationStatus.PASS,
      elementsEvaluatedCount: buttons.length,
      findings,
    };
  }
}
