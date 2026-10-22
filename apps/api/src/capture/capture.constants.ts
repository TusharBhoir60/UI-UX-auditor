import { CapturePolicy } from './capture.types';

/**
 * Standard default capture policy based on project specifications.
 * All limits are bounded and centralized to prevent resource exhaustion.
 */
export const DEFAULT_CAPTURE_POLICY: CapturePolicy = {
  // Desktop standard viewport (1280x800) for single-viewport MVP
  viewport: { width: 1280, height: 800 },
  // Max wait time for main page load event
  navigationTimeoutMs: 15_000,
  // Hard outer ceiling bounding the entire capture lifecycle
  overallTimeoutMs: 30_000,
  // Max number of HTTP 3xx redirect hops allowed before aborting
  maxRedirects: 5,
  // 10 MB maximum screenshot size
  maxScreenshotSizeBytes: 10 * 1024 * 1024,
  // 5 MB maximum DOM HTML snapshot size
  maxDomSnapshotSizeBytes: 5 * 1024 * 1024,
  // Maximum DOM elements to inspect for computed-style collection
  maxDomElements: 1_000,
};

/**
 * Maximum number of distinct subresource hostnames to validate against DNS in one capture.
 * Prevents DNS exhaustion DoS attacks from pages with thousands of synthetic subdomains.
 */
export const MAX_SUBRESOURCE_DNS_CHECKS = 50;

/**
 * Timeout bounding individual resource cleanup operations (page/context/browser close).
 * Prevents cleanup operations from hanging indefinitely.
 */
export const RESOURCE_CLEANUP_TIMEOUT_MS = 2_000;

/**
 * Timeout bounding individual subresource DNS validation checks (2,000ms).
 * Prevents unresponsive DNS nameservers from hanging subresource route handlers.
 */
export const SUBRESOURCE_VALIDATION_TIMEOUT_MS = 2_000;

/**
 * NestJS Dependency Injection Token for BrowserProvider.
 */
export const BROWSER_PROVIDER_TOKEN = Symbol('BROWSER_PROVIDER_TOKEN');


/**
 * PNG Magic File Header (8 bytes).
 * Used to verify screenshot validity.
 */
export const PNG_MAGIC_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
