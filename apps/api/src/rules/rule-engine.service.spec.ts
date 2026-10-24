import { Test, TestingModule } from '@nestjs/testing';
import { RuleEngineService } from './rule-engine.service';
import { RulesModule } from './rules.module';
import { RuleEvidenceInput, RuleEvaluationStatus } from './rules.types';
import { ElementComputedStyle } from '../capture/capture.types';
import { DocTitlePresentRule } from './rules/doc-title-present.rule';
import { ImgAltPresentRule } from './rules/img-alt-present.rule';
import { ButtonNamePresentRule } from './rules/button-name-present.rule';
import { HeadingOrderRule } from './rules/heading-order.rule';
import { TextContrastRule } from './rules/text-contrast.rule';

describe('RuleEngineService', () => {
  let service: RuleEngineService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [RulesModule],
    }).compile();

    service = module.get<RuleEngineService>(RuleEngineService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('resolves RuleEngineService and registers all 5 initial deterministic rules', () => {
    expect(service).toBeDefined();
    expect(service.getRegisteredRules()).toHaveLength(5);
  });

  it('evaluates a complete accessible page with 0 findings', async () => {
    const input: RuleEvidenceInput = {
      domSnapshot: `
        <!DOCTYPE html>
        <html>
          <head><title>Accessible Home</title></head>
          <body>
            <h1>Main Title</h1>
            <h2>Section One</h2>
            <p>Welcome to our accessible site.</p>
            <img src="logo.png" alt="Company Logo" id="logo">
            <button id="cta-btn" type="button">Explore Products</button>
          </body>
        </html>
      `,
      computedStyles: [
        {
          selector: 'p:nth-of-type(1)',
          tagName: 'p',
          boundingBox: { x: 0, y: 0, width: 200, height: 30 },
          styles: {
            color: 'rgb(0, 0, 0)',
            backgroundColor: 'rgb(255, 255, 255)',
            fontSize: '16px',
            fontWeight: '400',
            lineHeight: '24px',
            display: 'block',
            visibility: 'visible',
            margin: '',
            padding: '',
          },
          textSnippet: 'Welcome to our accessible site.',
        },
      ],
      url: 'https://example.com',
    };

    const result = await service.evaluate(input);

    expect(result.rulesEvaluatedCount).toBe(5);
    expect(result.passedRulesCount).toBe(5);
    expect(result.findingRulesCount).toBe(0);
    expect(result.notEvaluableRulesCount).toBe(0);
    expect(result.totalFindingsCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('evaluates a page with multiple accessibility violations and aggregates findings', async () => {
    const input: RuleEvidenceInput = {
      domSnapshot: `
        <html>
          <head></head> <!-- Missing title -->
          <body>
            <!-- Missing h1, starts at h2, skips to h4 -->
            <h2>First Section</h2>
            <h4>Skipped Subtitle</h4>
            <!-- Image without alt -->
            <img src="chart.png" id="hero-img">
            <!-- Button without accessible name -->
            <button id="icon-close"><svg></svg></button>
          </body>
        </html>
      `,
      computedStyles: [
        {
          selector: 'span.bad-contrast',
          tagName: 'span',
          boundingBox: { x: 0, y: 0, width: 100, height: 20 },
          styles: {
            color: 'rgb(180, 180, 180)',
            backgroundColor: 'rgb(255, 255, 255)', // Contrast ~2.0:1 fails 4.5:1
            fontSize: '14px',
            fontWeight: '400',
            lineHeight: '20px',
            display: 'inline',
            visibility: 'visible',
            margin: '',
            padding: '',
          },
          textSnippet: 'Very faint gray text',
        },
      ],
      url: 'https://example.com/bad',
    };

    const result = await service.evaluate(input);

    expect(result.rulesEvaluatedCount).toBe(5);
    expect(result.findingRulesCount).toBe(5); // all 5 rules find violations
    expect(result.passedRulesCount).toBe(0);
    expect(result.totalFindingsCount).toBeGreaterThanOrEqual(5);

    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain('doc-title-present');
    expect(ruleIds).toContain('img-alt-present');
    expect(ruleIds).toContain('button-name-present');
    expect(ruleIds).toContain('heading-order-valid');
    expect(ruleIds).toContain('text-contrast-minimum');
  });

  it('guarantees input artifact immutability (does not mutate inputs)', async () => {
    const originalStyles: ElementComputedStyle[] = [
      {
        selector: 'button#btn',
        tagName: 'button',
        boundingBox: { x: 10, y: 10, width: 80, height: 40 },
        styles: {
          color: 'rgb(0, 0, 0)',
          backgroundColor: 'rgb(255, 255, 255)',
          fontSize: '16px',
          fontWeight: '400',
          lineHeight: '24px',
          display: 'block',
          visibility: 'visible',
          margin: '',
          padding: '',
        },
        textSnippet: 'Click Me',
      },
    ];

    const input: RuleEvidenceInput = {
      domSnapshot: '<html><head><title>Immutable</title></head><body><button id="btn">Click Me</button></body></html>',
      computedStyles: originalStyles,
      url: 'https://example.com',
    };

    const inputClone = JSON.parse(JSON.stringify(input));

    await service.evaluate(input);

    expect(input).toEqual(inputClone);
  });

  it('produces identical, deterministic results for identical inputs', async () => {
    const input: RuleEvidenceInput = {
      domSnapshot: '<html><head><title>Determinism</title></head><body><img src="pic.jpg"></body></html>',
      computedStyles: [],
      url: 'https://example.com',
    };

    const res1 = await service.evaluate(input);
    const res2 = await service.evaluate(input);

    // Duration and evaluatedAt may differ slightly, but rule outputs and findings must match exactly
    expect(res1.rulesEvaluatedCount).toBe(res2.rulesEvaluatedCount);
    expect(res1.passedRulesCount).toBe(res2.passedRulesCount);
    expect(res1.findingRulesCount).toBe(res2.findingRulesCount);
    expect(res1.totalFindingsCount).toBe(res2.totalFindingsCount);
    expect(res1.findings).toEqual(res2.findings);
    expect(res1.results).toEqual(res2.results);
  });

  it('handles empty and minimal capture artifacts safely', async () => {
    const emptyInput: RuleEvidenceInput = {
      domSnapshot: '',
      computedStyles: [],
    };

    const result = await service.evaluate(emptyInput);

    expect(result.rulesEvaluatedCount).toBe(5);
    expect(result.notEvaluableRulesCount).toBe(5); // all rules report not-evaluable on empty DOM
    expect(result.totalFindingsCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('isolates errors if an individual rule throws unexpectedly', async () => {
    const throwingRule = {
      id: 'mock-throwing-rule',
      name: 'Throwing Rule',
      version: '1.0.0',
      category: 'accessibility' as any,
      defaultSeverity: 'Critical' as any,
      description: 'Throws error',
      evaluate: jest.fn().mockImplementation(() => {
        throw new Error('Unexpected internal rule failure');
      }),
    };

    const customService = new RuleEngineService(
      throwingRule as any,
      new ImgAltPresentRule(),
      new ButtonNamePresentRule(),
      new HeadingOrderRule(),
      new TextContrastRule(),
    );

    const result = await customService.evaluate({
      domSnapshot: '<html><head><title>Test</title></head><body></body></html>',
      computedStyles: [],
    });

    const throwingResult = result.results.find((r) => r.ruleId === 'mock-throwing-rule');
    expect(throwingResult).toBeDefined();
    expect(throwingResult?.status).toBe(RuleEvaluationStatus.NOT_EVALUABLE);
    expect(throwingResult?.notEvaluableReason).toContain('Unexpected internal rule failure');

    // Other rules should continue to evaluate safely
    expect(result.results).toHaveLength(5);
  });
});
