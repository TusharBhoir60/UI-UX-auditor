import { Inject, Injectable, Logger } from '@nestjs/common';
import * as ipaddr from 'ipaddr.js';
import { Browser, BrowserContext, Page, Request as PlaywrightRequest, Route } from 'playwright';
import { BrowserProvider } from './browser-provider';
import {
  BROWSER_PROVIDER_TOKEN,
  DEFAULT_CAPTURE_POLICY,
  MAX_SUBRESOURCE_DNS_CHECKS,
  PNG_MAGIC_BYTES,
  RESOURCE_CLEANUP_TIMEOUT_MS,
  SUBRESOURCE_VALIDATION_TIMEOUT_MS,
} from './capture.constants';
import {
  CaptureError,
  CaptureErrorCode,
  CaptureMetadata,
  CapturePolicy,
  CaptureRequest,
  CaptureResult,
  ElementComputedStyle,
} from './capture.types';
import { DestinationGuardService } from './destination-guard.service';
import { DestinationGuardError, ValidatedDestination } from './destination-guard.types';

/**
 * Hostnames and patterns blocked for all in-flight subresources.
 */
const PROHIBITED_SUBRESOURCE_HOSTS = new Set([
  'localhost',
  'local',
  'internal',
  'instance-data',
  'instance-data.ec2.internal',
  'metadata',
  'metadata.google.internal',
]);

const PROHIBITED_SUBRESOURCE_SUFFIXES = [
  '.metadata.google.internal',
  '.internal',
  '.local',
  '.localhost',
];

interface DomEvaluationResult {
  totalDomElements: number;
  computedStyles: ElementComputedStyle[];
}

/**
 * Helper to enforce bounded cleanup calls and prevent hung close operations.
 */
