import { Module, forwardRef } from '@nestjs/common';
import { AuditsController } from './audits.controller';
import { AuditsService } from './audits.service';
import { AuditOrchestratorService } from './audit-orchestrator.service';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { CaptureModule } from '../capture/capture.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    CaptureModule,
    forwardRef(() => QueueModule),
  ],
  controllers: [AuditsController],
  providers: [AuditsService, AuditOrchestratorService],
  exports: [AuditsService, AuditOrchestratorService],
})
export class AuditsModule {}
