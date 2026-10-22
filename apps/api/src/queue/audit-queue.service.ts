import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  AUDIT_JOB_NAME,
  AUDIT_QUEUE_NAME,
  AUDIT_QUEUE_TOKEN,
} from './queue.constants';
import { AuditJobData, RedisConnectionOptions } from './queue.types';
import { sanitizeErrorMessage } from '../capture/capture.types';

@Injectable()
export class AuditQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditQueueService.name);
  private queue?: Queue<AuditJobData, void, string>;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(AUDIT_QUEUE_TOKEN)
    injectedQueue?: Queue<AuditJobData, void, string>,
  ) {
    if (injectedQueue) {
      this.queue = injectedQueue;
    }
  }

  onModuleInit() {
    if (!this.queue) {
      const connection = this.buildConnectionOptions();
      this.queue = new Queue<AuditJobData, void, string>(AUDIT_QUEUE_NAME, {
        connection,
      });

      this.queue.on('error', (err) => {
        const safeReason = sanitizeErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
        this.logger.error(`BullMQ queue connection error: ${safeReason}`);
      });
    }
  }

  async onModuleDestroy() {
    if (this.queue) {
      try {
        await this.queue.close();
      } catch (err) {
        const safeReason = sanitizeErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
        this.logger.error(`Error closing queue connection: ${safeReason}`);
      }
    }
  }

  /**
   * Adds an audit processing job to the queue.
   *
   * JOB IDENTITY & RETRY POLICY:
   * - Uses auditId as the stable jobId to prevent duplicate enqueue attempts in Redis.
   * - Conservative retry policy (attempts: 1): without fencing tokens, automatic retries
   *   could race with concurrent or already-terminal audits.
   * - Completion retention (24h / 1000 jobs) and failure retention (7d / 5000 jobs) bounded.
   */
  async addAuditJob(auditId: string): Promise<void> {
    if (!this.queue) {
      throw new Error('Audit queue is not initialized');
    }

    try {
      await this.queue.add(
        AUDIT_JOB_NAME,
        {
          auditId,
          createdAt: new Date().toISOString(),
        },
        {
          jobId: auditId,
          attempts: 1,
          removeOnComplete: {
            age: 86400,
            count: 1000,
          },
          removeOnFail: {
            age: 604800,
            count: 5000,
          },
        },
      );
      this.logger.log(`Enqueued audit job for auditId: ${auditId}`);
    } catch (err) {
      const safeReason = sanitizeErrorMessage(
        err instanceof Error ? err.message : String(err),
      );
      this.logger.error(
        `Failed to enqueue job for audit ${auditId}: ${safeReason}`,
      );
      throw err;
    }
  }

  /**
   * Returns the underlying queue instance (useful for testing and queue inspection).
   */
  getQueue(): Queue<AuditJobData, void, string> | undefined {
    return this.queue;
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
      lazyConnect: true,
      retryStrategy: (times: number) => {
        if (times > 5) {
          return null; // Stop reconnecting after 5 attempts
        }
        return Math.min(times * 200, 2000);
      },
    };
  }
}
