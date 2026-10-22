import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditQueueService } from './audit-queue.service';
import { AuditWorkerProcessor } from './audit-worker.processor';
import { AuditReconciliationService } from './audit-reconciliation.service';
import { AuditsModule } from '../audits/audits.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [ConfigModule, DatabaseModule, forwardRef(() => AuditsModule)],
  providers: [
    AuditQueueService,
    AuditWorkerProcessor,
    AuditReconciliationService,
  ],
  exports: [
    AuditQueueService,
    AuditWorkerProcessor,
    AuditReconciliationService,
  ],
})
export class QueueModule {}
