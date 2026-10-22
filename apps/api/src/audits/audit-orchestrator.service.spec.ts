import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { CaptureService } from '../capture/capture.service';
import {
  CaptureError,
  CaptureErrorCode,
  CaptureResult,
} from '../capture/capture.types';
import { AuditOrchestratorService } from './audit-orchestrator.service';
import {
  AuditOrchestrationError,
  AuditOrchestrationErrorCode,
  AuditState,
} from './audit-orchestrator.types';

describe('AuditOrchestratorService', () => {
  let service: AuditOrchestratorService;
  let mockPrismaService: {
    audit: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let mockCaptureService: {
    capture: jest.Mock;
  };

  const AUDIT_ID = '11111111-2222-3333-4444-555555555555';
  const STORED_URL = 'https://example.com/audit';

  const MOCK_CAPTURE_RESULT: CaptureResult = {
    success: true,
    metadata: {
      captureTimestamp: new Date().toISOString(),
      durationMs: 450,
      viewport: { width: 1280, height: 800 },
      initialUrl: STORED_URL,
      finalUrl: STORED_URL,
      resolvedIps: ['93.184.216.34'],
      redirectCount: 0,
      domElementCount: 15,
      screenshotSizeBytes: 4096,
      domSizeBytes: 1024,
      computedStylesCount: 10,
    },
    screenshot: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    domSnapshot: '<html><body>Test</body></html>',
    computedStyles: [],
    validatedDestination: {
      originalUrl: STORED_URL,
      normalizedUrl: STORED_URL,
      scheme: 'https',
      hostname: 'example.com',
      port: 443,
      resolvedIps: ['93.184.216.34'],
      isIpLiteral: false,
    },
  };

  beforeEach(async () => {
    mockPrismaService = {
      audit: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    mockCaptureService = {
      capture: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditOrchestratorService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: CaptureService,
          useValue: mockCaptureService,
        },
      ],
    }).compile();

    service = module.get<AuditOrchestratorService>(AuditOrchestratorService);
  });

  describe('Happy Path & Valid State Transitions', () => {
    it('successfully transitions queued audit to running, executes capture, and transitions to complete', async () => {
      // 1. Audit found in 'queued' state
      mockPrismaService.audit.findUnique.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: STORED_URL,
        status: AuditState.QUEUED,
      });

      // 2. Atomic claim succeeds
      mockPrismaService.audit.updateMany
        .mockResolvedValueOnce({ count: 1 }) // claim update
        .mockResolvedValueOnce({ count: 1 }); // completion update

      // 3. Capture service succeeds
      mockCaptureService.capture.mockResolvedValueOnce(MOCK_CAPTURE_RESULT);

      const result = await service.processAudit(AUDIT_ID);

      // Verify DB lookup
      expect(mockPrismaService.audit.findUnique).toHaveBeenCalledWith({
        where: { id: AUDIT_ID },
        select: { id: true, url: true, status: true },
      });

      // Verify atomic claim transition: queued -> running
      expect(mockPrismaService.audit.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: AUDIT_ID,
          status: AuditState.QUEUED,
        },
        data: {
          status: AuditState.RUNNING,
        },
      });

      // Verify capture invoked strictly with stored URL from database
      expect(mockCaptureService.capture).toHaveBeenCalledWith({
        url: STORED_URL,
      });

      // Verify terminal transition: running -> complete
      expect(mockPrismaService.audit.updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: AUDIT_ID,
          status: AuditState.RUNNING,
        },
        data: {
          status: AuditState.COMPLETE,
          completedAt: expect.any(Date),
          failureReason: null,
        },
      });

      expect(result).toEqual({
        auditId: AUDIT_ID,
        status: 'complete',
        captureMetadata: MOCK_CAPTURE_RESULT.metadata,
      });
    });
  });

  describe('State Machine & Concurrency Conflicts', () => {
    it('throws AUDIT_NOT_FOUND when audit does not exist', async () => {
      mockPrismaService.audit.findUnique.mockResolvedValueOnce(null);

      await expect(service.processAudit(AUDIT_ID)).rejects.toMatchObject({
        code: AuditOrchestrationErrorCode.AUDIT_NOT_FOUND,
        safeMessage: `Audit ${AUDIT_ID} was not found`,
      });

      expect(mockPrismaService.audit.updateMany).not.toHaveBeenCalled();
      expect(mockCaptureService.capture).not.toHaveBeenCalled();
    });

    it('throws INVALID_STATE_TRANSITION when audit is already running', async () => {
      mockPrismaService.audit.findUnique.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: STORED_URL,
        status: AuditState.RUNNING,
      });

      await expect(service.processAudit(AUDIT_ID)).rejects.toMatchObject({
        code: AuditOrchestrationErrorCode.INVALID_STATE_TRANSITION,
        currentStatus: AuditState.RUNNING,
      });

      expect(mockPrismaService.audit.updateMany).not.toHaveBeenCalled();
      expect(mockCaptureService.capture).not.toHaveBeenCalled();
    });

    it('throws INVALID_STATE_TRANSITION when audit is already complete', async () => {
      mockPrismaService.audit.findUnique.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: STORED_URL,
        status: AuditState.COMPLETE,
      });

      await expect(service.processAudit(AUDIT_ID)).rejects.toMatchObject({
        code: AuditOrchestrationErrorCode.INVALID_STATE_TRANSITION,
        currentStatus: AuditState.COMPLETE,
      });

      expect(mockPrismaService.audit.updateMany).not.toHaveBeenCalled();
      expect(mockCaptureService.capture).not.toHaveBeenCalled();
    });

    it('throws INVALID_STATE_TRANSITION when audit has already failed', async () => {
      mockPrismaService.audit.findUnique.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: STORED_URL,
        status: AuditState.FAILED,
      });

      await expect(service.processAudit(AUDIT_ID)).rejects.toMatchObject({
        code: AuditOrchestrationErrorCode.INVALID_STATE_TRANSITION,
        currentStatus: AuditState.FAILED,
      });

      expect(mockPrismaService.audit.updateMany).not.toHaveBeenCalled();
      expect(mockCaptureService.capture).not.toHaveBeenCalled();
    });

    it('throws CONCURRENT_CONFLICT when audit was claimed by another worker concurrently', async () => {
      mockPrismaService.audit.findUnique.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: STORED_URL,
        status: AuditState.QUEUED,
      });

      // Claim update returns 0 rows updated (race lost)
      mockPrismaService.audit.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.processAudit(AUDIT_ID)).rejects.toMatchObject({
        code: AuditOrchestrationErrorCode.CONCURRENT_CONFLICT,
      });

      expect(mockCaptureService.capture).not.toHaveBeenCalled();
    });
  });

  describe('Failure Handling & Error Sanitization', () => {
    it('transitions audit to failed with safeReason on typed CaptureError', async () => {
      mockPrismaService.audit.findUnique.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: STORED_URL,
        status: AuditState.QUEUED,
      });

      mockPrismaService.audit.updateMany
        .mockResolvedValueOnce({ count: 1 }) // claim
        .mockResolvedValueOnce({ count: 1 }); // failure update

      mockCaptureService.capture.mockRejectedValueOnce(
        new CaptureError(
          CaptureErrorCode.BLOCKED_DESTINATION,
          'Destination IP address is non-globally routable or reserved',
        ),
      );

      const result = await service.processAudit(AUDIT_ID);

      expect(mockPrismaService.audit.updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: AUDIT_ID,
          status: AuditState.RUNNING,
        },
        data: {
          status: AuditState.FAILED,
          completedAt: expect.any(Date),
          failureReason:
            'Destination IP address is non-globally routable or reserved',
        },
      });

      expect(result).toEqual({
        auditId: AUDIT_ID,
        status: 'failed',
        failureReason:
          'Destination IP address is non-globally routable or reserved',
      });
    });

    it('sanitizes embedded credentials from failure reason', async () => {
      mockPrismaService.audit.findUnique.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: STORED_URL,
        status: AuditState.QUEUED,
      });

      mockPrismaService.audit.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 1 });

      mockCaptureService.capture.mockRejectedValueOnce(
        new CaptureError(
          CaptureErrorCode.INVALID_TARGET,
          'Navigation rejected for http://admin:super_secret@bad.example.com/login',
        ),
      );

      const result = await service.processAudit(AUDIT_ID);

      expect(result.status).toBe('failed');
      expect((result as any).failureReason).not.toContain('super_secret');
      expect((result as any).failureReason).toContain('***:***@bad.example.com');
    });

    it('maps unexpected capture exceptions to safe generic failure reason without leaking stack traces', async () => {
      mockPrismaService.audit.findUnique.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: STORED_URL,
        status: AuditState.QUEUED,
      });

      mockPrismaService.audit.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 1 });

      mockCaptureService.capture.mockRejectedValueOnce(
        new TypeError('Cannot read properties of undefined (reading "evaluate")'),
      );

      const result = await service.processAudit(AUDIT_ID);

      expect(result).toEqual({
        auditId: AUDIT_ID,
        status: 'failed',
        failureReason: 'An unexpected error occurred during capture processing',
      });

      expect(mockPrismaService.audit.updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: AUDIT_ID,
          status: AuditState.RUNNING,
        },
        data: {
          status: AuditState.FAILED,
          completedAt: expect.any(Date),
          failureReason: 'An unexpected error occurred during capture processing',
        },
      });
    });

    it('does not overwrite completed audit if terminal failure update sees count 0', async () => {
      mockPrismaService.audit.findUnique.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: STORED_URL,
        status: AuditState.QUEUED,
      });

      mockPrismaService.audit.updateMany
        .mockResolvedValueOnce({ count: 1 }) // claim
        .mockResolvedValueOnce({ count: 0 }); // failure update sees audit was no longer running

      mockCaptureService.capture.mockRejectedValueOnce(
        new CaptureError(CaptureErrorCode.TIMEOUT, 'Overall capture exceeded 30000ms timeout'),
      );

      const result = await service.processAudit(AUDIT_ID);

      expect(result.status).toBe('failed');
      expect((result as any).failureReason).toBe('Overall capture exceeded 30000ms timeout');
    });
  });

  describe('Database Error Handling & Persistence Faults', () => {
    it('throws PERSISTENCE_FAILED when claim query throws database error', async () => {
      mockPrismaService.audit.findUnique.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: STORED_URL,
        status: AuditState.QUEUED,
      });

      mockPrismaService.audit.updateMany.mockRejectedValueOnce(
        new Error('Database connection reset during claim'),
      );

      await expect(service.processAudit(AUDIT_ID)).rejects.toMatchObject({
        code: AuditOrchestrationErrorCode.PERSISTENCE_FAILED,
        safeMessage: 'Failed to claim audit due to database error',
      });

      expect(mockCaptureService.capture).not.toHaveBeenCalled();
    });

    it('throws PERSISTENCE_FAILED when terminal success update throws database error', async () => {
      mockPrismaService.audit.findUnique.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: STORED_URL,
        status: AuditState.QUEUED,
      });

      mockPrismaService.audit.updateMany
        .mockResolvedValueOnce({ count: 1 }) // claim succeeds
        .mockRejectedValueOnce(new Error('Database deadlock on completion update')); // completion fails

      mockCaptureService.capture.mockResolvedValueOnce(MOCK_CAPTURE_RESULT);

      await expect(service.processAudit(AUDIT_ID)).rejects.toMatchObject({
        code: AuditOrchestrationErrorCode.PERSISTENCE_FAILED,
        safeMessage: 'Failed to persist terminal completion status',
      });
    });

    it('throws PERSISTENCE_FAILED when terminal failure update throws database error', async () => {
      mockPrismaService.audit.findUnique.mockResolvedValueOnce({
        id: AUDIT_ID,
        url: STORED_URL,
        status: AuditState.QUEUED,
      });

      mockPrismaService.audit.updateMany
        .mockResolvedValueOnce({ count: 1 }) // claim succeeds
        .mockRejectedValueOnce(new Error('Database disk full on failure update')); // failure update fails

      mockCaptureService.capture.mockRejectedValueOnce(
        new CaptureError(CaptureErrorCode.NAVIGATION_FAILED, 'Navigation failed'),
      );

      await expect(service.processAudit(AUDIT_ID)).rejects.toMatchObject({
        code: AuditOrchestrationErrorCode.PERSISTENCE_FAILED,
        safeMessage: 'Failed to persist terminal failure status',
      });
    });
  });
});
