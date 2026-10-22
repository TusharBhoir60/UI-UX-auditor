import { DocTitlePresentRule } from './doc-title-present.rule';
import { RuleEvaluationStatus, RuleSeverity } from '../rules.types';
import { extractDomEvidence } from '../dom/dom-extractor';

describe('DocTitlePresentRule', () => {
  let rule: DocTitlePresentRule;

  beforeEach(() => {
    rule = new DocTitlePresentRule();
  });

  it('passes when non-empty <title> exists', () => {
    const html = '<html><head><title>Accessible Dashboard</title></head></html>';
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.PASS);
    expect(result.findings).toHaveLength(0);
    expect(result.elementsEvaluatedCount).toBe(1);
  });

  it('flags finding when <title> tag is missing', () => {
    const html = '<html><head></head><body><h1>Hello</h1></body></html>';
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.FINDING);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe('Document lacks a <title> element');
    expect(result.findings[0].severity).toBe(RuleSeverity.MEDIUM);
    expect(result.findings[0].evidence.expected).toBe('Non-empty <title> element in <head>');
    expect(result.findings[0].evidence.observed).toBe('No <title> element found in document');
  });

  it('flags finding when <title> tag exists but is empty or whitespace only', () => {
    const html = '<html><head><title>   </title></head></html>';
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.FINDING);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe('Document <title> element is empty');
  });

  it('returns not-evaluable when DOM snapshot is empty or malformed', () => {
    const html = '';
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.NOT_EVALUABLE);
    expect(result.notEvaluableReason).toContain('empty or malformed');
  });
});