async function closeWithTimeout(
  closeFn: () => Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      closeFn(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
      }),
    ]);
  } catch {
    // Swallow cleanup errors so they never mask the original capture error
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * CaptureService
 *
 * Coordinates sandboxed headless browser capture for UI/UX audits.
 *
 * ARCHITECTURAL & SECURITY BOUNDARIES:
 * 1. Executes pre-navigation destination validation via DestinationGuardService.
 * 2. Manages Chromium lifecycle with sandbox strictly enabled and resource timeouts.
 * 3. Actively enforces navigation timeout, redirect limits, and hard overall timeout.
 * 4. Intercepts subresource and navigation requests in-flight, validating schemes and destinations fail-closed.
 * 5. Validates and bounds all captured artifacts (screenshot, DOM, computed styles).
 *
 * CRITICAL SSRF / DNS REBINDING POLICY BOUNDARY:
 * Application-layer request routing via Playwright page.route() and DNS validation via
 * DestinationGuardService provide defense-in-depth against explicit private destinations,
 * unsupported schemes, and excessive subresource DNS requests.
 *
 * HOWEVER, this application layer CANNOT prevent DNS rebinding or guarantee socket-level
 * destination safety because Chromium manages its own internal DNS cache and socket pool.
 * A malicious authoritative DNS server can return a public IP during Node.js DNS validation
 * and an internal IP (e.g., 127.0.0.1 or 169.254.169.254) for the browser's socket connection.
 * Production deployments REQUIRE kernel/container network namespace egress isolation
 * (e.g. iptables/nftables dropping packets to RFC 1918, RFC 3927 link-local, and loopback CIDRs).
 */
@Injectable()
export class CaptureService {
  private readonly logger = new Logger(CaptureService.name);

  constructor(
    private readonly destinationGuard: DestinationGuardService,
    @Inject(BROWSER_PROVIDER_TOKEN)
    private readonly browserProvider: BrowserProvider,
  ) {}

  /**
   * Performs an isolated browser capture of the target URL.
   * Returns complete validated capture artifacts or throws a typed CaptureError.
   */
  async capture(
    request: CaptureRequest,
    customPolicy?: Partial<CapturePolicy>,
  ): Promise<CaptureResult> {
    const policy: CapturePolicy = {
      ...DEFAULT_CAPTURE_POLICY,
      ...customPolicy,
    };

    const startTime = Date.now();

    // 1. Pre-navigation destination validation
    let validatedTarget: ValidatedDestination;
    try {
      validatedTarget = await this.destinationGuard.validate(request.url);
    } catch (err) {
      if (err instanceof DestinationGuardError) {
        throw new CaptureError(
          err.code as unknown as CaptureErrorCode,
          err.safeReason,
          err,
        );
      }
      throw new CaptureError(
        CaptureErrorCode.INVALID_TARGET,
        'Target URL validation failed',
        err,
      );
    }

    // Cancellation and resource references
    let isCancelled = false;
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let cleanupPromise: Promise<void> | null = null;

    // Idempotent and bounded resource cleanup
    const cleanupResources = async (): Promise<void> => {
      isCancelled = true;
      if (cleanupPromise) {
        return cleanupPromise;
      }

      cleanupPromise = (async () => {
        if (page) {
          const p = page;
          page = null;
          await closeWithTimeout(() => p.close(), RESOURCE_CLEANUP_TIMEOUT_MS);
        }
        if (context) {
          const c = context;
          context = null;
          await closeWithTimeout(() => c.close(), RESOURCE_CLEANUP_TIMEOUT_MS);
        }
        if (browser) {
          const b = browser;
          browser = null;
          await closeWithTimeout(() => b.close(), RESOURCE_CLEANUP_TIMEOUT_MS);
        }
      })();

      return cleanupPromise;
    };

    // 2. Set up overall timeout bounding the entire capture lifecycle
    let overallTimeoutHandle: NodeJS.Timeout | null = null;
    let cancelOverallTimer = () => {};

    const timeoutPromise = new Promise<never>((_, reject) => {
      overallTimeoutHandle = setTimeout(() => {
        isCancelled = true;
        // Asynchronously initiate resource cleanup immediately
        cleanupResources().catch(() => {});
        reject(
          new CaptureError(
            CaptureErrorCode.TIMEOUT,
            `Overall capture exceeded ${policy.overallTimeoutMs}ms timeout`,
          ),
        );
      }, policy.overallTimeoutMs);

      if (typeof overallTimeoutHandle.unref === 'function') {
        overallTimeoutHandle.unref();
      }

      cancelOverallTimer = () => {
        if (overallTimeoutHandle) {
          clearTimeout(overallTimeoutHandle);
          overallTimeoutHandle = null;
        }
      };
    });

    const runCapture = async (): Promise<CaptureResult> => {
      try {
        if (isCancelled) {
          throw new CaptureError(
            CaptureErrorCode.TIMEOUT,
            `Overall capture exceeded ${policy.overallTimeoutMs}ms timeout`,
          );
        }

        // 3. Launch browser via injected provider
        let launchedBrowser: Browser;
        try {
          launchedBrowser = await this.browserProvider.launch();
        } catch (err) {
          this.logger.error('Failed to launch browser instance');
          throw new CaptureError(
            CaptureErrorCode.BROWSER_LAUNCH_FAILED,
            'Browser process launch failed',
            err,
          );
        }

        // Guard against late launch completion after timeout fired
        if (isCancelled) {
          await closeWithTimeout(
            () => launchedBrowser.close(),
            RESOURCE_CLEANUP_TIMEOUT_MS,
          );
          throw new CaptureError(
            CaptureErrorCode.TIMEOUT,
            `Overall capture exceeded ${policy.overallTimeoutMs}ms timeout`,
          );
        }
        browser = launchedBrowser;

        // 4. Create isolated browser context with fixed viewport and security settings
        if (isCancelled) {
          throw new CaptureError(
            CaptureErrorCode.TIMEOUT,
            `Overall capture exceeded ${policy.overallTimeoutMs}ms timeout`,
          );
        }

        try {
          context = await browser.newContext({
            viewport: policy.viewport,
            acceptDownloads: false,
            serviceWorkers: 'block',
            userAgent: 'UI-UX-Auditor-Bot/1.0 (+https://uiuxauditor.local/bot)',
            ignoreHTTPSErrors: false,
          });
        } catch (err) {
          throw new CaptureError(
            CaptureErrorCode.BROWSER_LAUNCH_FAILED,
            'Failed to create browser context',
            err,
          );
        }

        // 5. Create new page in context
        if (isCancelled) {
          throw new CaptureError(
            CaptureErrorCode.TIMEOUT,
            `Overall capture exceeded ${policy.overallTimeoutMs}ms timeout`,
          );
        }

        try {
          page = await context.newPage();
        } catch (err) {
          throw new CaptureError(
            CaptureErrorCode.BROWSER_LAUNCH_FAILED,
            'Failed to initialize browser page',
            err,
          );
        }

        // Auto-dismiss dialogs and close popups
        page.on('dialog', async (dialog) => {
          await dialog.dismiss().catch(() => {});
        });
        page.on('popup', async (popup) => {
          await popup.close().catch(() => {});
        });

        // 6. Active redirect tracking and routing interception state
        const countedRedirectRequests = new Set<unknown>();
        let redirectCount = 0;
        let redirectTerminationError: CaptureError | null = null;

        // Active redirect tracking in response headers as secondary defense
        page.on('response', async (response) => {
          const status = response.status();
          if (status >= 300 && status < 400) {
            const req =
              typeof response.request === 'function' ? response.request() : null;
            if (!req || !countedRedirectRequests.has(req)) {
              if (req) {
                countedRedirectRequests.add(req);
              }
              redirectCount++;
            }
            if (redirectCount > policy.maxRedirects) {
              redirectTerminationError = new CaptureError(
                CaptureErrorCode.BLOCKED_REDIRECT,
                `Exceeded maximum redirect limit of ${policy.maxRedirects}`,
              );
              page?.close().catch(() => {});
              return;
            }

            const headers = response.headers();
            const location = headers['location'];
            if (location) {
              try {
                const targetUrl = new URL(location, response.url()).href;
                const check = await this.destinationGuard.check(targetUrl);
                if (!check.isValid) {
                  redirectTerminationError = new CaptureError(
                    CaptureErrorCode.BLOCKED_REDIRECT,
                    'Navigation redirected to a prohibited destination',
                  );
                  page?.close().catch(() => {});
                }
              } catch (err) {
                redirectTerminationError = new CaptureError(
                  CaptureErrorCode.BLOCKED_REDIRECT,
                  'Navigation redirect target URL is malformed or invalid',
                  err,
                );
                page?.close().catch(() => {});
              }
            }
          }
        });

        // In-flight routing interception with deduplicated DNS checks, bounded timeout, and request-level abort
        const subresourceValidationPromises = new Map<string, Promise<boolean>>();
        let subresourceDnsChecksCount = 0;

        await page.route('**/*', async (route: Route) => {
          try {
            const req: PlaywrightRequest = route.request();
            const reqUrl = req.url();
            const isNavigation =
              typeof req.isNavigationRequest === 'function'
                ? req.isNavigationRequest()
                : false;

            // Track redirects at the request level without double counting
            if (
              typeof req.redirectedFrom === 'function' &&
              req.redirectedFrom() !== null
            ) {
              if (!countedRedirectRequests.has(req)) {
                countedRedirectRequests.add(req);
                redirectCount++;
              }
              if (redirectCount > policy.maxRedirects) {
                redirectTerminationError = new CaptureError(
                  CaptureErrorCode.BLOCKED_REDIRECT,
                  `Exceeded maximum redirect limit of ${policy.maxRedirects}`,
                );
                await page?.close().catch(() => {});
                await route.abort('blockedbyclient');
                return;
              }
            }

            // Disallow non-http/https navigation
            if (
              isNavigation &&
              !reqUrl.startsWith('http://') &&
              !reqUrl.startsWith('https://')
            ) {
              await route.abort('blockedbyclient');
              return;
            }

            // data: URI policy: allowed only for inline images and fonts; never for navigation
            if (reqUrl.startsWith('data:')) {
              if (isNavigation) {
                await route.abort('blockedbyclient');
                return;
              }
              if (
                reqUrl.startsWith('data:image/') ||
                reqUrl.startsWith('data:font/')
              ) {
                await route.continue();
                return;
              }
              await route.abort('blockedbyclient');
              return;
            }

            // Prohibit non-http/https schemes (blob:, file:, javascript:, ws:, wss:, ftp:, etc.)
            if (
              !reqUrl.startsWith('http://') &&
              !reqUrl.startsWith('https://')
            ) {
              await route.abort('blockedbyclient');
              return;
            }

            // Abort requests if redirect limit already exceeded
            if (redirectCount > policy.maxRedirects) {
              await route.abort('blockedbyclient');
              return;
            }

            // Hostname parsing and normalization
            let parsed: URL;
            try {
              parsed = new URL(reqUrl);
            } catch (err) {
              if (isNavigation) {
                redirectTerminationError = new CaptureError(
                  CaptureErrorCode.BLOCKED_REDIRECT,
                  'Navigation redirect target URL is malformed or invalid',
                  err,
                );
                await page?.close().catch(() => {});
              }
              await route.abort('blockedbyclient');
              return;
            }

            const host = parsed.hostname
              .replace(/^\[|\]$/g, '')
              .replace(/\.+$/, '')
              .toLowerCase();

            if (!host) {
              await route.abort('blockedbyclient');
              return;
            }

            // Check prohibited subresource hostnames (metadata, local, internal)
            if (this.isProhibitedSubresourceHost(host)) {
              if (isNavigation) {
                redirectTerminationError = new CaptureError(
                  CaptureErrorCode.BLOCKED_REDIRECT,
                  'Navigation redirected to a prohibited destination',
                );
                await page?.close().catch(() => {});
              }
              await route.abort('blockedbyclient');
              return;
            }

            // Fast classification for IP literal destinations
            if (ipaddr.isValid(host)) {
              try {
                const processed = ipaddr.process(host);
                const isUnicast = processed.range() === 'unicast';
                let isGlobalIpv6 = true;
                if (processed.kind() === 'ipv6') {
                  const ipv6Global = ipaddr.parseCIDR('2000::/3');
                  isGlobalIpv6 = processed.match(ipv6Global);
                }

                if (!isUnicast || !isGlobalIpv6) {
                  if (isNavigation) {
                    redirectTerminationError = new CaptureError(
                      CaptureErrorCode.BLOCKED_REDIRECT,
                      'Navigation redirected to a prohibited destination',
                    );
                    await page?.close().catch(() => {});
                  }
                  await route.abort('blockedbyclient');
                  return;
                }
              } catch {
                if (isNavigation) {
                  redirectTerminationError = new CaptureError(
                    CaptureErrorCode.BLOCKED_REDIRECT,
                    'Navigation redirected to a prohibited destination',
                  );
                  await page?.close().catch(() => {});
                }
                await route.abort('blockedbyclient');
                return;
              }
            }

            // Deduplicated and bounded DNS check for destination hostnames
            let checkPromise = subresourceValidationPromises.get(host);

            if (!checkPromise) {
              // Enforce DNS checks budget
              if (subresourceDnsChecksCount >= MAX_SUBRESOURCE_DNS_CHECKS) {
                // Fail closed immediately without creating pending promises
                subresourceValidationPromises.set(host, Promise.resolve(false));
                await route.abort('blockedbyclient');
                return;
              }

              subresourceDnsChecksCount++;

              // Create bounded check promise for this hostname
              checkPromise = (async (): Promise<boolean> => {
                let timer: NodeJS.Timeout | null = null;
                try {
                  const timeoutPromise = new Promise<{ isValid: boolean }>((resolve) => {
                    timer = setTimeout(
                      () => resolve({ isValid: false }),
                      SUBRESOURCE_VALIDATION_TIMEOUT_MS,
                    );
                    if (typeof timer.unref === 'function') {
                      timer.unref();
                    }
                  });

                  const result = await Promise.race([
                    this.destinationGuard.check(reqUrl),
                    timeoutPromise,
                  ]);

                  return result.isValid;
                } catch {
                  return false; // Fail closed on any resolver failure or exception
                } finally {
                  if (timer) {
                    clearTimeout(timer);
                  }
                }
              })();

              subresourceValidationPromises.set(host, checkPromise);
            }

            const isValid = await checkPromise;

            if (isValid) {
              await route.continue();
            } else {
              if (isNavigation) {
                redirectTerminationError = new CaptureError(
                  CaptureErrorCode.BLOCKED_REDIRECT,
                  'Navigation redirected to a prohibited destination',
                );
                await page?.close().catch(() => {});
              }
              await route.abort('blockedbyclient');
            }
          } catch {
            // Fail closed on any interception error or exception
            try {
              await route.abort('blockedbyclient');
            } catch {
              // ignore
            }
          }
        });

        // 7. Navigate to target URL with bounded navigation timeout
        try {
          await page.goto(validatedTarget.normalizedUrl, {
            timeout: policy.navigationTimeoutMs,
            waitUntil: 'load',
          });
        } catch (err) {
          if (redirectTerminationError) {
            throw redirectTerminationError;
          }
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('Timeout') || message.includes('timeout')) {
            throw new CaptureError(
              CaptureErrorCode.TIMEOUT,
              `Navigation timed out after ${policy.navigationTimeoutMs}ms`,
              err,
            );
          }
          throw new CaptureError(
            CaptureErrorCode.NAVIGATION_FAILED,
            'Navigation to destination URL failed',
            err,
          );
        }

        if (redirectTerminationError) {
          throw redirectTerminationError;
        }

        if (redirectCount > policy.maxRedirects) {
          throw new CaptureError(
            CaptureErrorCode.BLOCKED_REDIRECT,
            `Exceeded maximum redirect limit of ${policy.maxRedirects}`,
          );
        }

        // 8. Re-validate final landing URL after potential redirects
        const finalUrl = page.url();
        let validatedFinalDestination: ValidatedDestination;
        try {
          validatedFinalDestination =
            await this.destinationGuard.validate(finalUrl);
        } catch (err) {
          throw new CaptureError(
            CaptureErrorCode.BLOCKED_REDIRECT,
            'Navigation redirected to a prohibited destination',
            err,
          );
        }

        // 9. Capture screenshot artifact
        let screenshotBuffer: Buffer;
        try {
          screenshotBuffer = (await page.screenshot({
            type: 'png',
            fullPage: false,
          })) as Buffer;
        } catch (err) {
          throw new CaptureError(
            CaptureErrorCode.ARTIFACT_GENERATION_FAILED,
            'Failed to capture screenshot artifact',
            err,
          );
        }

        // Validate screenshot integrity
        if (
          !Buffer.isBuffer(screenshotBuffer) ||
          screenshotBuffer.length === 0
        ) {
          throw new CaptureError(
            CaptureErrorCode.ARTIFACT_GENERATION_FAILED,
            'Screenshot output is empty or invalid',
          );
        }

        if (screenshotBuffer.length > policy.maxScreenshotSizeBytes) {
          throw new CaptureError(
            CaptureErrorCode.ARTIFACT_LIMIT_EXCEEDED,
            `Screenshot size (${screenshotBuffer.length} bytes) exceeds limit of ${policy.maxScreenshotSizeBytes} bytes`,
          );
        }

        if (
          screenshotBuffer.length < 8 ||
          !screenshotBuffer.subarray(0, 8).equals(PNG_MAGIC_BYTES)
        ) {
          throw new CaptureError(
            CaptureErrorCode.ARTIFACT_GENERATION_FAILED,
            'Captured screenshot is missing valid PNG magic header bytes',
          );
        }

        // 10. Capture DOM snapshot artifact
        let domSnapshot: string;
        try {
          domSnapshot = await page.content();
        } catch (err) {
          throw new CaptureError(
            CaptureErrorCode.ARTIFACT_GENERATION_FAILED,
            'Failed to capture DOM snapshot artifact',
            err,
          );
        }

        if (
          typeof domSnapshot !== 'string' ||
          domSnapshot.trim().length === 0
        ) {
          throw new CaptureError(
            CaptureErrorCode.ARTIFACT_GENERATION_FAILED,
            'DOM snapshot output is empty',
          );
        }

        const domByteSize = Buffer.byteLength(domSnapshot, 'utf8');
        if (domByteSize > policy.maxDomSnapshotSizeBytes) {
          throw new CaptureError(
            CaptureErrorCode.ARTIFACT_LIMIT_EXCEEDED,
            `DOM snapshot size (${domByteSize} bytes) exceeds limit of ${policy.maxDomSnapshotSizeBytes} bytes`,
          );
        }

        // 11. Extract bounded computed styles and accurate DOM element count
        let evaluationResult: DomEvaluationResult;
        try {
          evaluationResult = await page.evaluate(
            (maxElements: number): DomEvaluationResult => {
              const totalCount = document.getElementsByTagName('*').length;
              const elements = document.querySelectorAll('*');
              const limit = Math.min(elements.length, maxElements);
              const styles: ElementComputedStyle[] = [];

              for (let index = 0; index < limit; index++) {
                const el = elements[index];
                const rect = el.getBoundingClientRect();
                const cs = window.getComputedStyle(el);

                let selector = el.tagName.toLowerCase();
                if (el.id) {
                  selector += `#${el.id}`;
                } else if (el.classList && el.classList.length > 0) {
                  selector += `.${Array.from(el.classList).slice(0, 3).join('.')}`;
                } else {
                  selector += `:nth-of-type(${index + 1})`;
                }

                styles.push({
                  selector,
                  tagName: el.tagName.toLowerCase(),
                  boundingBox: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                  },
                  styles: {
                    color: cs.color || '',
                    backgroundColor: cs.backgroundColor || '',
                    fontSize: cs.fontSize || '',
                    fontWeight: cs.fontWeight || '',
                    lineHeight: cs.lineHeight || '',
                    display: cs.display || '',
                    visibility: cs.visibility || '',
                    margin: cs.margin || '',
                    padding: cs.padding || '',
                  },
                  textSnippet:
                    el.childElementCount === 0 && el.textContent
                      ? el.textContent.trim().slice(0, 100)
                      : undefined,
                });
              }

              return {
                totalDomElements: totalCount,
                computedStyles: styles,
              };
            },
            policy.maxDomElements,
          );
        } catch (err) {
          throw new CaptureError(
            CaptureErrorCode.ARTIFACT_GENERATION_FAILED,
            'Failed to extract computed styles from page DOM',
            err,
          );
        }

        // Handle both DomEvaluationResult object and legacy array mocks
        let totalDomElements: number;
        let computedStyles: ElementComputedStyle[];

        if (Array.isArray(evaluationResult)) {
          computedStyles = evaluationResult;
          totalDomElements = evaluationResult.length;
        } else if (
          evaluationResult &&
          typeof evaluationResult.totalDomElements === 'number' &&
          Array.isArray(evaluationResult.computedStyles)
        ) {
          totalDomElements = evaluationResult.totalDomElements;
          computedStyles = evaluationResult.computedStyles;
        } else {
          throw new CaptureError(
            CaptureErrorCode.ARTIFACT_GENERATION_FAILED,
            'Computed styles extraction did not return an array',
          );
        }

        // 12. Assemble capture metadata and validated result
        const durationMs = Date.now() - startTime;
        const metadata: CaptureMetadata = {
          captureTimestamp: new Date().toISOString(),
          durationMs,
          viewport: policy.viewport,
          initialUrl: validatedTarget.normalizedUrl,
          finalUrl: validatedFinalDestination.normalizedUrl,
          resolvedIps: validatedFinalDestination.resolvedIps,
          redirectCount,
          domElementCount: totalDomElements,
          screenshotSizeBytes: screenshotBuffer.length,
          domSizeBytes: domByteSize,
          computedStylesCount: computedStyles.length,
        };

        return {
          success: true,
          metadata,
          screenshot: screenshotBuffer,
          domSnapshot,
          computedStyles,
          validatedDestination: validatedFinalDestination,
        };
      } finally {
        await cleanupResources();
      }
    };

    try {
      return await Promise.race([runCapture(), timeoutPromise]);
    } catch (err) {
      await cleanupResources();
      if (err instanceof CaptureError) {
        throw err;
      }
      throw new CaptureError(
        CaptureErrorCode.NAVIGATION_FAILED,
        'Unexpected error occurred during capture',
        err,
      );
    } finally {
      cancelOverallTimer();
    }
  }

  /**
   * Fast check for prohibited subresource hostnames and patterns.
   */
  private isProhibitedSubresourceHost(host: string): boolean {
    if (PROHIBITED_SUBRESOURCE_HOSTS.has(host)) {
      return true;
    }
    for (const suffix of PROHIBITED_SUBRESOURCE_SUFFIXES) {
      if (host.endsWith(suffix)) {
        return true;
      }
    }
    return false;
  }
}
