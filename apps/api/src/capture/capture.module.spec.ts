// Ensure test environment variables are set before AppModule top-level evaluation
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://audit_user:secret@localhost:5432/audit_test_db';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'a_very_strong_test_jwt_secret_with_32_characters_minimum';

import { Test, TestingModule } from '@nestjs/testing';
import { Browser, BrowserContext, Page, Route } from 'playwright';
import { AppModule } from '../app.module';
import { BrowserProvider } from './browser-provider';
import {
  BROWSER_PROVIDER_TOKEN,
  PNG_MAGIC_BYTES,
} from './capture.constants';
import { CaptureModule } from './capture.module';
import { CaptureService } from './capture.service';
import { CaptureErrorCode, CaptureResult } from './capture.types';
import { DestinationGuardService } from './destination-guard.service';
import { DestinationErrorCode, DestinationGuardError, ValidatedDestination } from './destination-guard.types';
import { DNS_RESOLVER_TOKEN, DnsResolver } from './dns-resolver';

describe('CaptureModule Integration & Contract Verification', () => {
  const VALID_PNG_BUFFER = Buffer.concat([
    PNG_MAGIC_BYTES,
    Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
  ]);

  const VALID_DOM_HTML =
    '<!DOCTYPE html><html><head><title>Integration Test</title></head><body><main><h1>Contract</h1></main></body></html>';

  const VALID_COMPUTED_STYLES = [
    {
      selector: 'h1',
      tagName: 'h1',
      boundingBox: { x: 20, y: 30, width: 200, height: 40 },
      styles: {
        color: 'rgb(10, 10, 10)',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        fontSize: '32px',
        fontWeight: '700',
        lineHeight: '40px',
        display: 'block',
        visibility: 'visible',
        margin: '16px',
        padding: '0px',
      },
      textSnippet: 'Contract',
    },
  ];

  const VALID_DESTINATION: ValidatedDestination = {
    originalUrl: 'https://example.com/audit',
    normalizedUrl: 'https://example.com/audit',
    scheme: 'https',
    hostname: 'example.com',
    port: 443,
    resolvedIps: ['93.184.216.34'],
    isIpLiteral: false,
  };

  describe('Module Registration & Dependency Injection', () => {
    it('constructs CaptureModule and resolves all exported tokens and providers', async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [CaptureModule],
      }).compile();

      const captureService = moduleRef.get<CaptureService>(CaptureService);
      const destinationGuard = moduleRef.get<DestinationGuardService>(DestinationGuardService);
      const browserProvider = moduleRef.get<BrowserProvider>(BROWSER_PROVIDER_TOKEN);
      const dnsResolver = moduleRef.get<DnsResolver>(DNS_RESOLVER_TOKEN);

      expect(captureService).toBeDefined();
      expect(destinationGuard).toBeDefined();
      expect(browserProvider).toBeDefined();
      expect(dnsResolver).toBeDefined();
      expect(captureService).toBeInstanceOf(CaptureService);
      expect(destinationGuard).toBeInstanceOf(DestinationGuardService);
    });

    it('resolves CaptureModule cleanly from the root AppModule without circular dependencies', async () => {
      const origDb = process.env.DATABASE_URL;
      const origJwt = process.env.JWT_SECRET;
      process.env.DATABASE_URL = 'postgresql://audit_user:secret@localhost:5432/audit_test_db';
      process.env.JWT_SECRET = 'a_very_strong_test_jwt_secret_with_32_characters_minimum';

      try {
        const moduleRef: TestingModule = await Test.createTestingModule({
          imports: [AppModule],
        }).compile();

        const captureService = moduleRef.get<CaptureService>(CaptureService);
        const destinationGuard = moduleRef.get<DestinationGuardService>(DestinationGuardService);

        expect(captureService).toBeDefined();
        expect(destinationGuard).toBeDefined();
      } finally {
        if (origDb !== undefined) {
          process.env.DATABASE_URL = origDb;
        } else {
          delete process.env.DATABASE_URL;
        }
        if (origJwt !== undefined) {
          process.env.JWT_SECRET = origJwt;
        } else {
          delete process.env.JWT_SECRET;
        }
      }
    });

    it('does NOT launch Chromium or perform network requests during module initialization', async () => {
      const launchSpy = jest.fn();
      const mockCustomProvider: BrowserProvider = {
        launch: launchSpy,
      };

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [CaptureModule],
      })
        .overrideProvider(BROWSER_PROVIDER_TOKEN)
        .useValue(mockCustomProvider)
        .compile();

      // Module initialized, but launch must not have been invoked
      expect(moduleRef).toBeDefined();
      expect(launchSpy).not.toHaveBeenCalled();
    });
  });

  describe('Capture Contract Verification', () => {
    let moduleRef: TestingModule;
    let captureService: CaptureService;
    let mockPage: jest.Mocked<Page>;
    let mockContext: jest.Mocked<BrowserContext>;
    let mockBrowser: jest.Mocked<Browser>;
    let mockBrowserProvider: BrowserProvider;
    let mockDestinationGuard: jest.Mocked<DestinationGuardService>;

    beforeEach(async () => {
      mockPage = {
        goto: jest.fn().mockResolvedValue(null),
        url: jest.fn().mockReturnValue('https://example.com/audit'),
        screenshot: jest.fn().mockResolvedValue(VALID_PNG_BUFFER),
        content: jest.fn().mockResolvedValue(VALID_DOM_HTML),
        evaluate: jest.fn().mockResolvedValue({
          totalDomElements: 4,
          computedStyles: VALID_COMPUTED_STYLES,
        }),
        route: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      } as unknown as jest.Mocked<Page>;

      mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      } as unknown as jest.Mocked<BrowserContext>;

      mockBrowser = {
        newContext: jest.fn().mockResolvedValue(mockContext),
        close: jest.fn().mockResolvedValue(undefined),
      } as unknown as jest.Mocked<Browser>;

      mockBrowserProvider = {
        launch: jest.fn().mockResolvedValue(mockBrowser),
      };

      mockDestinationGuard = {
        validate: jest.fn().mockResolvedValue(VALID_DESTINATION),
        check: jest.fn().mockResolvedValue({ isValid: true, destination: VALID_DESTINATION }),
      } as unknown as jest.Mocked<DestinationGuardService>;

      moduleRef = await Test.createTestingModule({
        imports: [CaptureModule],
      })
        .overrideProvider(BROWSER_PROVIDER_TOKEN)
        .useValue(mockBrowserProvider)
        .overrideProvider(DestinationGuardService)
        .useValue(mockDestinationGuard)
        .compile();

      captureService = moduleRef.get<CaptureService>(CaptureService);
    });

    it('returns a fully populated CaptureResult adhering to the documented contract on success', async () => {
      const result: CaptureResult = await captureService.capture({
        url: 'https://example.com/audit',
      });

      // 1. Root structure
      expect(result.success).toBe(true);
      expect(Buffer.isBuffer(result.screenshot)).toBe(true);
      expect(typeof result.domSnapshot).toBe('string');
      expect(Array.isArray(result.computedStyles)).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.validatedDestination).toBeDefined();

      // 2. Metadata contract
      expect(result.metadata.initialUrl).toBe('https://example.com/audit');
      expect(result.metadata.finalUrl).toBe('https://example.com/audit');
      expect(result.metadata.resolvedIps).toEqual(['93.184.216.34']);
      expect(result.metadata.viewport).toEqual({ width: 1280, height: 800 });
      expect(typeof result.metadata.captureTimestamp).toBe('string');
      expect(new Date(result.metadata.captureTimestamp).toISOString()).toBe(result.metadata.captureTimestamp);
      expect(typeof result.metadata.durationMs).toBe('number');
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata.redirectCount).toBe(0);
      expect(result.metadata.domElementCount).toBe(4);
      expect(result.metadata.computedStylesCount).toBe(1);
      expect(result.metadata.screenshotSizeBytes).toBe(VALID_PNG_BUFFER.length);
      expect(result.metadata.domSizeBytes).toBe(Buffer.byteLength(VALID_DOM_HTML, 'utf8'));

      // 3. Artifact details
      expect(result.screenshot.subarray(0, 8).equals(PNG_MAGIC_BYTES)).toBe(true);
      expect(result.domSnapshot).toBe(VALID_DOM_HTML);
      expect(result.computedStyles[0]).toMatchObject({
        selector: 'h1',
        tagName: 'h1',
        boundingBox: { x: 20, y: 30, width: 200, height: 40 },
        styles: expect.objectContaining({
          color: 'rgb(10, 10, 10)',
          fontSize: '32px',
          fontWeight: '700',
        }),
      });

      // 4. Resource cleanup
      expect(mockPage.close).toHaveBeenCalledTimes(1);
      expect(mockContext.close).toHaveBeenCalledTimes(1);
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });

    it('returns typed CaptureError with INVALID_TARGET when URL validation fails', async () => {
      mockDestinationGuard.validate.mockRejectedValueOnce(
        new DestinationGuardError(
          DestinationErrorCode.INVALID_TARGET,
          'Target URL is malformed or unparseable',
        ),
      );

      await expect(
        captureService.capture({ url: 'not-a-valid-url' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.INVALID_TARGET,
        safeReason: 'Target URL is malformed or unparseable',
      });

      expect(mockBrowserProvider.launch).not.toHaveBeenCalled();
    });

    it('returns typed CaptureError with BLOCKED_DESTINATION when destination guard rejects non-routable target', async () => {
      mockDestinationGuard.validate.mockRejectedValueOnce(
        new DestinationGuardError(
          DestinationErrorCode.BLOCKED_DESTINATION,
          'Destination IP address is non-globally routable or reserved',
        ),
      );

      await expect(
        captureService.capture({ url: 'http://127.0.0.1' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.BLOCKED_DESTINATION,
        safeReason: 'Destination IP address is non-globally routable or reserved',
      });

      expect(mockBrowserProvider.launch).not.toHaveBeenCalled();
    });

    it('returns typed CaptureError with TIMEOUT and cleans up resources when navigation times out', async () => {
      mockPage.goto.mockRejectedValueOnce(
        new Error('page.goto: Timeout 15000ms exceeded while waiting for "load"'),
      );

      await expect(
        captureService.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.TIMEOUT,
        safeReason: expect.stringContaining('Navigation timed out'),
      });

      expect(mockPage.close).toHaveBeenCalledTimes(1);
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });

    it('returns typed CaptureError with ARTIFACT_LIMIT_EXCEEDED when screenshot exceeds limit', async () => {
      const oversizedScreenshot = Buffer.concat([
        PNG_MAGIC_BYTES,
        Buffer.alloc(11 * 1024 * 1024),
      ]);
      mockPage.screenshot.mockResolvedValueOnce(oversizedScreenshot);

      await expect(
        captureService.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.ARTIFACT_LIMIT_EXCEEDED,
      });

      expect(mockPage.close).toHaveBeenCalledTimes(1);
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });
  });
});
