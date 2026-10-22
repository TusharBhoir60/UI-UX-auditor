import { Injectable, Logger } from '@nestjs/common';
import {
  RuleEngineResult,
  RuleEvaluationStatus,
  RuleEvidenceInput,
  RuleFinding,
  RuleResult,
} from './rules.types';
import { DeterministicRule, RuleEvaluationContext } from './rules/rule.interface';
import { extractDomEvidence } from './dom/dom-extractor';
import { DocTitlePresentRule } from './rules/doc-title-present.rule';
import { ImgAltPresentRule } from './rules/img-alt-present.rule';
import { ButtonNamePresentRule } from './rules/button-name-present.rule';
import { HeadingOrderRule } from './rules/heading-order.rule';
import { TextContrastRule } from './rules/text-contrast.rule';

@Injectable()
export class RuleEngineService {
  private readonly logger = new Logger(RuleEngineService.name);
  private readonly rules: DeterministicRule[];

  constructor(
    docTitleRule: DocTitlePresentRule,
    imgAltRule: ImgAltPresentRule,
    buttonNameRule: ButtonNamePresentRule,
    headingOrderRule: HeadingOrderRule,
    textContrastRule: TextContrastRule,
  ) {
    this.rules = [
      docTitleRule,
      imgAltRule,
      buttonNameRule,
      headingOrderRule,
      textContrastRule,
    ];
  }

  /**
   * Returns registered deterministic rules.
   */
  getRegisteredRules(): readonly DeterministicRule[] {
    return this.rules;
  }

  /**
   * Evaluates captured page artifacts against all registered deterministic rules.
   *
   * CONTRACT GUARANTEES:
   * 1. Does not mutate the input evidence.
   * 2. Evaluates evidence safely without executing embedded scripts.
   * 3. Isolated error handling: a failure in one rule does not abort remaining rules.
   * 4. Completely deterministic: identical inputs yield identical outputs.
   */
  async evaluate(evidence: RuleEvidenceInput): Promise<RuleEngineResult> {
    const startTime = Date.now();
    const evaluatedAt = new Date().toISOString();

    const domSnapshot = typeof evidence?.domSnapshot === 'string' ? evidence.domSnapshot : '';
    const computedStyles = Array.isArray(evidence?.computedStyles)
      ? [...evidence.computedStyles]
      : [];

    // Safely extract DOM elements and attributes without evaluating scripts
    const parsedDom = extractDomEvidence(domSnapshot, computedStyles);

    const context: RuleEvaluationContext = {
      parsedDom,
      computedStyles,
      url: evidence?.url,
      rawHtml: domSnapshot,
    };

    const results: RuleResult[] = [];
    const allFindings: RuleFinding[] = [];

    for (const rule of this.rules) {
      try {
        const result = await rule.evaluate(context);
        results.push(result);
        if (result.findings && result.findings.length > 0) {
          allFindings.push(...result.findings);
        }
      } catch (err) {
        const safeReason = err instanceof Error ? err.message : 'Unknown evaluation error';
        this.logger.error(`Rule ${rule.id} evaluation failed unexpectedly: ${safeReason}`);

        results.push({
          ruleId: rule.id,
          ruleVersion: rule.version,
          category: rule.category,
          status: RuleEvaluationStatus.NOT_EVALUABLE,
          elementsEvaluatedCount: 0,
          findings: [],
          notEvaluableReason: `Rule evaluation encountered an unexpected error: ${safeReason}`,
        });
      }
    }

    const passedRulesCount = results.filter(
      (r) => r.status === RuleEvaluationStatus.PASS,
    ).length;
    const findingRulesCount = results.filter(
      (r) => r.status === RuleEvaluationStatus.FINDING,
    ).length;
    const notEvaluableRulesCount = results.filter(
      (r) => r.status === RuleEvaluationStatus.NOT_EVALUABLE,
    ).length;

    const durationMs = Date.now() - startTime;

    return {
      evaluatedAt,
      durationMs,
      rulesEvaluatedCount: this.rules.length,
      passedRulesCount,
      findingRulesCount,
      notEvaluableRulesCount,
      totalFindingsCount: allFindings.length,
      results,
      findings: allFindings,
    };
  }
}
