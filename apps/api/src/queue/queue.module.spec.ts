import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueModule } from './queue.module';
import { AuditQueueService } from './audit-queue.service';
import { AuditWorkerProcessor } from './audit-worker.processor';
import { AuditsModule } from '../audits/audits.module';
import { PrismaService } from '../database/prisma.service';
import { CaptureService } from '../capture/capture.service';
import {
  AUDIT_QUEUE_TOKEN,
  AUDIT_WORKER_TOKEN,
} from './queue.constants';

describe('QueueModule Dependency Injection', () => {
  let module: TestingModule;

  beforeEach(async () => {
    const mockQueue = {
      add: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn().mockReturnThis(),
    };

    const mockWorker = {
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn().mockReturnThis(),
    };

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
              JWT_SECRET: 'test-secret-at-least-32-chars-long-security',
              REDIS_HOST: 'localhost',
              REDIS_PORT: 6379,
            }),
          ],
        }),
        AuditsModule,
        QueueModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({
        audit: {
          create: jest.fn(),
          findUnique: jest.fn(),
          updateMany: jest.fn(),
        },
      })
      .overrideProvider(CaptureService)
      .useValue({
        capture: jest.fn(),
      })
      .overrideProvider(AUDIT_QUEUE_TOKEN)
      .useValue(mockQueue)
      .overrideProvider(AUDIT_WORKER_TOKEN)
      .useValue(mockWorker)
      .compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('compiles and resolves AuditQueueService and AuditWorkerProcessor', () => {
    const queueService = module.get<AuditQueueService>(AuditQueueService);
    const workerProcessor = module.get<AuditWorkerProcessor>(AuditWorkerProcessor);

    expect(queueService).toBeDefined();
    expect(queueService).toBeInstanceOf(AuditQueueService);

    expect(workerProcessor).toBeDefined();
    expect(workerProcessor).toBeInstanceOf(AuditWorkerProcessor);
  });
});
