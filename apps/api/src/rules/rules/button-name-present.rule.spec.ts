import { ButtonNamePresentRule } from './button-name-present.rule';
import { RuleEvaluationStatus, RuleSeverity } from '../rules.types';
import { extractDomEvidence } from '../dom/dom-extractor';
import { ElementComputedStyle } from '../../capture/capture.types';

describe('ButtonNamePresentRule', () => {
  let rule: ButtonNamePresentRule;

  beforeEach(() => {
    rule = new ButtonNamePresentRule();
  });

  it('passes when button has visible text content', () => {
    const html = '<html><body><button type="submit">Submit Order</button></body></html>';
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

  it('passes when icon button has aria-label', () => {
    const html = '<html><body><button aria-label="Close dialog"><svg></svg></button></body></html>';
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.PASS);
    expect(result.findings).toHaveLength(0);
  });

  it('passes when aria-labelledby resolves to an existing element with non-empty text', () => {
    const html = `
      <html><body>
        <span id="label-save">Save Changes</span>
        <button aria-labelledby="label-save"><svg></svg></button>
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
  });

  it('flags Critical finding when aria-labelledby references a non-existent element', () => {
    const html = '<html><body><button aria-labelledby="non-existent-id"><svg></svg></button></body></html>';
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.FINDING);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe('Button aria-labelledby reference cannot be resolved');
    expect(result.findings[0].evidence.observed).toContain('missing element(s): #non-existent-id');
  });

  it('flags Critical finding when aria-labelledby references an element with empty text', () => {
    const html = `
      <html><body>
        <span id="empty-label">   </span>
        <button aria-labelledby="empty-label"><svg></svg></button>
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
    expect(result.findings[0].title).toBe('Button aria-labelledby reference cannot be resolved');
    expect(result.findings[0].evidence.observed).toContain('empty text: #empty-label');
  });

  it('passes when title attribute provides non-empty fallback accessible name', () => {
    const html = '<html><body><button title="Settings"><svg></svg></button></body></html>';
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.PASS);
    expect(result.findings).toHaveLength(0);
  });

  it('flags Critical finding when title attribute is whitespace only', () => {
    const html = '<html><body><button title="   "><svg></svg></button></body></html>';
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.FINDING);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe('Button lacks an accessible name');
  });

  it('skips hidden buttons with aria-hidden="true"', () => {
    const html = '<html><body><button aria-hidden="true"></button></body></html>';
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.PASS);
    expect(result.findings).toHaveLength(0);
  });

  it('flags Critical finding when button has no accessible name', () => {
    const computedStyles: ElementComputedStyle[] = [
      {
        selector: 'button#icon-btn',
        tagName: 'button',
        boundingBox: { x: 10, y: 15, width: 32, height: 32 },
        styles: {
          color: '',
          backgroundColor: '',
          fontSize: '',
          fontWeight: '',
          lineHeight: '',
          display: 'inline-block',
          visibility: 'visible',
          margin: '',
          padding: '',
        },
      },
    ];

    const html = '<html><body><button id="icon-btn" class="icon-only"><svg></svg></button></body></html>';
    const parsedDom = extractDomEvidence(html, computedStyles);
    const result = rule.evaluate({
      parsedDom,
      computedStyles,
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.FINDING);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe(RuleSeverity.CRITICAL);
    expect(result.findings[0].title).toBe('Button lacks an accessible name');
    expect(result.findings[0].evidence.selector).toBe('button#icon-btn');
    expect(result.findings[0].evidence.boundingBox).toEqual({
      x: 10,
      y: 15,
      width: 32,
      height: 32,
    });
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
