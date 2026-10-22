import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import {
  AuditCreationResponse,
  AuditDetailResponse,
  AuditListItemResponse,
  AuditStatusResponse,
} from './audits.types';

@Injectable()
export class AuditsService {
  private readonly logger = new Logger(AuditsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a new audit owned by the authenticated user with initial status 'queued'.
   */
  async create(
    userId: string,
    dto: CreateAuditDto,
  ): Promise<AuditCreationResponse> {
    try {
      const audit = await this.prisma.audit.create({
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

      return {
        audit_id: audit.id,
        status: audit.status,
      };
    } catch {
      this.logger.error(`Failed to persist audit for user ${userId}`);
      throw new InternalServerErrorException('Failed to create audit');
    }
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
