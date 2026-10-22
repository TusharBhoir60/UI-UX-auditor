import { Module } from '@nestjs/common';
import { RuleEngineService } from './rule-engine.service';
import { DocTitlePresentRule } from './rules/doc-title-present.rule';
import { ImgAltPresentRule } from './rules/img-alt-present.rule';
import { ButtonNamePresentRule } from './rules/button-name-present.rule';
import { HeadingOrderRule } from './rules/heading-order.rule';
import { TextContrastRule } from './rules/text-contrast.rule';

@Module({
  providers: [
    DocTitlePresentRule,
    ImgAltPresentRule,
    ButtonNamePresentRule,
    HeadingOrderRule,
    TextContrastRule,
    RuleEngineService,
  ],
  exports: [RuleEngineService],
})
export class RulesModule {}
