import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import * as ipaddr from 'ipaddr.js';
import {
  DestinationErrorCode,
  DestinationGuardError,
  DestinationValidationResult,
  ValidatedDestination,
} from './destination-guard.types';
import { DNS_RESOLVER_TOKEN, DnsResolver, SystemDnsResolver } from './dns-resolver';

/**
 * Prohibited cloud metadata hostnames and internal suffix patterns.
 */
const PROHIBITED_HOSTNAMES = new Set([
  'localhost',
  'local',
  'internal',
  'instance-data',
  'instance-data.ec2.internal',
  'metadata',
  'metadata.google.internal',
]);

const PROHIBITED_SUFFIXES = [
  '.metadata.google.internal',
  '.internal',
  '.local',
  '.localhost',
];

/**
 * IANA Global Unicast Address space allocation for IPv6 (RFC 4291 / RFC 3587).
 * IPv6 unicast addresses outside 2000::/3 are unassigned/reserved by IETF.
 */
const IPV6_GLOBAL_UNICAST_CIDR = ipaddr.parseCIDR('2000::/3');


/**
 * DestinationGuardService
 *
 * Implements an application-layer destination validation policy and SSRF filter.
 *
 * SECURITY NOTICE ON DNS REBINDING & TIME-OF-CHECK / TIME-OF-USE (TOCTOU):
 * Pre-navigation DNS resolution validation is an application-layer sanity filter.
 * It does NOT protect against DNS rebinding (where an authoritative nameserver returns
 * a public IP during pre-check and subsequently serves an internal address like 127.0.0.1
 * when the browser opens its socket connection).
 * Downstream stages must enforce in-flight socket request interception and operating
 * system / firewall egress restrictions dropping packets to all non-globally-routable CIDRs.
 */
@Injectable()
export class DestinationGuardService {
  private readonly logger = new Logger(DestinationGuardService.name);

  constructor(
    @Optional()
    @Inject(DNS_RESOLVER_TOKEN)
    private readonly dnsResolver: DnsResolver = new SystemDnsResolver(),
  ) {}

  /**
   * Validates a destination URL against the SSRF policy and resolves its IP addresses.
   * Throws DestinationGuardError on validation or classification failure.
   */
  async validate(rawUrl: string): Promise<ValidatedDestination> {
    // 1. Syntactic type, length, and control-character checks
    if (typeof rawUrl !== 'string') {
      throw new DestinationGuardError(
        DestinationErrorCode.INVALID_TARGET,
        'Target URL must be a non-empty string',
      );
    }

    if (rawUrl.length === 0 || rawUrl.length > 2048) {
      throw new DestinationGuardError(
        DestinationErrorCode.INVALID_TARGET,
        'Target URL length must be between 1 and 2048 characters',
      );
    }

    if (/[\s\r\n\t\x00-\x1F\x7F]/.test(rawUrl)) {
      throw new DestinationGuardError(
        DestinationErrorCode.INVALID_TARGET,
        'Target URL contains forbidden whitespace or control characters',
      );
    }

    // 2. Parse URL structure
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new DestinationGuardError(
        DestinationErrorCode.INVALID_TARGET,
        'Target URL is malformed or unparseable',
      );
    }

