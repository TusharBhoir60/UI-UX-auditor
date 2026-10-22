import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CaptureService } from '../capture/capture.service';
import { CaptureError, sanitizeErrorMessage } from '../capture/capture.types';
import {
  AuditOrchestrationError,
  AuditOrchestrationErrorCode,
  AuditOrchestrationFailure,
  AuditOrchestrationResult,
  AuditState,
} from './audit-orchestrator.types';

@Injectable()
export class AuditOrchestratorService {
  private readonly logger = new Logger(AuditOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly captureService: CaptureService,
  ) {}

  /**
   * Transitions an existing queued audit to running, executes headless browser capture,
   * and records the terminal state (complete or failed).
   *
   * TRANSACTION BOUNDARY & CONCURRENCY GUARANTEES:
   * 1. State transitions are guarded by atomic conditional SQL updates (updateMany where status = 'queued').
   * 2. Database connections and transactions are NEVER held open while Chromium runs.
   * 3. Terminal state updates (to complete or failed) conditionally target status = 'running',
   *    ensuring late failure callbacks cannot overwrite a completed audit.
   * 4. URLs are loaded strictly from the database record; untrusted caller URLs are never used.
   */
  async processAudit(auditId: string): Promise<AuditOrchestrationResult> {
    // 1. Load the audit from the database
    const audit = await this.prisma.audit.findUnique({
      where: { id: auditId },
      select: { id: true, url: true, status: true },
    });

    if (!audit) {
      throw new AuditOrchestrationError(
        AuditOrchestrationErrorCode.AUDIT_NOT_FOUND,
        `Audit ${auditId} was not found`,
      );
    }

    // 2. State machine verification: only 'queued' audits may be processed
    if (audit.status !== AuditState.QUEUED) {
      throw new AuditOrchestrationError(
        AuditOrchestrationErrorCode.INVALID_STATE_TRANSITION,
        `Audit cannot transition from '${audit.status}' to '${AuditState.RUNNING}'`,
        audit.status,
      );
    }

    // 3. Atomically claim the audit row (concurrency guard)
    let claimCount: number;
    try {
      const claim = await this.prisma.audit.updateMany({
        where: {
          id: auditId,
          status: AuditState.QUEUED,
        },
        data: {
          status: AuditState.RUNNING,
        },
      });
      claimCount = claim.count;
    } catch (err) {
      this.logger.error(`Database error while claiming audit ${auditId}`);
      throw new AuditOrchestrationError(
        AuditOrchestrationErrorCode.PERSISTENCE_FAILED,
        'Failed to claim audit due to database error',
        audit.status,
        err,
      );
    }

    if (claimCount === 0) {
      throw new AuditOrchestrationError(
        AuditOrchestrationErrorCode.CONCURRENT_CONFLICT,
        'Failed to claim audit: claimed by a concurrent process',
        AuditState.RUNNING,
      );
    }

    // 4. Invoke CaptureService using the stored database URL
    // (No DB connection or transaction is held open during Chromium execution)
    let captureResult;
    try {
      captureResult = await this.captureService.capture({ url: audit.url });
    } catch (err) {
      return await this.handleCaptureFailure(auditId, err);
    }

    // 5. Record terminal success
    try {
      const updateResult = await this.prisma.audit.updateMany({
        where: {
          id: auditId,
          status: AuditState.RUNNING,
        },
        data: {
          status: AuditState.COMPLETE,
          completedAt: new Date(),
          failureReason: null,
        },
      });

      if (updateResult.count === 0) {
        this.logger.warn(
          `Terminal update to complete skipped: audit ${auditId} is no longer running`,
        );
      }

      return {
        auditId,
        status: 'complete',
        captureMetadata: captureResult.metadata,
      };
    } catch (dbErr) {
      this.logger.error(`Failed to persist complete status for audit ${auditId}`);
      throw new AuditOrchestrationError(
        AuditOrchestrationErrorCode.PERSISTENCE_FAILED,
        'Failed to persist terminal completion status',
        AuditState.RUNNING,
        dbErr,
      );
    }
  }

  /**
   * Handles capture failure by sanitizing the error message and transitioning the audit to 'failed'.
   */
  private async handleCaptureFailure(
    auditId: string,
    err: unknown,
  ): Promise<AuditOrchestrationFailure> {
    const safeReason = this.mapToSafeFailureReason(err);

    try {
      const updateResult = await this.prisma.audit.updateMany({
        where: {
          id: auditId,
          status: AuditState.RUNNING,
        },
        data: {
          status: AuditState.FAILED,
          completedAt: new Date(),
          failureReason: safeReason,
        },
      });

      if (updateResult.count === 0) {
        this.logger.warn(
          `Terminal update to failed skipped: audit ${auditId} is no longer running`,
        );
      }

      return {
        auditId,
        status: 'failed',
        failureReason: safeReason,
      };
    } catch (dbErr) {
      this.logger.error(`Failed to persist failed status for audit ${auditId}`);
      throw new AuditOrchestrationError(
        AuditOrchestrationErrorCode.PERSISTENCE_FAILED,
        'Failed to persist terminal failure status',
        AuditState.RUNNING,
        dbErr,
      );
    }
  }

  /**
   * Maps an error to a safe failure reason without credentials or stack traces.
   */
  private mapToSafeFailureReason(err: unknown): string {
    if (err instanceof CaptureError) {
      return sanitizeErrorMessage(err.safeReason);
    }
    return 'An unexpected error occurred during capture processing';
  }
}
