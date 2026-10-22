import { ValidatedDestination } from './destination-guard.types';

/**
 * Capture error categories for typed error handling.
 */
export enum CaptureErrorCode {
  INVALID_TARGET = 'INVALID_TARGET',
  BLOCKED_DESTINATION = 'BLOCKED_DESTINATION',
  BLOCKED_REDIRECT = 'BLOCKED_REDIRECT',
  DNS_RESOLUTION_FAILED = 'DNS_RESOLUTION_FAILED',
  BROWSER_LAUNCH_FAILED = 'BROWSER_LAUNCH_FAILED',
  NAVIGATION_FAILED = 'NAVIGATION_FAILED',
  TIMEOUT = 'TIMEOUT',
  ARTIFACT_GENERATION_FAILED = 'ARTIFACT_GENERATION_FAILED',
  ARTIFACT_LIMIT_EXCEEDED = 'ARTIFACT_LIMIT_EXCEEDED',
}

/**
 * Sanitizes an error message by redacting raw embedded credentials in URLs.
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return '';
  return message.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:]+):([^@]+)@/g,
    '$1***:***@',
  );
}

/**
 * Typed, safe error returned or thrown by CaptureService.
 * Sanitized to never leak raw credentials, internal network paths, or stack traces.
 */
export class CaptureError extends Error {
  public readonly cause?: unknown;

  constructor(
    public readonly code: CaptureErrorCode,
    public readonly safeReason: string,
    cause?: unknown,
  ) {
    super(`[${code}] ${safeReason}`);
    this.name = 'CaptureError';
    if (cause instanceof Error) {
      this.cause = {
        name: cause.name,
        message: sanitizeErrorMessage(cause.message),
      };
    } else if (typeof cause === 'string') {
      this.cause = sanitizeErrorMessage(cause);
    } else {
      this.cause = cause;
    }
  }
}

/**
 * Bounded structure representing computed styles for an extracted DOM element.
 * Gathers attributes essential for contrast, typography, touch target, and spacing checks.
 */
export interface ElementComputedStyle {
  selector: string;
  tagName: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  styles: {
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    display: string;
    visibility: string;
    margin: string;
    padding: string;
  };
  textSnippet?: string;
}

/**
 * Capture metadata recording timing, dimensions, destinations, and artifact counts.
 */
export interface CaptureMetadata {
  captureTimestamp: string;
  durationMs: number;
  viewport: { width: number; height: number };
  initialUrl: string;
  finalUrl: string;
  resolvedIps: string[];
  redirectCount: number;
  domElementCount: number;
  screenshotSizeBytes: number;
  domSizeBytes: number;
  computedStylesCount: number;
}

/**
 * Input request for capture service.
 */
export interface CaptureRequest {
  url: string;
}

/**
 * Complete, validated capture output contract.
 */
export interface CaptureResult {
  readonly success: true;
  readonly metadata: CaptureMetadata;
  readonly screenshot: Buffer;
  readonly domSnapshot: string;
  readonly computedStyles: ElementComputedStyle[];
  readonly validatedDestination: ValidatedDestination;
}

/**
 * Bounded resource and policy configuration for CaptureService.
 */
export interface CapturePolicy {
  viewport: { width: number; height: number };
  navigationTimeoutMs: number;
  overallTimeoutMs: number;
  maxRedirects: number;
  maxScreenshotSizeBytes: number;
  maxDomSnapshotSizeBytes: number;
  maxDomElements: number;
}
