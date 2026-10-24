import { ElementComputedStyle } from '../../capture/capture.types';
import { ParsedDomDocument } from '../dom/dom-extractor';
import { RuleCategory, RuleResult, RuleSeverity } from '../rules.types';

/**
 * Context provided to each rule during evaluation.
 */
export interface RuleEvaluationContext {
  parsedDom: ParsedDomDocument;
  computedStyles: ElementComputedStyle[];
  url?: string;
  rawHtml: string;
}

/**
 * Formal interface for all deterministic rules.
 */
export interface DeterministicRule {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly category: RuleCategory;
  readonly defaultSeverity: RuleSeverity;
  readonly standardReference?: string;
  readonly description: string;

  evaluate(context: RuleEvaluationContext): Promise<RuleResult> | RuleResult;
}
