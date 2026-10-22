import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { AuditQueueService } from './audit-queue.service';
import {
  AUDIT_JOB_NAME,
  AUDIT_QUEUE_NAME,
  AUDIT_QUEUE_TOKEN,
} from './queue.constants';
import { AuditJobData } from './queue.types';

describe('AuditQueueService', () => {
  let service: AuditQueueService;
  let mockQueue: {
    add: jest.Mock;
    close: jest.Mock;
    on: jest.Mock;
  };
  let mockConfigService: {
    get: jest.Mock;
  };

  const AUDIT_ID = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: AUDIT_ID }),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn().mockReturnThis(),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'REDIS_HOST') return 'redis.test.internal';
        if (key === 'REDIS_PORT') return 6380;
        if (key === 'REDIS_PASSWORD') return 'test-password';
        if (key === 'REDIS_TLS') return true;
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditQueueService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: AUDIT_QUEUE_TOKEN,
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<AuditQueueService>(AuditQueueService);
  });

  describe('addAuditJob', () => {
    it('dispatches an audit job with auditId as stable jobId, attempts=1, and bounded retention', async () => {
      await service.addAuditJob(AUDIT_ID);

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith(
        AUDIT_JOB_NAME,
        {
          auditId: AUDIT_ID,
          createdAt: expect.any(String),
        },
        {
          jobId: AUDIT_ID,
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
    });

    it('uses auditId for duplicate enqueue attempts preventing duplicate job IDs', async () => {
      await service.addAuditJob(AUDIT_ID);
      await service.addAuditJob(AUDIT_ID);

      expect(mockQueue.add).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenNthCalledWith(
        1,
        AUDIT_JOB_NAME,
        expect.objectContaining({ auditId: AUDIT_ID }),
        expect.objectContaining({ jobId: AUDIT_ID }),
      );
      expect(mockQueue.add).toHaveBeenNthCalledWith(
        2,
        AUDIT_JOB_NAME,
        expect.objectContaining({ auditId: AUDIT_ID }),
        expect.objectContaining({ jobId: AUDIT_ID }),
      );
    });

    it('sanitizes and rethrows errors when queue.add fails', async () => {
      mockQueue.add.mockRejectedValueOnce(
        new Error('connect ECONNREFUSED redis://admin:supersecret@127.0.0.1:6379'),
      );

      await expect(service.addAuditJob(AUDIT_ID)).rejects.toThrow(
        /connect ECONNREFUSED/,
      );
    });

    it('throws when queue is not initialized', async () => {
      const uninitService = new AuditQueueService(
        mockConfigService as unknown as ConfigService,
      );

      await expect(uninitService.addAuditJob(AUDIT_ID)).rejects.toThrow(
        'Audit queue is not initialized',
      );
    });
  });

  describe('lifecycle (onModuleInit / onModuleDestroy)', () => {
    it('closes the queue connection during graceful shutdown', async () => {
      await service.onModuleDestroy();
      expect(mockQueue.close).toHaveBeenCalledTimes(1);
    });

    it('handles queue close failure safely during shutdown without crashing', async () => {
      mockQueue.close.mockRejectedValueOnce(new Error('Connection abort'));
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });

    it('initializes a default queue instance and registers error listener when not injected', () => {
      const liveModule = new AuditQueueService(
        mockConfigService as unknown as ConfigService,
      );
      liveModule.onModuleInit();
      const q = liveModule.getQueue();
      expect(q).toBeDefined();
      expect(q?.name).toBe(AUDIT_QUEUE_NAME);
      // clean up
      q?.close();
    });
  });
});
