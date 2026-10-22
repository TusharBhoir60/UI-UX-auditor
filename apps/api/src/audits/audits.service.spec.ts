import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { AuditsService } from './audits.service';
import { PrismaService } from '../database/prisma.service';
import { AuditQueueService } from '../queue/audit-queue.service';

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
});
