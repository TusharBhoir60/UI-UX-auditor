import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import {
  AuditCreationResponse,
  AuditDetailResponse,
  AuditListItemResponse,
  AuditStatusResponse,
} from './audits.types';
import { AuditQueueService } from '../queue/audit-queue.service';
import { sanitizeErrorMessage } from '../capture/capture.types';

@Injectable()
export class AuditsService {
  private readonly logger = new Logger(AuditsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AuditQueueService))
    private readonly auditQueueService: AuditQueueService,
  ) {}

  /**
   * Creates a new audit owned by the authenticated user with initial status 'queued',
   * and dispatches an asynchronous processing job to the queue.
   *
   * DATABASE-TO-QUEUE CONSISTENCY BOUNDARY:
   * 1. The audit record is committed to PostgreSQL in 'queued' status.
   * 2. The job is enqueued to BullMQ using the audit ID as the stable job ID.
   * 3. If enqueue fails (e.g., Redis down, timeout):
   *    - A compensating update immediately transitions the audit to 'failed' with failureReason.
   *    - An InternalServerErrorException is thrown so the client receives an observable 500 error.
   *    - The audit is never silently left stranded in 'queued' status.
   * 4. If enqueue was ambiguous (timed out but enqueued), the worker's atomic state claim
   *    in processAudit guarantees that a terminal ('failed') audit will not be processed.
   */
  async create(
    userId: string,
    dto: CreateAuditDto,
  ): Promise<AuditCreationResponse> {
    let audit: { id: string; status: 'queued' | 'running' | 'complete' | 'failed' };
    try {
      audit = await this.prisma.audit.create({
        data: {
          userId,
          url: dto.url,
          status: 'queued',
        },
        select: {
          id: true,
          status: true,
        },
      });
    } catch {
      this.logger.error(`Failed to persist audit for user ${userId}`);
      throw new InternalServerErrorException('Failed to create audit');
    }

    try {
      await this.auditQueueService.addAuditJob(audit.id);
    } catch (queueErr) {
      const safeReason = sanitizeErrorMessage(
        queueErr instanceof Error ? queueErr.message : String(queueErr),
      );
      this.logger.error(
        `Failed to enqueue audit ${audit.id} to job queue: ${safeReason}`,
      );

      // Compensating update: mark audit as failed so it is not silently left in 'queued' forever
      try {
        await this.prisma.audit.updateMany({
          where: {
            id: audit.id,
            status: 'queued',
          },
          data: {
            status: 'failed',
            failureReason: 'Failed to enqueue audit for processing',
            completedAt: new Date(),
          },
        });
      } catch (dbErr) {
        this.logger.error(
          `Failed to record compensating failure status for audit ${audit.id}`,
        );
      }

      throw new InternalServerErrorException(
        'Failed to enqueue audit for processing',
      );
    }

    return {
      audit_id: audit.id,
      status: audit.status,
    };
  }

  /**
   * Lists all audits belonging to the authenticated user, ordered newest first.
   */
  async findAll(userId: string): Promise<AuditListItemResponse[]> {
    const audits = await this.prisma.audit.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        url: true,
        status: true,
        createdAt: true,
      },
    });

    return audits.map((audit) => ({
      audit_id: audit.id,
      url: audit.url,
      status: audit.status,
      created_at: audit.createdAt.toISOString(),
      summary_counts: null,
    }));
  }

  /**
   * Retrieves an audit by ID, strictly scoped to the authenticated owner.
   * Throws 404 if not found or if owned by another user (preventing resource enumeration).
   */
  async findOne(userId: string, auditId: string): Promise<AuditDetailResponse> {
    const audit = await this.prisma.audit.findFirst({
      where: {
        id: auditId,
        userId,
      },
      select: {
        id: true,
        url: true,
        status: true,
        failureReason: true,
        createdAt: true,
        completedAt: true,
      },
    });

    if (!audit) {
      throw new NotFoundException('Audit not found');
    }

    return {
      audit_id: audit.id,
      url: audit.url,
      status: audit.status,
      failure_reason: audit.failureReason,
      created_at: audit.createdAt.toISOString(),
      completed_at: audit.completedAt ? audit.completedAt.toISOString() : null,
      report: null,
    };
  }

  /**
   * Retrieves the lightweight polling status for an audit, strictly ownership-scoped.
   * Throws 404 if not found or if owned by another user.
   */
  async getStatus(
    userId: string,
    auditId: string,
  ): Promise<AuditStatusResponse> {
    const audit = await this.prisma.audit.findFirst({
      where: {
        id: auditId,
        userId,
      },
      select: {
        status: true,
        failureReason: true,
      },
    });

    if (!audit) {
      throw new NotFoundException('Audit not found');
    }

    return {
      status: audit.status,
      stage: 'queued',
      failure_reason: audit.failureReason,
    };
  }
}