    // 3. Scheme validation (strictly http or https)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new DestinationGuardError(
        DestinationErrorCode.INVALID_TARGET,
        'Unsupported URL scheme: only http and https are permitted',
      );
    }

    // 4. Port validation (if explicitly present)
    if (parsed.port !== '') {
      const p = parseInt(parsed.port, 10);
      if (Number.isNaN(p) || p <= 0 || p > 65535) {
        throw new DestinationGuardError(
          DestinationErrorCode.INVALID_TARGET,
          'Target URL contains an invalid port number',
        );
      }
    }

    // 5. Embedded credentials check
    if (parsed.username !== '' || parsed.password !== '') {
      throw new DestinationGuardError(
        DestinationErrorCode.INVALID_TARGET,
        'URLs with embedded credentials are not permitted',
      );
    }

    // 6. Hostname extraction and normalization
    const rawHostname = parsed.hostname;
    if (!rawHostname || rawHostname.length === 0) {
      throw new DestinationGuardError(
        DestinationErrorCode.INVALID_TARGET,
        'Target URL does not contain a valid hostname',
      );
    }

    // Normalize: strip outer IPv6 brackets and trailing dots
    const cleanHost = rawHostname
      .replace(/^\[|\]$/g, '')
      .replace(/\.+$/, '')
      .toLowerCase();

    if (cleanHost.length === 0) {
      throw new DestinationGuardError(
        DestinationErrorCode.INVALID_TARGET,
        'Normalized hostname is empty',
      );
    }

    if (cleanHost.includes('..')) {
      throw new DestinationGuardError(
        DestinationErrorCode.INVALID_TARGET,
        'Target URL contains invalid consecutive dots in hostname',
      );
    }

    // 7. Prohibited metadata hostnames and internal suffixes
    if (this.isProhibitedHostname(cleanHost)) {
      throw new DestinationGuardError(
        DestinationErrorCode.BLOCKED_DESTINATION,
        'Access to metadata or local domain destinations is prohibited',
      );
    }

    // 8. Check if destination is an IP literal
    if (ipaddr.isValid(cleanHost)) {
      const processedIp = this.classifyAndValidateIp(cleanHost);
      return {
        originalUrl: rawUrl,
        normalizedUrl: parsed.toString(),
        scheme: parsed.protocol.replace(':', '') as 'http' | 'https',
        hostname: cleanHost,
        port: this.resolvePort(parsed),
        resolvedIps: [processedIp],
        isIpLiteral: true,
      };
    }

    // 9. Hostname DNS resolution
    let records;
    try {
      records = await this.dnsResolver.lookup(cleanHost);
    } catch {
      // Do not log the raw error or hostname to prevent leaking sensitive DNS/internal details
      this.logger.debug('DNS resolution failed for submitted hostname');
      throw new DestinationGuardError(
        DestinationErrorCode.DNS_RESOLUTION_FAILED,
        'DNS resolution failed for the destination hostname',
      );
    }

    if (!records || records.length === 0) {
      throw new DestinationGuardError(
        DestinationErrorCode.DNS_RESOLUTION_FAILED,
        'Hostname resolved to zero IP addresses',
      );
    }

    // 9. Multi-address validation (every returned address must satisfy policy)
    const validIps: string[] = [];
    for (const record of records) {
      if (!ipaddr.isValid(record.address)) {
        throw new DestinationGuardError(
          DestinationErrorCode.DNS_RESOLUTION_FAILED,
          'DNS resolution returned an invalid IP address format',
        );
      }

      const processedIp = this.classifyAndValidateIp(record.address);
      if (!validIps.includes(processedIp)) {
        validIps.push(processedIp);
      }
    }

    return {
      originalUrl: rawUrl,
      normalizedUrl: parsed.toString(),
      scheme: parsed.protocol.replace(':', '') as 'http' | 'https',
      hostname: cleanHost,
      port: this.resolvePort(parsed),
      resolvedIps: validIps,
      isIpLiteral: false,
    };
  }

  /**
   * Safe wrapper returning DestinationValidationResult instead of throwing.
   */
  async check(rawUrl: string): Promise<DestinationValidationResult> {
    try {
      const destination = await this.validate(rawUrl);
      return { isValid: true, destination };
    } catch (err) {
      if (err instanceof DestinationGuardError) {
        return { isValid: false, error: err };
      }
      return {
        isValid: false,
        error: new DestinationGuardError(
          DestinationErrorCode.INVALID_TARGET,
          'Unexpected validation error',
        ),
      };
    }
  }

  /**
   * Normalizes an IP address and verifies that it is strictly globally routable (unicast).
   * Automatically unfolds IPv4-mapped IPv6 addresses (e.g., ::ffff:127.0.0.1 -> 127.0.0.1).
   */
  private classifyAndValidateIp(ipString: string): string {
    // Prohibit zone identifiers (e.g., fe80::1%eth0)
    if (ipString.includes('%')) {
      throw new DestinationGuardError(
        DestinationErrorCode.BLOCKED_DESTINATION,
        'IP addresses containing zone identifiers are not permitted',
      );
    }

    let parsedIp: ipaddr.IPAddress;
    try {
      parsedIp = ipaddr.process(ipString);
    } catch {
      throw new DestinationGuardError(
        DestinationErrorCode.BLOCKED_DESTINATION,
        'Invalid or unparseable IP address',
      );
    }

    // In ipaddr.js, standard public addresses return 'unicast'.
    // Prohibits loopback, private, linkLocal, unspecified, multicast, broadcast,
    // carrierGradeNat, uniqueLocal, reserved, 6to4, and teredo ranges.
    const range = parsedIp.range();
    if (range !== 'unicast') {
      throw new DestinationGuardError(
        DestinationErrorCode.BLOCKED_DESTINATION,
        'Destination IP address is non-globally routable or reserved',
      );
    }

    // Enforce IANA Global Unicast Allocation for IPv6 (RFC 4291 / RFC 3587).
    // ipaddr.js labels addresses in unassigned/reserved spaces (e.g. 4000::/3, 8000::/3)
    // as 'unicast', but they are not globally routable. Only 2000::/3 is permitted.
    if (parsedIp.kind() === 'ipv6') {
      if (!parsedIp.match(IPV6_GLOBAL_UNICAST_CIDR)) {
        throw new DestinationGuardError(
          DestinationErrorCode.BLOCKED_DESTINATION,
          'IPv6 address is outside the IANA globally routable unicast allocation (2000::/3)',
        );
      }
    }

    return parsedIp.toString();
  }

  /**
   * Checks whether a hostname matches prohibited metadata or local naming patterns.
   */
  private isProhibitedHostname(hostname: string): boolean {
    if (PROHIBITED_HOSTNAMES.has(hostname)) {
      return true;
    }

    for (const suffix of PROHIBITED_SUFFIXES) {
      if (hostname.endsWith(suffix)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Resolves explicit or default port for a parsed URL.
   */
  private resolvePort(parsed: URL): number {
    if (parsed.port && parsed.port.length > 0) {
      const p = parseInt(parsed.port, 10);
      if (!Number.isNaN(p) && p > 0 && p <= 65535) {
        return p;
      }
    }
    return parsed.protocol === 'https:' ? 443 : 80;
  }
}
