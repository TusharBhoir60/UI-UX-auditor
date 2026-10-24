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
    'Ensures every interactive <button> element has a verified accessible name through inner text, a valid aria-label, a resolvable aria-labelledby reference, or a non-empty title attribute.';

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

      // 1. Check aria-labelledby resolution
      let hasValidLabelledBy = false;
      let labelledByError: string | null = null;

      if (btn.ariaLabelledBy && btn.ariaLabelledBy.trim().length > 0) {
        const idTokens = btn.ariaLabelledBy.trim().split(/\s+/);
        const missingIds: string[] = [];
        const emptyIds: string[] = [];
        let combinedText = '';

        for (const id of idTokens) {
          if (!parsedDom.documentIds.has(id)) {
            missingIds.push(id);
          } else {
            const text = parsedDom.documentIds.get(id) || '';
            if (text.trim().length === 0) {
              emptyIds.push(id);
            } else {
              combinedText += ' ' + text.trim();
            }
          }
        }

        if (missingIds.length > 0) {
          labelledByError = `aria-labelledby references missing element(s): ${missingIds.map((i) => `#${i}`).join(', ')}`;
        } else if (emptyIds.length === idTokens.length && combinedText.trim().length === 0) {
          labelledByError = `aria-labelledby references element(s) with empty text: ${emptyIds.map((i) => `#${i}`).join(', ')}`;
        } else if (combinedText.trim().length > 0) {
          hasValidLabelledBy = true;
        }
      }

      // 2. Check aria-label
      const hasAriaLabel = Boolean(btn.ariaLabel && btn.ariaLabel.trim().length > 0);

      // 3. Check visible text content
      const hasVisibleText = Boolean(btn.textContent && btn.textContent.trim().length > 0);

      // 4. Check title attribute (fallback of last resort; must be non-empty)
      const hasTitle = Boolean(btn.title && btn.title.trim().length > 0);

      // If aria-labelledby was present but unresolvable, and no other accessible name source exists
      if (labelledByError && !hasAriaLabel && !hasVisibleText && !hasTitle) {
        findings.push({
          ruleId: this.id,
          ruleVersion: this.version,
          category: this.category,
          severity: this.defaultSeverity,
          confidence: RuleConfidence.DETERMINISTIC,
          title: 'Button aria-labelledby reference cannot be resolved',
          description: `The <button> specifies aria-labelledby="${btn.ariaLabelledBy}", but ${labelledByError}. Screen readers cannot compute an accessible name from an unresolved or empty reference.`,
          recommendation:
            'Ensure the element referenced by aria-labelledby exists in the document and contains descriptive text, or provide a direct aria-label on the button.',
          standardReference: this.standardReference,
          evidence: {
            selector: btn.selector,
            tagName: 'button',
            snippet: btn.rawSnippet,
            boundingBox: btn.matchingComputedStyle?.boundingBox ?? null,
            expected: 'All IDs in aria-labelledby exist in DOM with non-empty text content',
            observed: labelledByError,
            attributes: {
              ...(btn.ariaLabelledBy ? { 'aria-labelledby': btn.ariaLabelledBy } : {}),
              ...(btn.id ? { id: btn.id } : {}),
            },
          },
        });
        continue;
      }

      // Check if button lacks an accessible name entirely
      if (!hasValidLabelledBy && !hasAriaLabel && !hasVisibleText && !hasTitle) {
        findings.push({
          ruleId: this.id,
          ruleVersion: this.version,
          category: this.category,
          severity: this.defaultSeverity,
          confidence: RuleConfidence.DETERMINISTIC,
          title: 'Button lacks an accessible name',
          description:
            'The <button> element has no visible text content, valid aria-label, resolvable aria-labelledby reference, or title attribute. Screen readers cannot announce the purpose or action of the control.',
          recommendation:
            'Add descriptive text inside the button or provide an aria-label describing its specific action.',
          standardReference: this.standardReference,
          evidence: {
            selector: btn.selector,
            tagName: 'button',
            snippet: btn.rawSnippet,
            boundingBox: btn.matchingComputedStyle?.boundingBox ?? null,
            expected: 'Accessible name via inner text, aria-label, resolvable aria-labelledby, or non-empty title',
            observed: 'No accessible name found (empty text, no valid label attributes)',
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
