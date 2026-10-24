import { Module, forwardRef } from '@nestjs/common';
import { AuditsController } from './audits.controller';
import { AuditsService } from './audits.service';
import { AuditOrchestratorService } from './audit-orchestrator.service';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { CaptureModule } from '../capture/capture.module';
import { QueueModule } from '../queue/queue.module';
import { RulesModule } from '../rules/rules.module';
import { AuditFindingsService } from './audit-findings.service';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    CaptureModule,
    RulesModule,
    forwardRef(() => QueueModule),
  ],
  controllers: [AuditsController],
  providers: [AuditsService, AuditOrchestratorService, AuditFindingsService],
  exports: [AuditsService, AuditOrchestratorService, AuditFindingsService],
})
export class AuditsModule {}
