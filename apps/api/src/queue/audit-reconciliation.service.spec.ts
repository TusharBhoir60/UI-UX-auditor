import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuditReconciliationService } from './audit-reconciliation.service';
import { AuditQueueService } from './audit-queue.service';
import { PrismaService } from '../database/prisma.service';

describe('AuditReconciliationService', () => {
  let service: AuditReconciliationService;
  let mockPrismaService: {
    audit: {
      findMany: jest.Mock;
    };
  };
  let mockQueueService: {
    reconcileAuditJob: jest.Mock;
  };
  let mockConfigService: {
    get: jest.Mock;
  };

  const STALE_AUDIT_1 = '11111111-1111-4111-8111-111111111111';
  const STALE_AUDIT_2 = '22222222-2222-4222-8222-222222222222';

  beforeEach(async () => {
    mockPrismaService = {
      audit: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    mockQueueService = {
      reconcileAuditJob: jest.fn().mockResolvedValue('enqueued'),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'AUDIT_RECONCILIATION_INTERVAL_MS') return 0; // disabled in test setup
        if (key === 'AUDIT_RECONCILIATION_STALE_THRESHOLD_MS') return 300000; // 5 min
        if (key === 'AUDIT_RECONCILIATION_BATCH_SIZE') return 50;
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditReconciliationService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: AuditQueueService,
          useValue: mockQueueService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AuditReconciliationService>(AuditReconciliationService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('reconcileStaleAudits', () => {
    it('discovers stale audits with status "queued" created before cutoff and dispatches them', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const staleDate = new Date(now - 400000);
      mockPrismaService.audit.findMany.mockResolvedValueOnce([
        { id: STALE_AUDIT_1, createdAt: staleDate },
        { id: STALE_AUDIT_2, createdAt: staleDate },
      ]);

      const summary = await service.reconcileStaleAudits();

      expect(mockPrismaService.audit.findMany).toHaveBeenCalledWith({
        where: {
          status: 'queued',
          createdAt: {
            lte: new Date(now - 300000),
          },
        },
        take: 50,
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
          createdAt: true,
        },
      });

      expect(mockQueueService.reconcileAuditJob).toHaveBeenCalledTimes(2);
      expect(mockQueueService.reconcileAuditJob).toHaveBeenNthCalledWith(1, STALE_AUDIT_1);
      expect(mockQueueService.reconcileAuditJob).toHaveBeenNthCalledWith(2, STALE_AUDIT_2);

      expect(summary).toEqual({
        scanned: 2,
        reEnqueued: 2,
        alreadyQueued: 0,
        alreadyActive: 0,
        errors: 0,
        skipped: false,
      });

      jest.restoreAllMocks();
    });

    it('enforces bounded batch size using the configured batchSize limit', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'AUDIT_RECONCILIATION_BATCH_SIZE') return 10;
        if (key === 'AUDIT_RECONCILIATION_STALE_THRESHOLD_MS') return 60000;
        return defaultValue;
      });

      const boundedService = new AuditReconciliationService(
        mockPrismaService as unknown as PrismaService,
        mockQueueService as unknown as AuditQueueService,
        mockConfigService as unknown as ConfigService,
      );

      await boundedService.reconcileStaleAudits();

      expect(mockPrismaService.audit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
        }),
      );
    });

    it('returns clean summary when no stale audits exist', async () => {
      mockPrismaService.audit.findMany.mockResolvedValueOnce([]);

      const summary = await service.reconcileStaleAudits();

      expect(summary).toEqual({
        scanned: 0,
        reEnqueued: 0,
        alreadyQueued: 0,
        alreadyActive: 0,
        errors: 0,
        skipped: false,
      });
      expect(mockQueueService.reconcileAuditJob).not.toHaveBeenCalled();
    });

    describe('BullMQ duplicate job state handling', () => {
      it('accurately counts already_waiting and already_active jobs without error', async () => {
        mockPrismaService.audit.findMany.mockResolvedValueOnce([
          { id: STALE_AUDIT_1, createdAt: new Date() },
          { id: STALE_AUDIT_2, createdAt: new Date() },
        ]);

        mockQueueService.reconcileAuditJob
          .mockResolvedValueOnce('already_waiting')
          .mockResolvedValueOnce('already_active');

        const summary = await service.reconcileStaleAudits();

        expect(summary).toEqual({
          scanned: 2,
          reEnqueued: 0,
          alreadyQueued: 1,
          alreadyActive: 1,
          errors: 0,
          skipped: false,
        });
      });
    });

    describe('infrastructure resilience and error isolation', () => {
      it('handles database query failure safely without crashing and records errors', async () => {
        mockPrismaService.audit.findMany.mockRejectedValueOnce(
          new Error('FATAL: connection to PostgreSQL server lost (credentials: user:secret@db)'),
        );

        const summary = await service.reconcileStaleAudits();

        expect(summary).toEqual({
          scanned: 0,
          reEnqueued: 0,
          alreadyQueued: 0,
          alreadyActive: 0,
          errors: 1,
          skipped: false,
        });
        expect(service.getIsReconciling()).toBe(false);
      });

      it('handles Redis error per audit safely without aborting remaining batch', async () => {
        mockPrismaService.audit.findMany.mockResolvedValueOnce([
          { id: STALE_AUDIT_1, createdAt: new Date() },
          { id: STALE_AUDIT_2, createdAt: new Date() },
        ]);

        mockQueueService.reconcileAuditJob
          .mockRejectedValueOnce(new Error('Redis connection timeout redis://admin:pass@host:6379'))
          .mockResolvedValueOnce('enqueued');

        const summary = await service.reconcileStaleAudits();

        expect(summary).toEqual({
          scanned: 2,
          reEnqueued: 1,
          alreadyQueued: 0,
          alreadyActive: 0,
          errors: 1,
          skipped: false,
        });
        expect(service.getIsReconciling()).toBe(false);
      });

      it('prevents overlapping reconciliation runs within the same process', async () => {
        let resolveQuery: (value: any) => void;
        const queryPromise = new Promise((resolve) => {
          resolveQuery = resolve;
        });

        mockPrismaService.audit.findMany.mockReturnValueOnce(queryPromise);

        // Start first run
        const firstRunPromise = service.reconcileStaleAudits();

        // Attempt second run while first is in-flight
        const secondRunResult = await service.reconcileStaleAudits();

        expect(secondRunResult).toEqual({
          scanned: 0,
          reEnqueued: 0,
          alreadyQueued: 0,
          alreadyActive: 0,
          errors: 0,
          skipped: true,
        });

        // Resolve first run
        resolveQuery!([]);
        const firstRunResult = await firstRunPromise;
        expect(firstRunResult.skipped).toBe(false);
      });
    });

    describe('exclusion of non-queued audits', () => {
      it('strictly queries audits where status is "queued", excluding running, complete, and failed', async () => {
        await service.reconcileStaleAudits();

        expect(mockPrismaService.audit.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: 'queued',
            }),
          }),
        );
      });
    });
  });

  describe('lifecycle (onModuleInit / onModuleDestroy)', () => {
    it('sets up recurring interval when AUDIT_RECONCILIATION_INTERVAL_MS > 0', () => {
      jest.useFakeTimers();

      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'AUDIT_RECONCILIATION_INTERVAL_MS') return 15000;
        return defaultValue;
      });

      const timerService = new AuditReconciliationService(
        mockPrismaService as unknown as PrismaService,
        mockQueueService as unknown as AuditQueueService,
        mockConfigService as unknown as ConfigService,
      );

      const reconcileSpy = jest
        .spyOn(timerService, 'reconcileStaleAudits')
        .mockResolvedValue({
          scanned: 0,
          reEnqueued: 0,
          alreadyQueued: 0,
          alreadyActive: 0,
          errors: 0,
          skipped: false,
        });

      timerService.onModuleInit();

      expect(reconcileSpy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(15000);
      expect(reconcileSpy).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(15000);
      expect(reconcileSpy).toHaveBeenCalledTimes(2);

      timerService.onModuleDestroy();
      jest.advanceTimersByTime(15000);
      expect(reconcileSpy).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('does not schedule timer when AUDIT_RECONCILIATION_INTERVAL_MS is 0', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      service.onModuleInit();

      expect(setIntervalSpy).not.toHaveBeenCalled();
      setIntervalSpy.mockRestore();
    });
  });
});
