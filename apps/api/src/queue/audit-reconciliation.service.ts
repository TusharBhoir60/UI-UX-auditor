import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { AuditQueueService } from './audit-queue.service';
import { sanitizeErrorMessage } from '../capture/capture.types';

export interface ReconciliationSummary {
  scanned: number;
  reEnqueued: number;
  alreadyQueued: number;
  alreadyActive: number;
  errors: number;
  skipped: boolean;
}

@Injectable()
export class AuditReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AuditReconciliationService.name);
  private isReconciling = false;
  private timer?: NodeJS.Timeout;

  private readonly intervalMs: number;
  private readonly staleThresholdMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditQueueService: AuditQueueService,
    private readonly configService: ConfigService,
  ) {
    this.intervalMs = this.configService.get<number>(
      'AUDIT_RECONCILIATION_INTERVAL_MS',
      60000,
    );
    this.staleThresholdMs = this.configService.get<number>(
      'AUDIT_RECONCILIATION_STALE_THRESHOLD_MS',
      300000,
    );
    this.batchSize = this.configService.get<number>(
      'AUDIT_RECONCILIATION_BATCH_SIZE',
      50,
    );
  }

  onModuleInit() {
    if (this.intervalMs > 0) {
      this.timer = setInterval(() => {
        this.reconcileStaleAudits().catch((err) => {
          const safeReason = sanitizeErrorMessage(
            err instanceof Error ? err.message : String(err),
          );
          this.logger.error(
            `Unhandled error in background audit reconciliation: ${safeReason}`,
          );
        });
      }, this.intervalMs);
      this.timer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Scans for stale audits that remain in 'queued' status beyond the stale threshold,
   * and ensures each is safely enqueued to BullMQ.
   *
   * SAFEGUARD GUARANTEES:
   * 1. Only audits in 'queued' status are queried (excludes 'running', 'complete', 'failed').
   * 2. Bounded batch size ('take: batchSize') prevents unbounded memory consumption.
   * 3. Process-level mutex (isReconciling flag) prevents overlapping reconciliation runs.
   * 4. Redis and PostgreSQL errors are logged safely and recorded without crashing the application.
   * 5. Never trusts queue payloads for URLs; status updates remain strictly owned by AuditOrchestratorService.
   */
  async reconcileStaleAudits(): Promise<ReconciliationSummary> {
    if (this.isReconciling) {
      this.logger.warn(
        'Skipping audit reconciliation: previous reconciliation run is still in progress',
      );
      return {
        scanned: 0,
        reEnqueued: 0,
        alreadyQueued: 0,
        alreadyActive: 0,
        errors: 0,
        skipped: true,
      };
    }

    this.isReconciling = true;
    const summary: ReconciliationSummary = {
      scanned: 0,
      reEnqueued: 0,
      alreadyQueued: 0,
      alreadyActive: 0,
      errors: 0,
      skipped: false,
    };

    try {
      const cutoff = new Date(Date.now() - this.staleThresholdMs);

      let staleAudits: Array<{ id: string; createdAt: Date }>;
      try {
        staleAudits = await this.prisma.audit.findMany({
          where: {
            status: 'queued',
            createdAt: {
              lte: cutoff,
            },
          },
          take: this.batchSize,
          orderBy: {
            createdAt: 'asc',
          },
          select: {
            id: true,
            createdAt: true,
          },
        });
      } catch (dbErr) {
        const safeReason = sanitizeErrorMessage(
          dbErr instanceof Error ? dbErr.message : String(dbErr),
        );
        this.logger.error(
          `[Reconciliation Failed] PostgreSQL query error: ${safeReason}`,
        );
        summary.errors++;
        return summary;
      }

      summary.scanned = staleAudits.length;
      if (summary.scanned === 0) {
        return summary;
      }

      this.logger.log(
        `Found ${summary.scanned} stale queued audit(s) created before ${cutoff.toISOString()}`,
      );

      for (const audit of staleAudits) {
        try {
          const outcome = await this.auditQueueService.reconcileAuditJob(
            audit.id,
          );
          if (outcome === 'enqueued') {
            summary.reEnqueued++;
          } else if (outcome === 'already_waiting') {
            summary.alreadyQueued++;
          } else if (outcome === 'already_active') {
            summary.alreadyActive++;
          }
        } catch (queueErr) {
          summary.errors++;
          const safeReason = sanitizeErrorMessage(
            queueErr instanceof Error ? queueErr.message : String(queueErr),
          );
          this.logger.error(
            `[Reconciliation Failed] Redis unavailable for auditId=${audit.id}: ${safeReason}`,
          );
        }
      }

      this.logger.log(
        `Audit reconciliation completed: scanned=${summary.scanned}, reEnqueued=${summary.reEnqueued}, alreadyQueued=${summary.alreadyQueued}, alreadyActive=${summary.alreadyActive}, errors=${summary.errors}`,
      );
      return summary;
    } finally {
      this.isReconciling = false;
    }
  }

  /**
   * Returns current reconciliation running status (useful for health and inspection).
   */
  getIsReconciling(): boolean {
    return this.isReconciling;
  }
}
