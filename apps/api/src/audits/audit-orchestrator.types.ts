import { CaptureMetadata } from '../capture/capture.types';

/**
 * Standard audit lifecycle states matching the database enum.
 */
export enum AuditState {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

/**
 * Error categories for audit job orchestration.
 */
export enum AuditOrchestrationErrorCode {
  AUDIT_NOT_FOUND = 'AUDIT_NOT_FOUND',
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',
  CONCURRENT_CONFLICT = 'CONCURRENT_CONFLICT',
  PERSISTENCE_FAILED = 'PERSISTENCE_FAILED',
}

/**
 * Typed orchestration error returned or thrown during audit processing.
 */
export class AuditOrchestrationError extends Error {
  constructor(
    public readonly code: AuditOrchestrationErrorCode,
    public readonly safeMessage: string,
    public readonly currentStatus?: string,
    public readonly cause?: unknown,
  ) {
    super(`[${code}] ${safeMessage}`);
    this.name = 'AuditOrchestrationError';
  }
}

/**
 * Outcome payload on successful capture stage completion.
 */
export interface AuditOrchestrationSuccess {
  readonly auditId: string;
  readonly status: 'complete';
  readonly captureMetadata: CaptureMetadata;
}

/**
 * Outcome payload on terminal capture failure.
 */
export interface AuditOrchestrationFailure {
  readonly auditId: string;
  readonly status: 'failed';
  readonly failureReason: string;
}

/**
 * Terminal orchestration result.
 */
export type AuditOrchestrationResult =
  | AuditOrchestrationSuccess
  | AuditOrchestrationFailure;
