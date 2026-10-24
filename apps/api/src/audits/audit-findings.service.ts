import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RuleFinding } from '../rules/rules.types';
import {
  AuditOrchestrationError,
  AuditOrchestrationErrorCode,
} from './audit-orchestrator.types';

@Injectable()
export class AuditFindingsService {
  private readonly logger = new Logger(AuditFindingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists deterministic rule findings and their grounded evidence records atomically.
   *
   * TRANSACTION & IDEMPOTENCY GUARANTEES:
   * 1. Executed within an isolated atomic transaction (prisma.$transaction).
   * 2. Idempotent replacement: any pre-existing issues for the auditId are deleted first
   *    (cascading to evidence records) before creating fresh records.
   * 3. Zero-finding audits are supported cleanly (ensures 0 issues, returns 0).
   * 4. Short transaction window: only database writes are performed inside the transaction.
   * 5. Non-finding outcomes (pass / not-evaluable) are strictly excluded from persistence.
   */
  async persistFindings(
    auditId: string,
    findings: RuleFinding[],
  ): Promise<number> {
    if (!auditId) {
      throw new AuditOrchestrationError(
        AuditOrchestrationErrorCode.PERSISTENCE_FAILED,
        'Cannot persist findings without a valid auditId',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Idempotency guard: clear previous issues for this audit if re-running
        await tx.issue.deleteMany({
          where: { auditId },
        });

        if (!findings || findings.length === 0) {
          return 0;
        }

        // 2. Insert new issues with their grounded evidence records
        for (const finding of findings) {
          const evidenceData: Prisma.EvidenceCreateWithoutIssueInput[] = [];

          if (finding.evidence) {
            evidenceData.push({
              domSelector: finding.evidence.selector ?? null,
              snippet: finding.evidence.snippet ?? null,
              highlightedRegion: finding.evidence.boundingBox
                ? (finding.evidence.boundingBox as Prisma.InputJsonValue)
                : Prisma.DbNull,
              screenshotCropUrl: null, // Cropping artifact is not yet implemented
            });
          }

          await tx.issue.create({
            data: {
              auditId,
              category: finding.category,
              title: finding.title.slice(0, 255),
              description: finding.description,
              severity: finding.severity,
              confidence: 'deterministic',
              standardReference: finding.standardReference
                ? finding.standardReference.slice(0, 255)
                : null,
              recommendation: finding.recommendation,
              status: 'open',
              ...(evidenceData.length > 0
                ? {
                    evidence: {
                      create: evidenceData,
                    },
                  }
                : {}),
            },
          });
        }

        return findings.length;
      });
    } catch (err) {
      this.logger.error(
        `Failed to persist findings for audit ${auditId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AuditOrchestrationError(
        AuditOrchestrationErrorCode.PERSISTENCE_FAILED,
        'Failed to persist audit findings',
        undefined,
        err,
      );
    }
  }

  /**
   * Loads persisted issues and evidence for a given audit ID.
   */
  async getAuditFindings(auditId: string) {
    return this.prisma.issue.findMany({
      where: { auditId },
      include: { evidence: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
