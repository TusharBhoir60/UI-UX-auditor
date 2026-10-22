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
export class DocTitlePresentRule implements DeterministicRule {
  readonly id = RULE_IDS.DOC_TITLE_PRESENT;
  readonly name = 'Document Title Presence';
  readonly version = '1.0.0';
  readonly category = RuleCategory.ACCESSIBILITY;
  readonly defaultSeverity = RuleSeverity.MEDIUM;
  readonly standardReference = 'WCAG 2.4.2 (Level A)';
  readonly description =
    'Ensures the webpage has a non-empty <title> element in the document head to identify the page to assistive technologies and tabbed browsers.';

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
          'DOM snapshot is empty or malformed; document title cannot be reliably verified',
      };
    }

    const findings: RuleFinding[] = [];

    if (!parsedDom.hasTitleTag) {
      findings.push({
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        severity: this.defaultSeverity,
        confidence: RuleConfidence.DETERMINISTIC,
        title: 'Document lacks a <title> element',
        description:
          'No <title> tag was found in the document. Page titles allow users of screen readers to orient themselves when switching tabs or navigating search results.',
        recommendation: 'Add a descriptive <title> tag within the <head> of the document.',
        standardReference: this.standardReference,
        evidence: {
          selector: 'head > title',
          tagName: 'title',
          expected: 'Non-empty <title> element in <head>',
          observed: 'No <title> element found in document',
        },
      });
    } else if (!parsedDom.title || parsedDom.title.trim().length === 0) {
      findings.push({
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        severity: this.defaultSeverity,
        confidence: RuleConfidence.DETERMINISTIC,
        title: 'Document <title> element is empty',
        description:
          'A <title> tag exists but contains only whitespace or empty text, providing no descriptive label for assistive technologies.',
        recommendation:
          'Populate the <title> tag with concise, descriptive text identifying the webpage content or purpose.',
        standardReference: this.standardReference,
        evidence: {
          selector: 'head > title',
          tagName: 'title',
          snippet: '<title></title>',
          expected: 'Descriptive, non-empty text in <title>',
          observed: `Empty title text: "${parsedDom.title ?? ''}"`,
        },
      });
    }

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      category: this.category,
      status:
        findings.length > 0 ? RuleEvaluationStatus.FINDING : RuleEvaluationStatus.PASS,
      elementsEvaluatedCount: parsedDom.hasTitleTag ? 1 : 0,
      findings,
    };
  }
}
