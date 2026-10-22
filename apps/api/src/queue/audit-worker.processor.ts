import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import {
  AUDIT_QUEUE_NAME,
  AUDIT_WORKER_TOKEN,
} from './queue.constants';
import { AuditJobData, RedisConnectionOptions } from './queue.types';
import { AuditOrchestratorService } from '../audits/audit-orchestrator.service';
import {
  AuditOrchestrationError,
  AuditOrchestrationErrorCode,
} from '../audits/audit-orchestrator.types';
import { sanitizeErrorMessage } from '../capture/capture.types';

@Injectable()
export class AuditWorkerProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditWorkerProcessor.name);
  private worker?: Worker<AuditJobData, void, string>;

  constructor(
    private readonly auditOrchestratorService: AuditOrchestratorService,
    private readonly configService: ConfigService,
    @Optional()
    @Inject(AUDIT_WORKER_TOKEN)
    injectedWorker?: Worker<AuditJobData, void, string>,
  ) {
    if (injectedWorker) {
      this.worker = injectedWorker;
    }
  }

  onModuleInit() {
    const workerEnabled = this.configService.get<boolean>('WORKER_ENABLED', true);
    if (!workerEnabled) {
      this.logger.log(
        'AuditWorkerProcessor is disabled (WORKER_ENABLED=false); skipping worker startup.',
      );
      return;
    }

    if (!this.worker) {
      const connection = this.buildConnectionOptions();
      this.worker = new Worker<AuditJobData, void, string>(
        AUDIT_QUEUE_NAME,
        async (job) => this.processJob(job),
        {
          concurrency: 1,
          connection,
        },
      );

      this.worker.on('error', (err) => {
        const safeReason = sanitizeErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
        this.logger.error(`BullMQ worker connection error: ${safeReason}`);
      });

      this.worker.on('failed', (job, err) => {
        const safeReason = sanitizeErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
        this.logger.error(
          `Audit job ${job?.id ?? 'unknown'} failed in queue: ${safeReason}`,
        );
      });
    }
  }

  async onModuleDestroy() {
    if (this.worker) {
      try {
        await this.worker.close();
      } catch (err) {
        const safeReason = sanitizeErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
        this.logger.error(`Error closing worker connection: ${safeReason}`);
      }
    }
  }

  /**
   * Processes an audit job received from BullMQ.
   *
   * CONCURRENCY & RE-DELIVERY SAFETY:
   * 1. Target URL is NEVER read from the job payload; it is loaded authoritatively from PostgreSQL
   *    by AuditOrchestratorService.processAudit(auditId).
   * 2. Audit status transitions remain strictly owned by AuditOrchestratorService.
   * 3. Expected orchestration errors (already running/completed/failed or claimed by concurrent worker)
   *    are logged safely and acknowledged without marking completed audits as failed.
   * 4. Unexpected errors are sanitized to prevent credential/URL/DOM leaks.
   */
  async processJob(job: Job<AuditJobData>): Promise<void> {
    const auditId = job.data?.auditId;
    if (!auditId || typeof auditId !== 'string') {
      this.logger.error(
        `Received invalid job payload without auditId: ${job.id ?? 'unknown'}`,
      );
      return;
    }

    try {
      const result = await this.auditOrchestratorService.processAudit(auditId);
      this.logger.log(
        `Audit ${auditId} processed successfully with status: ${result.status}`,
      );
    } catch (err) {
      if (err instanceof AuditOrchestrationError) {
        switch (err.code) {
          case AuditOrchestrationErrorCode.INVALID_STATE_TRANSITION:
          case AuditOrchestrationErrorCode.CONCURRENT_CONFLICT:
            this.logger.warn(
              `[Audit Already Claimed/Terminal] auditId=${auditId} code=${err.code}: ${err.safeMessage}`,
            );
            return;
          case AuditOrchestrationErrorCode.AUDIT_NOT_FOUND:
            this.logger.warn(
              `[Audit Not Found] auditId=${auditId} code=${err.code}: ${err.safeMessage}`,
            );
            return;
          case AuditOrchestrationErrorCode.PERSISTENCE_FAILED:
            this.logger.error(
              `[Worker Persistence Failure] auditId=${auditId}: ${err.safeMessage}`,
            );
            throw err;
        }
      }

      const safeReason = sanitizeErrorMessage(
        err instanceof Error ? err.message : 'Unknown worker error',
      );
      this.logger.error(
        `[Unexpected Worker Failure] auditId=${auditId}: ${safeReason}`,
      );
      throw new Error(safeReason);
    }
  }

  /**
   * Returns the underlying worker instance (useful for testing and inspection).
   */
  getWorker(): Worker<AuditJobData, void, string> | undefined {
    return this.worker;
  }

  /**
   * Builds validated Redis connection options with bounded connection and retry limits.
   */
  private buildConnectionOptions(): RedisConnectionOptions {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const tls = this.configService.get<boolean>('REDIS_TLS', false);

    return {
      host,
      port,
      password: password || undefined,
      tls: tls ? {} : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 5000,
      retryStrategy: (times: number) => {
        if (times > 5) {
          return null; // Stop reconnecting after 5 attempts
        }
        return Math.min(times * 200, 2000);
      },
    };
  }
}
