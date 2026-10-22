import { ElementComputedStyle } from '../capture/capture.types';

/**
 * Standard issue/rule categories matching DATA_MODEL.md and AI_RULES.md.
 */
export enum RuleCategory {
  ACCESSIBILITY = 'accessibility',
  VISUAL = 'visual',
  USABILITY = 'usability',
}

/**
 * Standard severity tiers matching DATA_MODEL.md.
 */
export enum RuleSeverity {
  CRITICAL = 'Critical',
  HIGH = 'High',
  MEDIUM = 'Medium',
  LOW = 'Low',
}

/**
 * Confidence level. For the deterministic engine, this is always 'deterministic'.
 */
export enum RuleConfidence {
  DETERMINISTIC = 'deterministic',
}

/**
 * Deterministic outcome status for an evaluated rule.
 */
export enum RuleEvaluationStatus {
  PASS = 'pass',
  FINDING = 'finding',
  NOT_EVALUABLE = 'not-evaluable',
}

/**
 * Grounded evidence reference tied to captured DOM elements or computed styles.
 */
export interface RuleFindingEvidence {
  selector?: string;
  tagName?: string;
  snippet?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  expected?: string;
  observed?: string;
  attributes?: Record<string, string>;
}

/**
 * A discrete finding produced by a deterministic rule.
 */
export interface RuleFinding {
  ruleId: string;
  ruleVersion: string;
  category: RuleCategory;
  severity: RuleSeverity;
  confidence: RuleConfidence;
  title: string;
  description: string;
  recommendation: string;
  standardReference?: string;
  evidence: RuleFindingEvidence;
}

/**
 * Outcome of evaluating an individual rule over captured evidence.
 */
export interface RuleResult {
  ruleId: string;
  ruleVersion: string;
  category: RuleCategory;
  status: RuleEvaluationStatus;
  elementsEvaluatedCount: number;
  findings: RuleFinding[];
  notEvaluableReason?: string;
}

/**
 * Input contract provided to the rule engine.
 */
export interface RuleEvidenceInput {
  domSnapshot: string;
  computedStyles?: ElementComputedStyle[];
  url?: string;
}

/**
 * Aggregated execution outcome across all registered deterministic rules.
 */
export interface RuleEngineResult {
  evaluatedAt: string;
  durationMs: number;
  rulesEvaluatedCount: number;
  passedRulesCount: number;
  findingRulesCount: number;
  notEvaluableRulesCount: number;
  totalFindingsCount: number;
  results: RuleResult[];
  findings: RuleFinding[];
}
