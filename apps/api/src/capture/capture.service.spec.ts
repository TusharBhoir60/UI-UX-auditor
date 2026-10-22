import { Test, TestingModule } from '@nestjs/testing';
import { Browser, BrowserContext, Page, Request as PlaywrightRequest, Route } from 'playwright';
import { BrowserProvider } from './browser-provider';
import {
  BROWSER_PROVIDER_TOKEN,
  MAX_SUBRESOURCE_DNS_CHECKS,
  PNG_MAGIC_BYTES,
} from './capture.constants';
import { CaptureService } from './capture.service';
import {
  CaptureErrorCode,
  ElementComputedStyle,
  sanitizeErrorMessage,
} from './capture.types';
import { DestinationGuardService } from './destination-guard.service';
import {
  DestinationErrorCode,
  DestinationGuardError,
  DestinationValidationResult,
  ValidatedDestination,
} from './destination-guard.types';

describe('CaptureService', () => {
  let service: CaptureService;
  let mockDestinationGuard: jest.Mocked<DestinationGuardService>;
  let mockBrowserProvider: jest.Mocked<BrowserProvider>;

  let mockPage: jest.Mocked<Page>;
  let mockContext: jest.Mocked<BrowserContext>;
  let mockBrowser: jest.Mocked<Browser>;

  let routeHandlers: Array<(route: Route) => Promise<void>>;
  let pageEventHandlers: Record<string, Array<(...args: any[]) => any>>;

  const VALID_PNG_BUFFER = Buffer.concat([
    PNG_MAGIC_BYTES,
    Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
  ]);

  const VALID_DOM_HTML =
    '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>';

  const VALID_COMPUTED_STYLES: ElementComputedStyle[] = [
    {
      selector: 'h1',
      tagName: 'h1',
      boundingBox: { x: 10, y: 20, width: 100, height: 30 },
      styles: {
        color: 'rgb(0, 0, 0)',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        fontSize: '24px',
        fontWeight: '700',
        lineHeight: '32px',
        display: 'block',
        visibility: 'visible',
        margin: '10px',
        padding: '0px',
      },
      textSnippet: 'Hello',
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

  beforeEach(async () => {
    routeHandlers = [];
    pageEventHandlers = {};

    mockPage = {
      goto: jest.fn().mockResolvedValue(null),
      url: jest.fn().mockReturnValue('https://example.com/audit'),
      screenshot: jest.fn().mockResolvedValue(VALID_PNG_BUFFER),
      content: jest.fn().mockResolvedValue(VALID_DOM_HTML),
      evaluate: jest.fn().mockResolvedValue({
        totalDomElements: 1,
        computedStyles: VALID_COMPUTED_STYLES,
      }),
      route: jest.fn().mockImplementation(async (_pattern, handler) => {
        routeHandlers.push(handler);
      }),
      on: jest.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
        if (!pageEventHandlers[event]) {
          pageEventHandlers[event] = [];
        }
        pageEventHandlers[event].push(handler);
      }),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaptureService,
        {
          provide: DestinationGuardService,
          useValue: mockDestinationGuard,
        },
        {
          provide: BROWSER_PROVIDER_TOKEN,
          useValue: mockBrowserProvider,
        },
      ],
    }).compile();

    service = module.get<CaptureService>(CaptureService);
  });

  const triggerResponse = async (
    status: number,
    headers: Record<string, string> = {},
    url = 'https://example.com/audit',
  ) => {
    const handlers = pageEventHandlers['response'] || [];
    for (const handler of handlers) {
      await handler({
        status: () => status,
        headers: () => headers,
        url: () => url,
      });
    }
  };

  describe('Destination Guard Pre-Check', () => {
    it('prevents browser launch when destination guard rejects input target', async () => {
      mockDestinationGuard.validate.mockRejectedValueOnce(
        new DestinationGuardError(
          DestinationErrorCode.BLOCKED_DESTINATION,
          'Destination IP address is non-globally routable or reserved',
        ),
      );

      await expect(
        service.capture({ url: 'http://127.0.0.1' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.BLOCKED_DESTINATION,
        safeReason: 'Destination IP address is non-globally routable or reserved',
      });

      expect(mockBrowserProvider.launch).not.toHaveBeenCalled();
    });

    it('maps invalid target errors correctly', async () => {
      mockDestinationGuard.validate.mockRejectedValueOnce(
        new DestinationGuardError(
          DestinationErrorCode.INVALID_TARGET,
          'Target URL is malformed or unparseable',
        ),
      );

      await expect(
        service.capture({ url: 'invalid-url' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.INVALID_TARGET,
        safeReason: 'Target URL is malformed or unparseable',
      });

      expect(mockBrowserProvider.launch).not.toHaveBeenCalled();
    });

    it('maps DNS resolution failure to typed CaptureError with DNS_RESOLUTION_FAILED', async () => {
      mockDestinationGuard.validate.mockRejectedValueOnce(
        new DestinationGuardError(
          DestinationErrorCode.DNS_RESOLUTION_FAILED,
          'DNS resolution failed for the destination hostname',
        ),
      );

      await expect(
        service.capture({ url: 'https://non-existent-domain-xyz.test' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.DNS_RESOLUTION_FAILED,
        safeReason: 'DNS resolution failed for the destination hostname',
      });

      expect(mockBrowserProvider.launch).not.toHaveBeenCalled();
    });
  });

  describe('Successful Capture Lifecycle', () => {
    it('returns all required artifacts, metadata, and performs full resource cleanup', async () => {
      const result = await service.capture({ url: 'https://example.com/audit' });

      expect(result.success).toBe(true);
      expect(result.screenshot).toEqual(VALID_PNG_BUFFER);
      expect(result.domSnapshot).toEqual(VALID_DOM_HTML);
      expect(result.computedStyles).toEqual(VALID_COMPUTED_STYLES);
      expect(result.metadata.viewport).toEqual({ width: 1280, height: 800 });
      expect(result.metadata.initialUrl).toBe('https://example.com/audit');
      expect(result.metadata.finalUrl).toBe('https://example.com/audit');
      expect(result.metadata.resolvedIps).toEqual(['93.184.216.34']);
      expect(result.metadata.screenshotSizeBytes).toBe(VALID_PNG_BUFFER.length);
      expect(result.metadata.domElementCount).toBe(1);
      expect(result.metadata.computedStylesCount).toBe(1);

      // Verify resource cleanup in finally
      expect(mockPage.close).toHaveBeenCalledTimes(1);
      expect(mockContext.close).toHaveBeenCalledTimes(1);
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });

    it('applies fixed viewport, sandbox, and blocked service workers settings to context', async () => {
      await service.capture({ url: 'https://example.com/audit' });

      expect(mockBrowser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({
          viewport: { width: 1280, height: 800 },
          acceptDownloads: false,
          serviceWorkers: 'block',
        }),
      );
    });
  });

  describe('Overall Timeout and Resource Lifecycle', () => {
    it('enforces hard overall capture timeout and closes all resources promptly', async () => {
      // Simulate page.goto hanging indefinitely
      mockPage.goto.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500)),
      );

      await expect(
        service.capture(
          { url: 'https://example.com/audit' },
          { overallTimeoutMs: 30, navigationTimeoutMs: 500 },
        ),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.TIMEOUT,
        safeReason: expect.stringContaining('Overall capture exceeded 30ms timeout'),
      });

      expect(mockPage.close).toHaveBeenCalledTimes(1);
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });

    it('terminates late browser launch if timeout fires while launch is in-flight', async () => {
      // Delayed browser launch that finishes AFTER overall timeout fires
      const delayedBrowser = {
        close: jest.fn().mockResolvedValue(undefined),
      } as unknown as jest.Mocked<Browser>;

      mockBrowserProvider.launch.mockImplementation(
        () =>
          new Promise<Browser>((resolve) => {
            setTimeout(() => resolve(delayedBrowser), 60);
          }),
      );

      await expect(
        service.capture(
          { url: 'https://example.com/audit' },
          { overallTimeoutMs: 25 },
        ),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.TIMEOUT,
      });

      // Wait for delayed launch to resolve and verify it was immediately closed
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(delayedBrowser.close).toHaveBeenCalledTimes(1);
    });

    it('ensures cleanup errors do not mask the original capture error', async () => {
      mockPage.goto.mockRejectedValueOnce(
        new Error('page.goto: Timeout 15000ms exceeded while waiting for "load"'),
      );
      // Simulate failure during cleanup
      mockPage.close.mockRejectedValueOnce(new Error('Browser socket disconnected unexpectedly'));

      await expect(
        service.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.TIMEOUT,
      });

      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });

    it('handles cleanup operation that hangs indefinitely without hanging indefinitely or masking errors', async () => {
      mockPage.goto.mockRejectedValueOnce(
        new Error('page.goto: Timeout 15000ms exceeded while waiting for "load"'),
      );
      // Simulate close hanging indefinitely
      mockPage.close.mockReturnValueOnce(new Promise(() => {}));

      await expect(
        service.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.TIMEOUT,
      });

      // Assert context and browser close were still attempted independently
      expect(mockContext.close).toHaveBeenCalledTimes(1);
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    }, 5000);
  });

  describe('Active Redirect Policy Enforcement', () => {
    it('actively terminates navigation and rejects when redirects exceed maxRedirects', async () => {
      mockPage.goto.mockImplementation(async () => {
        // Trigger 3 redirects when limit is 2
        await triggerResponse(302, { location: 'https://example.com/r1' });
        await triggerResponse(302, { location: 'https://example.com/r2' });
        await triggerResponse(302, { location: 'https://example.com/r3' });
        throw new Error('Target page, context or browser has been closed');
      });

      await expect(
        service.capture(
          { url: 'https://example.com/audit' },
          { maxRedirects: 2 },
        ),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.BLOCKED_REDIRECT,
        safeReason: expect.stringContaining('Exceeded maximum redirect limit of 2'),
      });

      expect(mockPage.close).toHaveBeenCalled();
    });

    it('actively terminates navigation when 3xx Location header points to a prohibited destination', async () => {
      mockDestinationGuard.check.mockResolvedValueOnce({
        isValid: false,
        error: new DestinationGuardError(
          DestinationErrorCode.BLOCKED_DESTINATION,
          'Destination IP address is non-globally routable or reserved',
        ),
      });

      mockPage.goto.mockImplementation(async () => {
        await triggerResponse(301, { location: 'http://169.254.169.254/latest/meta-data/' });
        throw new Error('Target page, context or browser has been closed');
      });

      await expect(
        service.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.BLOCKED_REDIRECT,
        safeReason: 'Navigation redirected to a prohibited destination',
      });

      expect(mockPage.close).toHaveBeenCalled();
    });

    it('actively terminates navigation when 3xx Location header is malformed', async () => {
      mockPage.goto.mockImplementation(async () => {
        await triggerResponse(301, { location: 'http://::invalid-url' });
        throw new Error('Target page, context or browser has been closed');
      });

      await expect(
        service.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.BLOCKED_REDIRECT,
        safeReason: 'Navigation redirect target URL is malformed or invalid',
      });

      expect(mockPage.close).toHaveBeenCalled();
    });

    it('actively aborts prohibited redirect request at routing level before socket connection is attempted', async () => {
      await service.capture({ url: 'https://example.com/audit' });

      const handler = routeHandlers[0];
      const mockInitialRequest = {
        url: () => 'https://example.com/audit',
      } as PlaywrightRequest;

      const mockRedirectedRequest = {
        url: () => 'http://169.254.169.254/latest/meta-data/',
        isNavigationRequest: () => true,
        redirectedFrom: () => mockInitialRequest,
      } as unknown as PlaywrightRequest;

      const mockRoute = {
        request: () => mockRedirectedRequest,
        abort: jest.fn().mockResolvedValue(undefined),
        continue: jest.fn().mockResolvedValue(undefined),
      } as unknown as Route;

      await handler(mockRoute);

      // Verify that the prohibited request was aborted and NEVER continued
      expect(mockRoute.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(mockRoute.continue).not.toHaveBeenCalled();
      expect(mockPage.close).toHaveBeenCalled();
    });

    it('actively aborts redirected request when hop count exceeds maxRedirects at request level', async () => {
      await service.capture(
        { url: 'https://example.com/audit' },
        { maxRedirects: 2 },
      );

      const handler = routeHandlers[0];
      const makeRedirectRoute = (url: string) => {
        const mockRequest = {
          url: () => url,
          isNavigationRequest: () => true,
          redirectedFrom: () => ({ url: () => 'https://example.com/prev' }),
        } as unknown as PlaywrightRequest;

        return {
          request: () => mockRequest,
          abort: jest.fn().mockResolvedValue(undefined),
          continue: jest.fn().mockResolvedValue(undefined),
        } as unknown as Route;
      };

      // Hop 1 (within limit 2)
      mockDestinationGuard.check.mockResolvedValueOnce({ isValid: true, destination: VALID_DESTINATION });
      const r1 = makeRedirectRoute('https://example.com/r1');
      await handler(r1);
      expect(r1.continue).toHaveBeenCalled();

      // Hop 2 (within limit 2)
      mockDestinationGuard.check.mockResolvedValueOnce({ isValid: true, destination: VALID_DESTINATION });
      const r2 = makeRedirectRoute('https://example.com/r2');
      await handler(r2);
      expect(r2.continue).toHaveBeenCalled();

      // Hop 3 (exceeds limit 2)
      const r3 = makeRedirectRoute('https://example.com/r3');
      await handler(r3);
      expect(r3.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(r3.continue).not.toHaveBeenCalled();
      expect(mockPage.close).toHaveBeenCalled();
    });

    it('counts redirect hops exactly once when both route request and 3xx response fire for the same hop', async () => {
      mockDestinationGuard.check.mockResolvedValue({ isValid: true, destination: VALID_DESTINATION });
      mockPage.url.mockReturnValue('https://example.com/final-hop2');

      const mockReq1 = {
        url: () => 'https://example.com/hop1',
        isNavigationRequest: () => true,
        redirectedFrom: () => ({ url: () => 'https://example.com/audit' }),
      } as unknown as PlaywrightRequest;

      const mockReq2 = {
        url: () => 'https://example.com/final-hop2',
        isNavigationRequest: () => true,
        redirectedFrom: () => mockReq1,
      } as unknown as PlaywrightRequest;

      mockPage.goto.mockImplementation(async () => {
        const handler = routeHandlers[0];

        // Hop 1: route intercepts redirected request
        const r1 = {
          request: () => mockReq1,
          abort: jest.fn().mockResolvedValue(undefined),
          continue: jest.fn().mockResolvedValue(undefined),
        } as unknown as Route;
        await handler(r1);

        // Hop 1: 302 response arrives for mockReq1
        const resp1 = {
          status: () => 302,
          headers: () => ({ location: 'https://example.com/final-hop2' }),
          url: () => 'https://example.com/hop1',
          request: () => mockReq1,
        };
        for (const h of pageEventHandlers['response'] || []) {
          await h(resp1);
        }

        // Hop 2: route intercepts redirected request
        const r2 = {
          request: () => mockReq2,
          abort: jest.fn().mockResolvedValue(undefined),
          continue: jest.fn().mockResolvedValue(undefined),
        } as unknown as Route;
        await handler(r2);

        // Hop 2: 200 OK final response
        const resp2 = {
          status: () => 200,
          headers: () => ({}),
          url: () => 'https://example.com/final-hop2',
          request: () => mockReq2,
        };
        for (const h of pageEventHandlers['response'] || []) {
          await h(resp2);
        }
        return null;
      });

      const result = await service.capture(
        { url: 'https://example.com/audit' },
        { maxRedirects: 2 },
      );

      // Proves exactly 2 hops counted without off-by-one or double-counting failure
      expect(result.metadata.redirectCount).toBe(2);
    });

    it('aborts capture if landing URL redirects to a prohibited destination', async () => {
      mockPage.url.mockReturnValue('http://169.254.169.254/latest/meta-data/');
      mockDestinationGuard.validate
        .mockResolvedValueOnce(VALID_DESTINATION)
        .mockRejectedValueOnce(
          new DestinationGuardError(
            DestinationErrorCode.BLOCKED_DESTINATION,
            'Destination IP address is non-globally routable or reserved',
          ),
        );

      await expect(
        service.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.BLOCKED_REDIRECT,
        safeReason: 'Navigation redirected to a prohibited destination',
      });

      expect(mockPage.close).toHaveBeenCalledTimes(1);
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('Subresource Routing and Destination Safety', () => {
    it('blocks subresource requests to unsupported schemes and private destinations via route interception', async () => {
      await service.capture({ url: 'https://example.com/audit' });

      expect(routeHandlers.length).toBeGreaterThan(0);
      const handler = routeHandlers[0];

      const testRoute = async (url: string, isNavigation = false) => {
        const mockRequest = {
          url: () => url,
          isNavigationRequest: () => isNavigation,
        } as unknown as PlaywrightRequest;

        const mockRoute = {
          request: () => mockRequest,
          abort: jest.fn().mockResolvedValue(undefined),
          continue: jest.fn().mockResolvedValue(undefined),
        } as unknown as Route;

        await handler(mockRoute);
        return mockRoute;
      };

      // 1. Unsupported schemes must be aborted
      const fileRoute = await testRoute('file:///etc/passwd');
      expect(fileRoute.abort).toHaveBeenCalledWith('blockedbyclient');

      const jsRoute = await testRoute('javascript:alert(1)');
      expect(jsRoute.abort).toHaveBeenCalledWith('blockedbyclient');

      const wsRoute = await testRoute('ws://chat.example.com/socket');
      expect(wsRoute.abort).toHaveBeenCalledWith('blockedbyclient');

      const blobRoute = await testRoute('blob:https://example.com/uuid');
      expect(blobRoute.abort).toHaveBeenCalledWith('blockedbyclient');

      // 2. Navigation request with data: URI must be aborted
      const dataNavRoute = await testRoute('data:text/html,<h1>Malicious</h1>', true);
      expect(dataNavRoute.abort).toHaveBeenCalledWith('blockedbyclient');

      // 3. Prohibited subresource hostnames must be aborted
      const metadataRoute = await testRoute('http://metadata.google.internal/computeMetadata');
      expect(metadataRoute.abort).toHaveBeenCalledWith('blockedbyclient');

      const localhostRoute = await testRoute('http://localhost:8080/data.json');
      expect(localhostRoute.abort).toHaveBeenCalledWith('blockedbyclient');

      // 4. Allowed data URIs for inline images and fonts
      const dataImageRoute = await testRoute('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
      expect(dataImageRoute.continue).toHaveBeenCalled();

      const dataFontRoute = await testRoute('data:font/woff2;base64,d09GMgABAAAAA=');
      expect(dataFontRoute.continue).toHaveBeenCalled();

      // 5. Allowed public resources
      mockDestinationGuard.check.mockResolvedValueOnce({
        isValid: true,
        destination: VALID_DESTINATION,
      });
      const publicRoute = await testRoute('https://cdn.example.com/styles.css');
      expect(publicRoute.continue).toHaveBeenCalled();
    });

    it('deduplicates concurrent subresource requests for the exact same hostname without redundant DNS checks', async () => {
      await service.capture({ url: 'https://example.com/audit' });

      const handler = routeHandlers[0];
      mockDestinationGuard.check.mockClear();

      let resolveCheck!: (val: DestinationValidationResult) => void;
      mockDestinationGuard.check.mockReturnValue(
        new Promise((res) => {
          resolveCheck = res;
        }),
      );

      const makeRoute = (assetPath: string) => {
        const mockRequest = {
          url: () => `https://cdn.example.com/${assetPath}`,
          isNavigationRequest: () => false,
        } as unknown as PlaywrightRequest;

        return {
          request: () => mockRequest,
          abort: jest.fn().mockResolvedValue(undefined),
          continue: jest.fn().mockResolvedValue(undefined),
        } as unknown as Route;
      };

      // Issue 10 concurrent requests for assets on cdn.example.com
      const routes = Array.from({ length: 10 }, (_, i) => makeRoute(`asset-${i}.png`));
      const handlerPromises = routes.map((r) => handler(r));

      // Assert that exactly 1 call to destinationGuard.check was initiated despite 10 concurrent requests
      expect(mockDestinationGuard.check).toHaveBeenCalledTimes(1);

      // Resolve the single in-flight DNS check
      resolveCheck({ isValid: true, destination: VALID_DESTINATION });
      await Promise.all(handlerPromises);

      // Verify all 10 were continued and none aborted
      for (const r of routes) {
        expect(r.continue).toHaveBeenCalled();
        expect(r.abort).not.toHaveBeenCalled();
      }
    });

    it('aborts delayed subresource DNS validation exceeding validation timeout and fails closed', async () => {
      await service.capture({ url: 'https://example.com/audit' });

      const handler = routeHandlers[0];
      mockDestinationGuard.check.mockClear();

      // Simulate a hung DNS resolver that never settles
      mockDestinationGuard.check.mockReturnValue(new Promise(() => {}));

      const mockRequest = {
        url: () => 'https://slow-dns.example.com/image.png',
        isNavigationRequest: () => false,
      } as unknown as PlaywrightRequest;

      const mockRoute = {
        request: () => mockRequest,
        abort: jest.fn().mockResolvedValue(undefined),
        continue: jest.fn().mockResolvedValue(undefined),
      } as unknown as Route;

      // SUBRESOURCE_VALIDATION_TIMEOUT_MS is 2,000ms; should abort without waiting 5,000ms
      await handler(mockRoute);

      expect(mockRoute.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(mockRoute.continue).not.toHaveBeenCalled();
    }, 4000);

    it('strictly enforces MAX_SUBRESOURCE_DNS_CHECKS limit across concurrent requests to distinct hostnames', async () => {
      await service.capture({ url: 'https://example.com/audit' });

      const handler = routeHandlers[0];
      mockDestinationGuard.check.mockClear();
      mockDestinationGuard.check.mockResolvedValue({ isValid: true, destination: VALID_DESTINATION });

      const makeDistinctRoute = (hostId: number) => {
        const mockRequest = {
          url: () => `https://distinct-sub-${hostId}.example.com/asset.js`,
          isNavigationRequest: () => false,
        } as unknown as PlaywrightRequest;

        return {
          request: () => mockRequest,
          abort: jest.fn().mockResolvedValue(undefined),
          continue: jest.fn().mockResolvedValue(undefined),
        } as unknown as Route;
      };

      // Fire 60 concurrent requests for 60 distinct hostnames
      const allRoutes = Array.from({ length: 60 }, (_, i) => makeDistinctRoute(i));
      await Promise.all(allRoutes.map((r) => handler(r)));

      // Exactly MAX_SUBRESOURCE_DNS_CHECKS (50) DNS calls made
      expect(mockDestinationGuard.check).toHaveBeenCalledTimes(MAX_SUBRESOURCE_DNS_CHECKS);

      // First 50 continued, last 10 aborted
      for (let i = 0; i < MAX_SUBRESOURCE_DNS_CHECKS; i++) {
        expect(allRoutes[i].continue).toHaveBeenCalled();
        expect(allRoutes[i].abort).not.toHaveBeenCalled();
      }
      for (let i = MAX_SUBRESOURCE_DNS_CHECKS; i < 60; i++) {
        expect(allRoutes[i].abort).toHaveBeenCalledWith('blockedbyclient');
        expect(allRoutes[i].continue).not.toHaveBeenCalled();
      }
    });

    it('caches subresource hostname decisions to prevent duplicate DNS checks', async () => {
      await service.capture({ url: 'https://example.com/audit' });

      const handler = routeHandlers[0];
      const testRoute = async (url: string) => {
        const mockRequest = {
          url: () => url,
          isNavigationRequest: () => false,
        } as unknown as PlaywrightRequest;

        const mockRoute = {
          request: () => mockRequest,
          abort: jest.fn().mockResolvedValue(undefined),
          continue: jest.fn().mockResolvedValue(undefined),
        } as unknown as Route;

        await handler(mockRoute);
        return mockRoute;
      };

      mockDestinationGuard.check.mockResolvedValueOnce({
        isValid: true,
        destination: VALID_DESTINATION,
      });

      // First call validates hostname
      const first = await testRoute('https://cached.example.com/image1.png');
      expect(first.continue).toHaveBeenCalled();
      expect(mockDestinationGuard.check).toHaveBeenCalledTimes(1);

      // Second call to same hostname uses cache
      const second = await testRoute('https://cached.example.com/image2.png');
      expect(second.continue).toHaveBeenCalled();
      expect(mockDestinationGuard.check).toHaveBeenCalledTimes(1);
    });

    it('fails closed when destination guard check throws an unexpected error', async () => {
      await service.capture({ url: 'https://example.com/audit' });

      const handler = routeHandlers[0];
      mockDestinationGuard.check.mockRejectedValueOnce(new Error('DNS service unavailable'));

      const mockRequest = {
        url: () => 'https://broken-dns.example.com/style.css',
        isNavigationRequest: () => false,
      } as unknown as PlaywrightRequest;

      const mockRoute = {
        request: () => mockRequest,
        abort: jest.fn().mockResolvedValue(undefined),
        continue: jest.fn().mockResolvedValue(undefined),
      } as unknown as Route;

      await handler(mockRoute);
      expect(mockRoute.abort).toHaveBeenCalledWith('blockedbyclient');
    });

    it('auto-dismisses dialogs and auto-closes popups', async () => {
      await service.capture({ url: 'https://example.com/audit' });

      expect(pageEventHandlers['dialog']).toBeDefined();
      expect(pageEventHandlers['popup']).toBeDefined();

      const mockDialog = { dismiss: jest.fn().mockResolvedValue(undefined) };
      await pageEventHandlers['dialog'][0](mockDialog);
      expect(mockDialog.dismiss).toHaveBeenCalled();

      const mockPopup = { close: jest.fn().mockResolvedValue(undefined) };
      await pageEventHandlers['popup'][0](mockPopup);
      expect(mockPopup.close).toHaveBeenCalled();
    });
  });

  describe('DOM and Artifact Limits', () => {
    it('distinguishes total document elements from computed styles count in metadata', async () => {
      // Mock page evaluation returning 2,500 total elements but 100 styles collected
      mockPage.evaluate.mockResolvedValueOnce({
        totalDomElements: 2500,
        computedStyles: Array(100).fill(VALID_COMPUTED_STYLES[0]),
      });

      const result = await service.capture({ url: 'https://example.com/audit' });

      expect(result.metadata.domElementCount).toBe(2500);
      expect(result.metadata.computedStylesCount).toBe(100);
      expect(result.computedStyles.length).toBe(100);
    });

    it('fails when screenshot buffer is empty', async () => {
      mockPage.screenshot.mockResolvedValueOnce(Buffer.alloc(0));

      await expect(
        service.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.ARTIFACT_GENERATION_FAILED,
        safeReason: 'Screenshot output is empty or invalid',
      });
    });

    it('fails when screenshot buffer lacks valid PNG magic header bytes', async () => {
      mockPage.screenshot.mockResolvedValueOnce(Buffer.from('not-a-valid-png-image'));

      await expect(
        service.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.ARTIFACT_GENERATION_FAILED,
        safeReason: 'Captured screenshot is missing valid PNG magic header bytes',
      });
    });

    it('fails when screenshot exceeds configured size limit', async () => {
      const oversized = Buffer.concat([
        PNG_MAGIC_BYTES,
        Buffer.alloc(11 * 1024 * 1024),
      ]);
      mockPage.screenshot.mockResolvedValueOnce(oversized);

      await expect(
        service.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.ARTIFACT_LIMIT_EXCEEDED,
      });
    });

    it('fails when DOM snapshot is empty', async () => {
      mockPage.content.mockResolvedValueOnce('   ');

      await expect(
        service.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.ARTIFACT_GENERATION_FAILED,
        safeReason: 'DOM snapshot output is empty',
      });
    });

    it('fails when DOM snapshot exceeds configured byte size limit', async () => {
      const oversizedDom = 'a'.repeat(6 * 1024 * 1024);
      mockPage.content.mockResolvedValueOnce(oversizedDom);

      await expect(
        service.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.ARTIFACT_LIMIT_EXCEEDED,
      });
    });

    it('passes maxDomElements limit to page.evaluate for computed styles', async () => {
      await service.capture(
        { url: 'https://example.com/audit' },
        { maxDomElements: 42 },
      );

      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), 42);
    });

    it('fails when computed styles extraction does not return an array or valid result', async () => {
      mockPage.evaluate.mockResolvedValueOnce({
        totalDomElements: 'not-a-number' as any,
        computedStyles: 'not-an-array' as any,
      });

      await expect(
        service.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.ARTIFACT_GENERATION_FAILED,
        safeReason: 'Computed styles extraction did not return an array',
      });
    });
  });

  describe('Error Sanitization and Confidentiality', () => {
    it('does not expose internal credentials or internal IP addresses in error reason', async () => {
      mockPage.url.mockReturnValue('http://admin:super_secret@10.200.1.5/internal');
      mockDestinationGuard.validate
        .mockResolvedValueOnce(VALID_DESTINATION)
        .mockRejectedValueOnce(
          new DestinationGuardError(
            DestinationErrorCode.BLOCKED_DESTINATION,
            'Destination IP address is non-globally routable or reserved',
          ),
        );

      try {
        await service.capture({ url: 'https://example.com/audit' });
        fail('Expected service.capture to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        const captureError = err as Error;
        expect(captureError.message).not.toContain('super_secret');
        expect(captureError.message).not.toContain('10.200.1.5');
      }
    });

    it('sanitizeErrorMessage redacts embedded credentials from URL strings', () => {
      expect(
        sanitizeErrorMessage('Error navigating to http://alice:supersecret@example.com/test'),
      ).toBe('Error navigating to http://***:***@example.com/test');
      expect(
        sanitizeErrorMessage('Failed https://token:secret123@sub.domain.org:8080/path?q=1'),
      ).toBe('Failed https://***:***@sub.domain.org:8080/path?q=1');
      expect(sanitizeErrorMessage('Normal error message without credentials')).toBe(
        'Normal error message without credentials',
      );
    });

    it('redacts credentials from unexpected error cause messages', async () => {
      mockPage.goto.mockRejectedValueOnce(
        new Error('Navigation failed at http://bot:top_secret_pw@unreachable.test/'),
      );

      try {
        await service.capture({ url: 'https://example.com/audit' });
        fail('Expected service.capture to throw');
      } catch (err: any) {
        expect(err.code).toBe(CaptureErrorCode.NAVIGATION_FAILED);
        expect(err.message).not.toContain('top_secret_pw');
        if (err.cause && err.cause.message) {
          expect(err.cause.message).not.toContain('top_secret_pw');
          expect(err.cause.message).toContain('***:***@unreachable.test');
        }
      }
    });

    it('strictly bounds computed styles to maxDomElements even if evaluation returns more items', async () => {
      const extraStyles: ElementComputedStyle[] = Array.from({ length: 15 }, (_, i) => ({
        selector: `div:nth-of-type(${i + 1})`,
        tagName: 'div',
        boundingBox: { x: i * 10, y: i * 10, width: 100, height: 50 },
        styles: {
          color: 'rgb(0, 0, 0)',
          backgroundColor: 'rgb(255, 255, 255)',
          fontSize: '16px',
          fontWeight: '400',
          lineHeight: '24px',
          display: 'block',
          visibility: 'visible',
          margin: '0px',
          padding: '0px',
        },
      }));

      mockPage.evaluate.mockResolvedValueOnce({
        totalDomElements: 45,
        computedStyles: extraStyles,
      });

      const result = await service.capture(
        { url: 'https://example.com/audit' },
        { maxDomElements: 5 },
      );

      // Total DOM elements reflects full document, but computedStyles is strictly bounded to 5
      expect(result.metadata.domElementCount).toBe(45);
      expect(result.metadata.computedStylesCount).toBe(5);
      expect(result.computedStyles.length).toBe(5);
      expect(result.computedStyles.length).toBe(result.metadata.computedStylesCount);
    });

    it('sanitizes non-finite boundingBox coordinates to null', async () => {
      mockPage.evaluate.mockResolvedValueOnce({
        totalDomElements: 1,
        computedStyles: [
          {
            selector: 'div',
            tagName: 'div',
            boundingBox: null,
            styles: {
              color: 'rgb(0, 0, 0)',
              backgroundColor: 'rgb(255, 255, 255)',
              fontSize: '16px',
              fontWeight: '400',
              lineHeight: '24px',
              display: 'block',
              visibility: 'visible',
              margin: '0px',
              padding: '0px',
            },
          },
        ],
      });

      const result = await service.capture({ url: 'https://example.com/audit' });
      expect(result.computedStyles[0].boundingBox).toBeNull();
    });

    it('rejects with ARTIFACT_GENERATION_FAILED when DOM snapshot is whitespace only', async () => {
      mockPage.content.mockResolvedValueOnce('   \n\t  \r\n  ');

      await expect(
        service.capture({ url: 'https://example.com/audit' }),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.ARTIFACT_GENERATION_FAILED,
        safeReason: 'DOM snapshot output is empty',
      });
    });

    it('prevents late asynchronous completion from returning success after overall timeout fires', async () => {
      // Simulate slow evaluate that completes after timeout fires
      mockPage.evaluate.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          totalDomElements: 5,
          computedStyles: VALID_COMPUTED_STYLES,
        };
      });

      await expect(
        service.capture(
          { url: 'https://example.com/audit' },
          { overallTimeoutMs: 30 },
        ),
      ).rejects.toMatchObject({
        code: CaptureErrorCode.TIMEOUT,
        safeReason: expect.stringContaining('Overall capture exceeded 30ms timeout'),
      });

      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });
});
