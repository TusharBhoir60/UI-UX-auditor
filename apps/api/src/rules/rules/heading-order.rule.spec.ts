import { HeadingOrderRule } from './heading-order.rule';
import { RuleEvaluationStatus, RuleSeverity } from '../rules.types';
import { extractDomEvidence } from '../dom/dom-extractor';

describe('HeadingOrderRule', () => {
  let rule: HeadingOrderRule;

  beforeEach(() => {
    rule = new HeadingOrderRule();
  });

  it('passes when headings follow logical hierarchical order', () => {
    const html = `
      <html><body>
        <h1>Primary Heading</h1>
        <h2>Section Heading</h2>
        <h3>Subsection Heading</h3>
        <h2>Second Section</h2>
      </body></html>
    `;
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.PASS);
    expect(result.findings).toHaveLength(0);
    expect(result.elementsEvaluatedCount).toBe(4);
  });

  it('passes when page has no headings', () => {
    const html = '<html><body><p>Plain text page without headings</p></body></html>';
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.PASS);
    expect(result.findings).toHaveLength(0);
    expect(result.elementsEvaluatedCount).toBe(0);
  });

  it('flags finding when page has headings but lacks top-level <h1>', () => {
    const html = `
      <html><body>
        <h2>First Section</h2>
        <h3>Subsection</h3>
      </body></html>
    `;
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.FINDING);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe('Document lacks a top-level <h1> heading');
    expect(result.findings[0].severity).toBe(RuleSeverity.MEDIUM);
  });

  it('flags finding when heading level is skipped (e.g. h1 to h3)', () => {
    const html = `
      <html><body>
        <h1>Main Title</h1>
        <h3>Skipped Directly to Subtitle</h3>
      </body></html>
    `;
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.FINDING);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe('Heading level skipped: <h1> to <h3>');
    expect(result.findings[0].evidence.expected).toBe('Heading level <= <h2>');
    expect(result.findings[0].evidence.observed).toBe('<h3> (skipped from <h1>)');
  });

  it('flags finding when heading is empty', () => {
    const html = `
      <html><body>
        <h1>Valid Title</h1>
        <h2></h2>
      </body></html>
    `;
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.FINDING);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe('Empty heading element <h2>');
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
  });
});
