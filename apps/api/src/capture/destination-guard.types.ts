/**
 * Destination Guard Error Taxonomy and Data Contracts.
 *
 * Defines stable typed error categories and validation results for pre-navigation
 * destination validation and SSRF filtering.
 */

export enum DestinationErrorCode {
  INVALID_TARGET = 'INVALID_TARGET',
  BLOCKED_DESTINATION = 'BLOCKED_DESTINATION',
  DNS_RESOLUTION_FAILED = 'DNS_RESOLUTION_FAILED',
}

export class DestinationGuardError extends Error {
  constructor(
    public readonly code: DestinationErrorCode,
    public readonly safeReason: string,
  ) {
    super(`[${code}] ${safeReason}`);
    this.name = 'DestinationGuardError';
  }
}

export interface ValidatedDestination {
  /**
   * The original, unmutated input string.
   */
  readonly originalUrl: string;

  /**
   * Normalized URL representation with standardized protocol and path encoding.
   */
  readonly normalizedUrl: string;

  /**
   * Scheme validated against the allowlist (strictly 'http' or 'https').
   */
  readonly scheme: 'http' | 'https';

  /**
   * Extracted hostname, lowercased and stripped of IPv6 brackets or single trailing dot.
   */
  readonly hostname: string;

  /**
   * Resolved port number (explicitly parsed or default 80/443).
   */
  readonly port: number;

  /**
   * Globally-routable IP addresses to which the destination resolved (or the IP literal).
   */
  readonly resolvedIps: string[];

  /**
   * Flag indicating whether the destination target was an IP literal rather than a DNS hostname.
   */
  readonly isIpLiteral: boolean;
}

export type DestinationValidationResult =
  | { readonly isValid: true; readonly destination: ValidatedDestination }
  | { readonly isValid: false; readonly error: DestinationGuardError };
