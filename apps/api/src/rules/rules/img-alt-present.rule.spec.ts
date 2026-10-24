import { ImgAltPresentRule } from './img-alt-present.rule';
import { RuleEvaluationStatus, RuleSeverity } from '../rules.types';
import { extractDomEvidence } from '../dom/dom-extractor';
import { ElementComputedStyle } from '../../capture/capture.types';

describe('ImgAltPresentRule', () => {
  let rule: ImgAltPresentRule;

  beforeEach(() => {
    rule = new ImgAltPresentRule();
  });

  it('passes when all images have descriptive alt text', () => {
    const html = '<html><body><img src="chart.png" alt="Sales growth bar chart"></body></html>';
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

  it('passes when image is explicitly decorative with alt=""', () => {
    const html = '<html><body><img src="decoration.svg" alt=""></body></html>';
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.PASS);
    expect(result.findings).toHaveLength(0);
  });

  it('passes when image has role="presentation" or aria-hidden="true"', () => {
    const html = `
      <html><body>
        <img src="bg1.png" role="presentation">
        <img src="bg2.png" aria-hidden="true">
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

  it('flags Critical finding when alt attribute is completely absent', () => {
    const computedStyles: ElementComputedStyle[] = [
      {
        selector: 'img#user-avatar',
        tagName: 'img',
        boundingBox: { x: 50, y: 100, width: 40, height: 40 },
        styles: {
          color: '',
          backgroundColor: '',
          fontSize: '',
          fontWeight: '',
          lineHeight: '',
          display: 'block',
          visibility: 'visible',
          margin: '',
          padding: '',
        },
      },
    ];

    const html = '<html><body><img src="avatar.jpg" id="user-avatar"></body></html>';
    const parsedDom = extractDomEvidence(html, computedStyles);
    const result = rule.evaluate({
      parsedDom,
      computedStyles,
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.FINDING);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe(RuleSeverity.CRITICAL);
    expect(result.findings[0].title).toBe('Image missing alternative text (alt attribute)');
    expect(result.findings[0].evidence.selector).toBe('img#user-avatar');
    expect(result.findings[0].evidence.boundingBox).toEqual({
      x: 50,
      y: 100,
      width: 40,
      height: 40,
    });
  });

  it('flags High finding when alt attribute contains only whitespace', () => {
    const html = '<html><body><img src="photo.jpg" alt="   "></body></html>';
    const parsedDom = extractDomEvidence(html);
    const result = rule.evaluate({
      parsedDom,
      computedStyles: [],
      rawHtml: html,
    });

    expect(result.status).toBe(RuleEvaluationStatus.FINDING);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe(RuleSeverity.HIGH);
    expect(result.findings[0].title).toBe('Image alt attribute contains only whitespace');
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
