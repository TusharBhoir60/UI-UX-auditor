import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AuditFindingsService } from './audit-findings.service';
import { PrismaService } from '../database/prisma.service';
import {
  RuleCategory,
  RuleConfidence,
  RuleFinding,
  RuleSeverity,
} from '../rules/rules.types';
import {
  AuditOrchestrationError,
  AuditOrchestrationErrorCode,
} from './audit-orchestrator.types';

describe('AuditFindingsService', () => {
  let service: AuditFindingsService;
  let mockPrismaService: {
    $transaction: jest.Mock;
    issue: {
      findMany: jest.Mock;
    };
  };

  const AUDIT_ID = '22222222-2222-4222-8222-222222222222';

  const MOCK_FINDINGS: RuleFinding[] = [
    {
      ruleId: 'img-alt-present',
      ruleVersion: '1.0.0',
      category: RuleCategory.ACCESSIBILITY,
      severity: RuleSeverity.CRITICAL,
      confidence: RuleConfidence.DETERMINISTIC,
      title: 'Image missing alternative text (alt attribute)',
      description: 'The <img> element does not specify an alt attribute.',
      recommendation: 'Add an alt attribute describing the image.',
      standardReference: 'WCAG 1.1.1 (Level A)',
      evidence: {
        selector: 'img#hero',
        tagName: 'img',
        snippet: '<img src="hero.jpg" id="hero">',
        boundingBox: { x: 10, y: 20, width: 200, height: 100 },
        expected: 'alt attribute present',
        observed: 'alt attribute is missing',
      },
    },
    {
      ruleId: 'button-name-present',
      ruleVersion: '1.0.0',
      category: RuleCategory.ACCESSIBILITY,
      severity: RuleSeverity.CRITICAL,
      confidence: RuleConfidence.DETERMINISTIC,
      title: 'Button lacks an accessible name',
      description: 'The <button> has no visible text or label.',
      recommendation: 'Add visible text or aria-label.',
      standardReference: 'WCAG 4.1.2 (Level A)',
      evidence: {
        selector: 'button.icon-close',
        tagName: 'button',
        snippet: '<button class="icon-close"></button>',
        boundingBox: null, // optional bounding box missing
        expected: 'Accessible name present',
        observed: 'No accessible name',
      },
    },
  ];

  beforeEach(async () => {
    mockPrismaService = {
      $transaction: jest.fn(),
      issue: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditFindingsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<AuditFindingsService>(AuditFindingsService);
  });

  describe('persistFindings', () => {
    it('persists findings and evidence atomically within a Prisma transaction', async () => {
      const mockTx = {
        issue: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockResolvedValue({ id: 'mock-issue-id' }),
        },
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      const count = await service.persistFindings(AUDIT_ID, MOCK_FINDINGS);

      expect(count).toBe(2);
      // 1. Verifies idempotency guard: previous issues are deleted
      expect(mockTx.issue.deleteMany).toHaveBeenCalledWith({
        where: { auditId: AUDIT_ID },
      });

      // 2. Verifies issue and evidence creation
      expect(mockTx.issue.create).toHaveBeenCalledTimes(2);

      const firstCallArg = mockTx.issue.create.mock.calls[0][0];
      expect(firstCallArg.data.auditId).toBe(AUDIT_ID);
      expect(firstCallArg.data.category).toBe(RuleCategory.ACCESSIBILITY);
      expect(firstCallArg.data.severity).toBe(RuleSeverity.CRITICAL);
      expect(firstCallArg.data.confidence).toBe('deterministic');
      expect(firstCallArg.data.standardReference).toBe('WCAG 1.1.1 (Level A)');
      expect(firstCallArg.data.evidence.create).toHaveLength(1);
      expect(firstCallArg.data.evidence.create[0].domSelector).toBe('img#hero');
      expect(firstCallArg.data.evidence.create[0].screenshotCropUrl).toBeNull();
      expect(firstCallArg.data.evidence.create[0].highlightedRegion).toEqual({
        x: 10,
        y: 20,
        width: 200,
        height: 100,
      });

      const secondCallArg = mockTx.issue.create.mock.calls[1][0];
      expect(secondCallArg.data.evidence.create[0].domSelector).toBe('button.icon-close');
      expect(secondCallArg.data.evidence.create[0].highlightedRegion).toBe(Prisma.DbNull);
    });

    it('handles empty findings array cleanly (0 issues created, returns 0)', async () => {
      const mockTx = {
        issue: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn(),
        },
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      const count = await service.persistFindings(AUDIT_ID, []);

      expect(count).toBe(0);
      expect(mockTx.issue.deleteMany).toHaveBeenCalledWith({
        where: { auditId: AUDIT_ID },
      });
      expect(mockTx.issue.create).not.toHaveBeenCalled();
    });

    it('rolls back and throws typed AuditOrchestrationError on transaction failure', async () => {
      mockPrismaService.$transaction.mockRejectedValue(
        new Error('Database write deadlock'),
      );

      await expect(
        service.persistFindings(AUDIT_ID, MOCK_FINDINGS),
      ).rejects.toThrow(AuditOrchestrationError);

      await expect(
        service.persistFindings(AUDIT_ID, MOCK_FINDINGS),
      ).rejects.toMatchObject({
        code: AuditOrchestrationErrorCode.PERSISTENCE_FAILED,
        safeMessage: 'Failed to persist audit findings',
      });
    });

    it('throws error when auditId is missing', async () => {
      await expect(service.persistFindings('', MOCK_FINDINGS)).rejects.toThrow(
        AuditOrchestrationError,
      );
    });
  });

  describe('getAuditFindings', () => {
    it('queries issues and evidence for audit ordered by createdAt', async () => {
      mockPrismaService.issue.findMany.mockResolvedValueOnce([
        { id: 'issue-1', auditId: AUDIT_ID, evidence: [] },
      ]);

      const findings = await service.getAuditFindings(AUDIT_ID);
      expect(findings).toHaveLength(1);
      expect(mockPrismaService.issue.findMany).toHaveBeenCalledWith({
        where: { auditId: AUDIT_ID },
        include: { evidence: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  });
});
