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
   * Returned issues are deterministically ordered by:
   * 1. Severity: Critical -> High -> Medium -> Low
   * 2. Creation time: Oldest first (createdAt asc)
   * 3. ID: Lexicographical tie-breaker (id asc)
   * Evidence records within each issue are ordered by createdAt asc, id asc.
   */
  async getAuditFindings(auditId: string) {
    const issues = await this.prisma.issue.findMany({
      where: { auditId },
      include: {
        evidence: {
          orderBy: [
            { createdAt: 'asc' },
            { id: 'asc' },
          ],
        },
      },
      orderBy: [
        { severity: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });

    const severityOrder: Record<string, number> = {
      Critical: 1,
      High: 2,
      Medium: 3,
      Low: 4,
    };

    return issues.sort((a, b) => {
      const weightA = severityOrder[a.severity] ?? 99;
      const weightB = severityOrder[b.severity] ?? 99;
      if (weightA !== weightB) {
        return weightA - weightB;
      }
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      return a.id.localeCompare(b.id);
    });
  }
}
