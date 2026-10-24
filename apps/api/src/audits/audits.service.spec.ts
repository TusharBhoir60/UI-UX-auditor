import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { AuditsService } from './audits.service';
import { PrismaService } from '../database/prisma.service';
import { AuditQueueService } from '../queue/audit-queue.service';
import { AuditFindingsService } from './audit-findings.service';

describe('AuditsService', () => {
  let service: AuditsService;
  let mockPrismaService: {
    audit: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let mockAuditQueueService: {
    addAuditJob: jest.Mock;
  };
  let mockAuditFindingsService: {
    getAuditFindings: jest.Mock;
    persistFindings: jest.Mock;
  };

  const USER_ID = '11111111-1111-4111-8111-111111111111';
  const AUDIT_ID = '22222222-2222-4222-8222-222222222222';
  const NOW = new Date('2026-10-22T10:00:00.000Z');

  beforeEach(async () => {
    mockPrismaService = {
      audit: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    mockAuditQueueService = {
      addAuditJob: jest.fn().mockResolvedValue(undefined),
    };

    mockAuditFindingsService = {
      getAuditFindings: jest.fn().mockResolvedValue([]),
      persistFindings: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: AuditQueueService,
          useValue: mockAuditQueueService,
        },
        {
          provide: AuditFindingsService,
          useValue: mockAuditFindingsService,
        },
      ],
    }).compile();

    service = module.get<AuditsService>(AuditsService);
  });

  describe('create', () => {
    it('creates an audit record with initial status "queued", enqueues the job, and returns audit_id and status', async () => {
      mockPrismaService.audit.create.mockResolvedValueOnce({
        id: AUDIT_ID,
        status: 'queued',
      });

      const result = await service.create(USER_ID, {
        url: 'https://example.com',
      });

      expect(mockPrismaService.audit.create).toHaveBeenCalledWith({
        data: {
          userId: USER_ID,
          url: 'https://example.com',
          status: 'queued',
        },
        select: {
          id: true,
          status: true,
        },
      });

      expect(mockAuditQueueService.addAuditJob).toHaveBeenCalledWith(AUDIT_ID);

      expect(result).toEqual({
        audit_id: AUDIT_ID,
        status: 'queued',
      });
    });

    it('derives ownership strictly from the userId parameter', async () => {
      mockPrismaService.audit.create.mockResolvedValueOnce({
        id: AUDIT_ID,
        status: 'queued',
      });

      await service.create(USER_ID, { url: 'https://example.com' });

      expect(mockPrismaService.audit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER_ID,
          }),
        }),
      );
    });

    it('handles persistence errors safely without exposing internal database details or calling queue', async () => {
      mockPrismaService.audit.create.mockRejectedValueOnce(
        new Error('FATAL: connection to PostgreSQL server lost (sensitive connection details)'),
      );

      await expect(
        service.create(USER_ID, { url: 'https://example.com' }),
      ).rejects.toThrow(new InternalServerErrorException('Failed to create audit'));

      expect(mockAuditQueueService.addAuditJob).not.toHaveBeenCalled();
    });

    it('marks audit as failed with observable failure reason and throws 500 when queue enqueue fails', async () => {
      mockPrismaService.audit.create.mockResolvedValueOnce({
        id: AUDIT_ID,
        status: 'queued',
      });
      mockAuditQueueService.addAuditJob.mockRejectedValueOnce(
        new Error('Redis connection timed out at 10.0.0.1:6379 with auth pass=secret'),
      );
      mockPrismaService.audit.updateMany.mockResolvedValueOnce({ count: 1 });

      await expect(
        service.create(USER_ID, { url: 'https://example.com' }),
      ).rejects.toThrow(
        new InternalServerErrorException('Failed to enqueue audit for processing'),
      );

      expect(mockPrismaService.audit.updateMany).toHaveBeenCalledWith({
        where: {
          id: AUDIT_ID,
          status: 'queued',
        },
        data: {
          status: 'failed',
          failureReason: 'Failed to enqueue audit for processing',
          completedAt: expect.any(Date),
        },
      });
    });

    it('still throws InternalServerErrorException even if the compensating database update fails', async () => {
      mockPrismaService.audit.create.mockResolvedValueOnce({
        id: AUDIT_ID,
        status: 'queued',
      });
      mockAuditQueueService.addAuditJob.mockRejectedValueOnce(
        new Error('Redis down'),
      );
      mockPrismaService.audit.updateMany.mockRejectedValueOnce(
        new Error('Database disconnected during compensation'),
      );

      await expect(
        service.create(USER_ID, { url: 'https://example.com' }),
      ).rejects.toThrow(
        new InternalServerErrorException('Failed to enqueue audit for processing'),
      );
    });
  });

  describe('findAll', () => {
    it('returns only audits owned by the user, ordered by createdAt descending', async () => {
      const mockAudits = [
        {
          id: AUDIT_ID,
          url: 'https://example.com/2',
          status: 'queued',
          createdAt: NOW,
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          url: 'https://example.com/1',
          status: 'complete',
          createdAt: new Date('2026-10-22T09:00:00.000Z'),
        },
      ];

      mockPrismaService.audit.findMany.mockResolvedValueOnce(mockAudits);

      const result = await service.findAll(USER_ID);

      expect(mockPrismaService.audit.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          url: true,
          status: true,
          createdAt: true,
        },
      });

      expect(result).toEqual([
        {
          audit_id: AUDIT_ID,
          url: 'https://example.com/2',
          status: 'queued',
          created_at: NOW.toISOString(),
          summary_counts: null,
        },
        {
          audit_id: '33333333-3333-4333-8333-333333333333',
          url: 'https://example.com/1',
          status: 'complete',
          created_at: '2026-10-22T09:00:00.000Z',
          summary_counts: null,
        },
      ]);
    });

    it('returns empty array when user has no audits', async () => {
      mockPrismaService.audit.findMany.mockResolvedValueOnce([]);

      const result = await service.findAll(USER_ID);

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('returns audit detail strictly scoped to user and auditId', async () => {
      mockPrismaService.audit.findFirst.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: 'https://example.com',
        status: 'queued',
        failureReason: null,
        createdAt: NOW,
        completedAt: null,
      });

      const result = await service.findOne(USER_ID, AUDIT_ID);

      expect(mockPrismaService.audit.findFirst).toHaveBeenCalledWith({
        where: {
          id: AUDIT_ID,
          userId: USER_ID,
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

      expect(result).toEqual({
        audit_id: AUDIT_ID,
        url: 'https://example.com',
        status: 'queued',
        failure_reason: null,
        created_at: NOW.toISOString(),
        completed_at: null,
        report: null,
      });
    });

    it('throws 404 NotFoundException when audit does not exist', async () => {
      mockPrismaService.audit.findFirst.mockResolvedValueOnce(null);

      await expect(service.findOne(USER_ID, AUDIT_ID)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne(USER_ID, AUDIT_ID)).rejects.toThrow(
        'Audit not found',
      );
    });

    it('throws identical 404 NotFoundException when audit is owned by another user', async () => {
      // Because query enforces id AND userId, another user's audit returns null
      mockPrismaService.audit.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.findOne('another-user-id', AUDIT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStatus', () => {
    it('returns lightweight status with stage "queued" and failure_reason', async () => {
      mockPrismaService.audit.findFirst.mockResolvedValueOnce({
        status: 'queued',
        failureReason: null,
      });

      const result = await service.getStatus(USER_ID, AUDIT_ID);

      expect(mockPrismaService.audit.findFirst).toHaveBeenCalledWith({
        where: {
          id: AUDIT_ID,
          userId: USER_ID,
        },
        select: {
          status: true,
          failureReason: true,
        },
      });

      expect(result).toEqual({
        status: 'queued',
        stage: 'queued',
        failure_reason: null,
      });
    });

    it('throws 404 NotFoundException when audit is not found or not owned by user', async () => {
      mockPrismaService.audit.findFirst.mockResolvedValueOnce(null);

      await expect(service.getStatus(USER_ID, AUDIT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getResults', () => {
    const COMPLETED_AT = new Date('2026-10-22T10:02:00.000Z');

    it('throws 404 NotFoundException when audit is not found or owned by another user', async () => {
      mockPrismaService.audit.findFirst.mockResolvedValueOnce(null);

      await expect(service.getResults(USER_ID, AUDIT_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrismaService.audit.findFirst).toHaveBeenCalledWith({
        where: {
          id: AUDIT_ID,
          userId: USER_ID,
        },
        select: expect.any(Object),
      });
    });

    it('throws InternalServerErrorException when audit database query fails', async () => {
      mockPrismaService.audit.findFirst.mockRejectedValueOnce(
        new Error('PostgreSQL connection drop'),
      );

      await expect(service.getResults(USER_ID, AUDIT_ID)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('throws InternalServerErrorException when findings lookup fails', async () => {
      mockPrismaService.audit.findFirst.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: 'https://example.com',
        status: 'complete',
        failureReason: null,
        createdAt: NOW,
        completedAt: COMPLETED_AT,
      });
      mockAuditFindingsService.getAuditFindings.mockRejectedValueOnce(
        new Error('Findings query error'),
      );

      await expect(service.getResults(USER_ID, AUDIT_ID)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('returns completed results with aggregated severity and category counts and evidence', async () => {
      mockPrismaService.audit.findFirst.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: 'https://example.com',
        status: 'complete',
        failureReason: null,
        createdAt: NOW,
        completedAt: COMPLETED_AT,
      });

      const mockIssues = [
        {
          id: 'issue-1',
          auditId: AUDIT_ID,
          category: 'accessibility',
          title: 'Button missing accessible name',
          description: '<button> has no inner text or aria label',
          severity: 'Critical',
          confidence: 'deterministic',
          standardReference: 'WCAG 4.1.2',
          recommendation: 'Add accessible name',
          status: 'open',
          createdAt: new Date('2026-10-22T10:01:00.000Z'),
          evidence: [
            {
              id: 'ev-1',
              issueId: 'issue-1',
              domSelector: 'button#submit',
              snippet: '<button id="submit"></button>',
              highlightedRegion: { x: 10, y: 20, width: 100, height: 40 },
              screenshotCropUrl: null,
              createdAt: new Date('2026-10-22T10:01:00.000Z'),
            },
          ],
        },
        {
          id: 'issue-2',
          auditId: AUDIT_ID,
          category: 'accessibility',
          title: 'Insufficient text contrast',
          description: 'Text contrast ratio is below 4.5:1',
          severity: 'High',
          confidence: 'deterministic',
          standardReference: 'WCAG 1.4.3',
          recommendation: 'Increase contrast',
          status: 'open',
          createdAt: new Date('2026-10-22T10:01:01.000Z'),
          evidence: [],
        },
        {
          id: 'issue-3',
          auditId: AUDIT_ID,
          category: 'visual',
          title: 'Heading level skipped',
          description: 'Heading skipped from h1 to h3',
          severity: 'Low',
          confidence: 'deterministic',
          standardReference: 'WCAG 1.3.1',
          recommendation: 'Use sequential headings',
          status: 'open',
          createdAt: new Date('2026-10-22T10:01:02.000Z'),
          evidence: [
            {
              id: 'ev-2',
              issueId: 'issue-3',
              domSelector: 'h3',
              snippet: '<h3>Subheading</h3>',
              highlightedRegion: null,
              screenshotCropUrl: null,
              createdAt: new Date('2026-10-22T10:01:02.000Z'),
            },
          ],
        },
      ];

      mockAuditFindingsService.getAuditFindings.mockResolvedValueOnce(mockIssues);

      const result = await service.getResults(USER_ID, AUDIT_ID);

      expect(result.audit_id).toBe(AUDIT_ID);
      expect(result.url).toBe('https://example.com');
      expect(result.status).toBe('complete');
      expect(result.failure_reason).toBeNull();
      expect(result.created_at).toBe(NOW.toISOString());
      expect(result.completed_at).toBe(COMPLETED_AT.toISOString());

      // Check aggregated summary counts
      expect(result.summary).toEqual({
        total: 3,
        by_severity: {
          Critical: 1,
          High: 1,
          Medium: 0,
          Low: 1,
        },
        by_category: {
          accessibility: 2,
          visual: 1,
          usability: 0,
        },
      });

      // Check issues and evidence mapping
      expect(result.issues).toHaveLength(3);
      expect(result.issues[0]).toEqual({
        id: 'issue-1',
        audit_id: AUDIT_ID,
        category: 'accessibility',
        title: 'Button missing accessible name',
        description: '<button> has no inner text or aria label',
        severity: 'Critical',
        confidence: 'deterministic',
        standard_reference: 'WCAG 4.1.2',
        recommendation: 'Add accessible name',
        status: 'open',
        created_at: new Date('2026-10-22T10:01:00.000Z').toISOString(),
        evidence: [
          {
            id: 'ev-1',
            issue_id: 'issue-1',
            dom_selector: 'button#submit',
            snippet: '<button id="submit"></button>',
            highlighted_region: { x: 10, y: 20, width: 100, height: 40 },
            screenshot_crop_url: null,
            created_at: new Date('2026-10-22T10:01:00.000Z').toISOString(),
          },
        ],
      });
      expect(result.issues[1].evidence).toEqual([]);
      expect(result.issues[2].evidence[0].highlighted_region).toBeNull();
    });

    it('returns valid empty collection and zero counts for a completed audit with zero findings', async () => {
      mockPrismaService.audit.findFirst.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: 'https://clean-site.example.com',
        status: 'complete',
        failureReason: null,
        createdAt: NOW,
        completedAt: COMPLETED_AT,
      });
      mockAuditFindingsService.getAuditFindings.mockResolvedValueOnce([]);

      const result = await service.getResults(USER_ID, AUDIT_ID);

      expect(result.status).toBe('complete');
      expect(result.failure_reason).toBeNull();
      expect(result.summary).toEqual({
        total: 0,
        by_severity: {
          Critical: 0,
          High: 0,
          Medium: 0,
          Low: 0,
        },
        by_category: {
          accessibility: 0,
          visual: 0,
          usability: 0,
        },
      });
      expect(result.issues).toEqual([]);
    });

    it('handles queued audits explicitly with status "queued" and null completed_at', async () => {
      mockPrismaService.audit.findFirst.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: 'https://example.com',
        status: 'queued',
        failureReason: null,
        createdAt: NOW,
        completedAt: null,
      });
      mockAuditFindingsService.getAuditFindings.mockResolvedValueOnce([]);

      const result = await service.getResults(USER_ID, AUDIT_ID);

      expect(result.status).toBe('queued');
      expect(result.completed_at).toBeNull();
      expect(result.summary.total).toBe(0);
      expect(result.issues).toEqual([]);
    });

    it('handles running audits explicitly without misrepresenting them as complete', async () => {
      mockPrismaService.audit.findFirst.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: 'https://example.com',
        status: 'running',
        failureReason: null,
        createdAt: NOW,
        completedAt: null,
      });
      mockAuditFindingsService.getAuditFindings.mockResolvedValueOnce([]);

      const result = await service.getResults(USER_ID, AUDIT_ID);

      expect(result.status).toBe('running');
      expect(result.completed_at).toBeNull();
    });

    it('handles failed audits and does not report them as complete even if findings exist', async () => {
      const FAILED_AT = new Date('2026-10-22T10:01:30.000Z');
      mockPrismaService.audit.findFirst.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: 'https://example.com',
        status: 'failed',
        failureReason: 'Failed to complete audit after rule evaluation',
        createdAt: NOW,
        completedAt: FAILED_AT,
      });

      // Findings were saved before terminal completion step failed
      const existingFindings = [
        {
          id: 'issue-saved-before-failure',
          auditId: AUDIT_ID,
          category: 'accessibility',
          title: 'Document missing title',
          description: '<title> missing',
          severity: 'Critical',
          confidence: 'deterministic',
          standardReference: 'WCAG 2.4.2',
          recommendation: 'Add <title>',
          status: 'open',
          createdAt: NOW,
          evidence: [],
        },
      ];
      mockAuditFindingsService.getAuditFindings.mockResolvedValueOnce(existingFindings);

      const result = await service.getResults(USER_ID, AUDIT_ID);

      // Status remains authoritative from the database
      expect(result.status).toBe('failed');
      expect(result.failure_reason).toBe(
        'Failed to complete audit after rule evaluation',
      );
      expect(result.completed_at).toBe(FAILED_AT.toISOString());
      expect(result.summary.total).toBe(1);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].id).toBe('issue-saved-before-failure');
    });
  });
});
