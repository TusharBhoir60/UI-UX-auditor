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
export class ImgAltPresentRule implements DeterministicRule {
  readonly id = RULE_IDS.IMG_ALT_PRESENT;
  readonly name = 'Image Alternative Text Presence';
  readonly version = '1.0.0';
  readonly category = RuleCategory.ACCESSIBILITY;
  readonly defaultSeverity = RuleSeverity.CRITICAL;
  readonly standardReference = 'WCAG 1.1.1 (Level A)';
  readonly description =
    'Ensures every <img> element has an alt attribute providing alternative text or is explicitly marked as decorative.';

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
          'DOM snapshot is empty or malformed; image elements cannot be reliably evaluated',
      };
    }

    const findings: RuleFinding[] = [];
    const images = parsedDom.images;

    for (const img of images) {
      // Decorative exemption: aria-hidden="true" or role="presentation" / role="none"
      if (
        img.ariaHidden === true ||
        img.role === 'presentation' ||
        img.role === 'none'
      ) {
        continue;
      }

      // 1. Missing alt attribute entirely
      if (!img.hasAltAttribute) {
        findings.push({
          ruleId: this.id,
          ruleVersion: this.version,
          category: this.category,
          severity: this.defaultSeverity,
          confidence: RuleConfidence.DETERMINISTIC,
          title: 'Image missing alternative text (alt attribute)',
          description:
            'The <img> element does not have an alt attribute. Screen readers may announce the full file URL or skip the element, leaving non-sighted users uninformed of image content.',
          recommendation:
            'Add an alt attribute describing the image purpose, or set alt="" if the image is purely decorative.',
          standardReference: this.standardReference,
          evidence: {
            selector: img.selector,
            tagName: 'img',
            snippet: img.rawSnippet,
            boundingBox: img.matchingComputedStyle?.boundingBox ?? null,
            expected: 'alt attribute present with descriptive text or empty string for decorative images',
            observed: 'alt attribute is completely absent',
            attributes: {
              ...(img.src ? { src: img.src } : {}),
              ...(img.id ? { id: img.id } : {}),
            },
          },
        });
        continue;
      }

      // 2. Alt attribute present but contains only whitespace
      if (img.alt !== undefined && img.alt.length > 0 && img.alt.trim().length === 0) {
        findings.push({
          ruleId: this.id,
          ruleVersion: this.version,
          category: this.category,
          severity: RuleSeverity.HIGH,
          confidence: RuleConfidence.DETERMINISTIC,
          title: 'Image alt attribute contains only whitespace',
          description:
            'The alt attribute contains whitespace characters only. Screen readers may pause or misinterpret whitespace. If the image is decorative, use alt="" with no space characters.',
          recommendation:
            'Provide meaningful text in the alt attribute or use alt="" without whitespace for decorative graphics.',
          standardReference: this.standardReference,
          evidence: {
            selector: img.selector,
            tagName: 'img',
            snippet: img.rawSnippet,
            boundingBox: img.matchingComputedStyle?.boundingBox ?? null,
            expected: 'Descriptive text or exact empty string alt=""',
            observed: `alt="${img.alt}" (whitespace only)`,
            attributes: {
              alt: img.alt,
              ...(img.src ? { src: img.src } : {}),
            },
          },
        });
      }
    }

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      category: this.category,
      status:
        findings.length > 0 ? RuleEvaluationStatus.FINDING : RuleEvaluationStatus.PASS,
      elementsEvaluatedCount: images.length,
      findings,
    };
  }
}
