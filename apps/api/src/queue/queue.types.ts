/**
 * Payload carried by BullMQ jobs in the audit processing queue.
 *
 * RESTRICTIONS:
 * - Contains only the audit ID and non-sensitive diagnostic metadata.
 * - Raw URLs, credentials, or user inputs MUST NOT be passed through queue payloads;
 *   the worker loads the authoritative target URL directly from PostgreSQL.
 */
export interface AuditJobData {
  readonly auditId: string;
  readonly createdAt?: string;
}

/**
 * Validated Redis connection parameters for BullMQ Queue and Worker instances.
 */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  tls?: Record<string, unknown>;
  maxRetriesPerRequest: null;
  enableReadyCheck: boolean;
  connectTimeout: number;
  lazyConnect?: boolean;
  retryStrategy: (times: number) => number | null;
}
