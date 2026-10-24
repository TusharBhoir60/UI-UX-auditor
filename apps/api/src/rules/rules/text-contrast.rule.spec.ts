import { TextContrastRule } from './text-contrast.rule';
import { RuleEvaluationStatus, RuleSeverity } from '../rules.types';
import { ElementComputedStyle } from '../../capture/capture.types';
import { extractDomEvidence } from '../dom/dom-extractor';

describe('TextContrastRule', () => {
  let rule: TextContrastRule;

  beforeEach(() => {
    rule = new TextContrastRule();
  });

  it('passes when text contrast exceeds 4.5:1 for standard text', () => {
    const computedStyles: ElementComputedStyle[] = [
      {
        selector: 'p.body-text',
        tagName: 'p',
        boundingBox: { x: 0, y: 0, width: 300, height: 40 },
        styles: {
          color: 'rgb(0, 0, 0)', // Black
          backgroundColor: 'rgb(255, 255, 255)', // White -> 21:1
          fontSize: '16px',
          fontWeight: '400',
          lineHeight: '24px',
          display: 'block',
          visibility: 'visible',
          margin: '',
          padding: '',
        },
        textSnippet: 'Accessible body text with clear contrast',
      },
    ];

    const result = rule.evaluate({
      parsedDom: extractDomEvidence('<html><body></body></html>'),
      computedStyles,
      rawHtml: '<html><body></body></html>',
    });

    expect(result.status).toBe(RuleEvaluationStatus.PASS);
    expect(result.findings).toHaveLength(0);
    expect(result.elementsEvaluatedCount).toBe(1);
  });

  it('flags High finding when contrast is below 4.5:1 for standard text', () => {
    const computedStyles: ElementComputedStyle[] = [
      {
        selector: 'span.subtle-label',
        tagName: 'span',
        boundingBox: { x: 0, y: 0, width: 100, height: 20 },
        styles: {
          color: 'rgb(170, 170, 170)', // Light gray (#aaa)
          backgroundColor: 'rgb(255, 255, 255)', // White -> ~2.32:1
          fontSize: '14px',
          fontWeight: '400',
          lineHeight: '20px',
          display: 'inline',
          visibility: 'visible',
          margin: '',
          padding: '',
        },
        textSnippet: 'Low contrast hint text',
      },
    ];

    const result = rule.evaluate({
      parsedDom: extractDomEvidence('<html><body></body></html>'),
      computedStyles,
      rawHtml: '<html><body></body></html>',
    });

    expect(result.status).toBe(RuleEvaluationStatus.FINDING);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe(RuleSeverity.HIGH);
    expect(result.findings[0].title).toContain('Insufficient text contrast ratio');
    expect(result.findings[0].evidence.expected).toBe('>= 4.5:1 contrast ratio');
    expect(result.findings[0].evidence.observed).toContain('2.32:1');
  });

  it('allows 3.0:1 threshold for large text (>= 24px)', () => {
    // 3.5:1 is >= 3.0:1 but < 4.5:1
    // Color #767676 on white is ~4.54:1; let's pick #888888 on white which is ~3.54:1
    const computedStyles: ElementComputedStyle[] = [
      {
        selector: 'h1.large-hero',
        tagName: 'h1',
        boundingBox: { x: 0, y: 0, width: 400, height: 60 },
        styles: {
          color: 'rgb(136, 136, 136)', // #888
          backgroundColor: 'rgb(255, 255, 255)', // White -> ~3.54:1
          fontSize: '28px', // Large text
          fontWeight: '400',
          lineHeight: '36px',
          display: 'block',
          visibility: 'visible',
          margin: '',
          padding: '',
        },
        textSnippet: 'Large hero banner text',
      },
    ];

    const result = rule.evaluate({
      parsedDom: extractDomEvidence('<html><body></body></html>'),
      computedStyles,
      rawHtml: '<html><body></body></html>',
    });

    // 3.54:1 is >= 3.0:1 so it passes for large text
    expect(result.status).toBe(RuleEvaluationStatus.PASS);
    expect(result.findings).toHaveLength(0);
  });

  it('returns not-evaluable when background color is transparent or ambiguous', () => {
    const computedStyles: ElementComputedStyle[] = [
      {
        selector: 'p.transparent-bg',
        tagName: 'p',
        boundingBox: { x: 0, y: 0, width: 100, height: 20 },
        styles: {
          color: 'rgb(0, 0, 0)',
          backgroundColor: 'rgba(0, 0, 0, 0)', // Transparent
          fontSize: '16px',
          fontWeight: '400',
          lineHeight: '24px',
          display: 'block',
          visibility: 'visible',
          margin: '',
          padding: '',
        },
        textSnippet: 'Text on transparent background',
      },
    ];

    const result = rule.evaluate({
      parsedDom: extractDomEvidence('<html><body></body></html>'),
      computedStyles,
      rawHtml: '<html><body></body></html>',
    });

    expect(result.status).toBe(RuleEvaluationStatus.NOT_EVALUABLE);
    expect(result.notEvaluableReason).toContain('Effective background or foreground color cannot be deterministically resolved');
  });

  it('returns not-evaluable when no computed styles are provided', () => {
    const result = rule.evaluate({
      parsedDom: extractDomEvidence('<html><body></body></html>'),
      computedStyles: [],
      rawHtml: '<html><body></body></html>',
    });

    expect(result.status).toBe(RuleEvaluationStatus.NOT_EVALUABLE);
    expect(result.notEvaluableReason).toContain('No computed styles');
  });
});
