import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditQueueService } from './audit-queue.service';
import { AuditWorkerProcessor } from './audit-worker.processor';
import { AuditsModule } from '../audits/audits.module';

@Module({
  imports: [ConfigModule, forwardRef(() => AuditsModule)],
  providers: [AuditQueueService, AuditWorkerProcessor],
  exports: [AuditQueueService, AuditWorkerProcessor],
})
export class QueueModule {}
