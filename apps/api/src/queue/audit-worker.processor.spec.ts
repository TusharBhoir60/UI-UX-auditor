import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { AuditWorkerProcessor } from './audit-worker.processor';
import { AuditOrchestratorService } from '../audits/audit-orchestrator.service';
import {
  AuditOrchestrationError,
  AuditOrchestrationErrorCode,
} from '../audits/audit-orchestrator.types';
import {
  AUDIT_QUEUE_NAME,
  AUDIT_WORKER_TOKEN,
} from './queue.constants';
import { AuditJobData } from './queue.types';

describe('AuditWorkerProcessor', () => {
  let processor: AuditWorkerProcessor;
  let mockOrchestrator: {
    processAudit: jest.Mock;
  };
  let mockConfigService: {
    get: jest.Mock;
  };
  let mockWorker: {
    close: jest.Mock;
    on: jest.Mock;
  };

  const AUDIT_ID = '44444444-4444-4444-8444-444444444444';

  function createMockJob(data: Partial<AuditJobData> = { auditId: AUDIT_ID }): Job<AuditJobData> {
    return {
      id: 'job-123',
      data: data as AuditJobData,
    } as unknown as Job<AuditJobData>;
  }

  beforeEach(async () => {
    mockOrchestrator = {
      processAudit: jest.fn().mockResolvedValue({
        auditId: AUDIT_ID,
        status: 'complete',
        captureMetadata: {},
      }),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'REDIS_HOST') return 'redis.test.internal';
        if (key === 'REDIS_PORT') return 6379;
        return defaultValue;
      }),
    };

    mockWorker = {
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditWorkerProcessor,
        {
          provide: AuditOrchestratorService,
          useValue: mockOrchestrator,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: AUDIT_WORKER_TOKEN,
          useValue: mockWorker,
        },
      ],
    }).compile();

    processor = module.get<AuditWorkerProcessor>(AuditWorkerProcessor);
  });

  describe('processJob', () => {
    it('invokes AuditOrchestratorService.processAudit strictly with the stored auditId', async () => {
      const job = createMockJob({ auditId: AUDIT_ID });
      await processor.processJob(job);

      expect(mockOrchestrator.processAudit).toHaveBeenCalledTimes(1);
      expect(mockOrchestrator.processAudit).toHaveBeenCalledWith(AUDIT_ID);
    });

    it('ignores invalid job payloads missing auditId without invoking orchestrator', async () => {
      const job = createMockJob({ auditId: undefined as unknown as string });
      await processor.processJob(job);

      expect(mockOrchestrator.processAudit).not.toHaveBeenCalled();
    });

    it('ignores non-string auditId payloads safely', async () => {
      const job = createMockJob({ auditId: 12345 as unknown as string });
      await processor.processJob(job);

      expect(mockOrchestrator.processAudit).not.toHaveBeenCalled();
    });

    describe('duplicate delivery & state machine idempotency', () => {
      it('safely handles duplicate delivery when audit is already running, complete, or failed (INVALID_STATE_TRANSITION)', async () => {
        mockOrchestrator.processAudit.mockRejectedValueOnce(
          new AuditOrchestrationError(
            AuditOrchestrationErrorCode.INVALID_STATE_TRANSITION,
            "Audit cannot transition from 'complete' to 'running'",
            'complete',
          ),
        );

        const job = createMockJob({ auditId: AUDIT_ID });
        // Must resolve cleanly without throwing to acknowledge and drop the duplicate job
        await expect(processor.processJob(job)).resolves.toBeUndefined();
      });

      it('safely handles concurrent conflict when claimed by another worker (CONCURRENT_CONFLICT)', async () => {
        mockOrchestrator.processAudit.mockRejectedValueOnce(
          new AuditOrchestrationError(
            AuditOrchestrationErrorCode.CONCURRENT_CONFLICT,
            'Failed to claim audit: claimed by a concurrent process',
            'running',
          ),
        );

        const job = createMockJob({ auditId: AUDIT_ID });
        await expect(processor.processJob(job)).resolves.toBeUndefined();
      });

      it('safely handles missing audit row (AUDIT_NOT_FOUND) without re-throwing', async () => {
        mockOrchestrator.processAudit.mockRejectedValueOnce(
          new AuditOrchestrationError(
            AuditOrchestrationErrorCode.AUDIT_NOT_FOUND,
            `Audit ${AUDIT_ID} was not found`,
          ),
        );

        const job = createMockJob({ auditId: AUDIT_ID });
        await expect(processor.processJob(job)).resolves.toBeUndefined();
      });

      it('rethrows PERSISTENCE_FAILED so BullMQ records job failure', async () => {
        const persistenceErr = new AuditOrchestrationError(
          AuditOrchestrationErrorCode.PERSISTENCE_FAILED,
          'Failed to claim audit due to database error',
        );
        mockOrchestrator.processAudit.mockRejectedValueOnce(persistenceErr);

        const job = createMockJob({ auditId: AUDIT_ID });
        await expect(processor.processJob(job)).rejects.toThrow(persistenceErr);
      });
    });

    describe('error sanitization and safe logging', () => {
      it('sanitizes unexpected errors and redacts credentials, raw target URLs, or secrets', async () => {
        mockOrchestrator.processAudit.mockRejectedValueOnce(
          new Error(
            'Failed to connect to https://user:secretpass@internal.service.local/api/v1',
          ),
        );

        const job = createMockJob({ auditId: AUDIT_ID });
        await expect(processor.processJob(job)).rejects.toThrow(
          expect.not.stringContaining('secretpass'),
        );
      });

      it('does NOT mark a completed audit as failed in worker logic', async () => {
        mockOrchestrator.processAudit.mockResolvedValueOnce({
          auditId: AUDIT_ID,
          status: 'complete',
          captureMetadata: {},
        });

        const job = createMockJob({ auditId: AUDIT_ID });
        await processor.processJob(job);

        // Status is completely owned by orchestrator; worker does not update DB
        expect(mockOrchestrator.processAudit).toHaveBeenCalledWith(AUDIT_ID);
      });
    });
  });

  describe('lifecycle', () => {
    it('closes the worker connection during shutdown', async () => {
      await processor.onModuleDestroy();
      expect(mockWorker.close).toHaveBeenCalledTimes(1);
    });

    it('handles worker close failure safely during shutdown', async () => {
      mockWorker.close.mockRejectedValueOnce(new Error('Worker close timeout'));
      await expect(processor.onModuleDestroy()).resolves.toBeUndefined();
    });

    it('skips worker initialization when WORKER_ENABLED is false', () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'WORKER_ENABLED') return false;
        return defaultValue;
      });

      const liveProcessor = new AuditWorkerProcessor(
        mockOrchestrator as unknown as AuditOrchestratorService,
        mockConfigService as unknown as ConfigService,
      );
      liveProcessor.onModuleInit();
      expect(liveProcessor.getWorker()).toBeUndefined();
    });

    it('initializes a default worker and registers event listeners when not injected', () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'WORKER_ENABLED') return true;
        if (key === 'REDIS_HOST') return 'localhost';
        if (key === 'REDIS_PORT') return 6379;
        return defaultValue;
      });

      const liveProcessor = new AuditWorkerProcessor(
        mockOrchestrator as unknown as AuditOrchestratorService,
        mockConfigService as unknown as ConfigService,
      );
      liveProcessor.onModuleInit();
      const worker = liveProcessor.getWorker();
      expect(worker).toBeDefined();
      expect(worker?.name).toBe(AUDIT_QUEUE_NAME);
      // clean up
      worker?.close();
    });
  });
});
