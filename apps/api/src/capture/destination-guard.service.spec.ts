import { Test, TestingModule } from '@nestjs/testing';
import * as http from 'node:http';
import * as https from 'node:https';
import {
  DestinationGuardService,
} from './destination-guard.service';
import {
  DestinationErrorCode,
  DestinationGuardError,
} from './destination-guard.types';
import {
  DNS_RESOLVER_TOKEN,
  DnsLookupRecord,
  DnsResolver,
} from './dns-resolver';

describe('DestinationGuardService', () => {
  let service: DestinationGuardService;
  let mockResolver: jest.Mocked<DnsResolver>;
  let httpSpy: jest.SpyInstance;
  let httpsSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockResolver = {
      lookup: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DestinationGuardService,
        {
          provide: DNS_RESOLVER_TOKEN,
          useValue: mockResolver,
        },
      ],
    }).compile();

    service = module.get<DestinationGuardService>(DestinationGuardService);

    // Guardrail: verify NO outbound HTTP/HTTPS or network socket is created by the guard
    httpSpy = jest.spyOn(http, 'request');
    httpsSpy = jest.spyOn(https, 'request');
  });

  afterEach(() => {
    expect(httpSpy).not.toHaveBeenCalled();
    expect(httpsSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  describe('Valid public destinations', () => {
    it('accepts valid HTTPS public destination and resolves via mock DNS', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
      ]);

      const result = await service.validate('https://example.com/audit-path?tab=1');

      expect(mockResolver.lookup).toHaveBeenCalledWith('example.com');
      expect(result).toEqual({
        originalUrl: 'https://example.com/audit-path?tab=1',
        normalizedUrl: 'https://example.com/audit-path?tab=1',
        scheme: 'https',
        hostname: 'example.com',
        port: 443,
        resolvedIps: ['93.184.216.34'],
        isIpLiteral: false,
      });
    });

    it('accepts valid HTTP public destination on default port 80', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
      ]);

      const result = await service.validate('http://example.com');

      expect(result.scheme).toBe('http');
      expect(result.port).toBe(80);
      expect(result.resolvedIps).toEqual(['93.184.216.34']);
      expect(result.isIpLiteral).toBe(false);
    });

    it('accepts custom explicit port number', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
      ]);

      const result = await service.validate('https://example.com:8443/app');

      expect(result.port).toBe(8443);
    });

    it('accepts public IPv4 literal without triggering DNS lookup', async () => {
      const result = await service.validate('https://93.184.216.34/test');

      expect(mockResolver.lookup).not.toHaveBeenCalled();
      expect(result).toEqual({
        originalUrl: 'https://93.184.216.34/test',
        normalizedUrl: 'https://93.184.216.34/test',
        scheme: 'https',
        hostname: '93.184.216.34',
        port: 443,
        resolvedIps: ['93.184.216.34'],
        isIpLiteral: true,
      });
    });

    it('accepts public IPv6 literal without triggering DNS lookup', async () => {
      const result = await service.validate('https://[2606:2800:220:1:248:1893:25c8:1946]/');

      expect(mockResolver.lookup).not.toHaveBeenCalled();
      expect(result.hostname).toBe('2606:2800:220:1:248:1893:25c8:1946');
      expect(result.resolvedIps).toEqual(['2606:2800:220:1:248:1893:25c8:1946']);
      expect(result.isIpLiteral).toBe(true);
    });

    it.each([
      ['Google DNS (ARIN)', 'https://[2001:4860:4860::8888]/', '2001:4860:4860::8888'],
      ['Google RIPE NCC', 'https://[2a00:1450:4009:822::200e]/', '2a00:1450:4009:822::200e'],
      ['Cloudflare APNIC', 'https://[2400:cb00:2048:1::c629:d7a2]/', '2400:cb00:2048:1::c629:d7a2'],
      ['Google LACNIC', 'https://[2800:3f0:4001:828::200e]/', '2800:3f0:4001:828::200e'],
      ['Google AFRINIC', 'https://[2c0f:fb50:4002:804::200e]/', '2c0f:fb50:4002:804::200e'],
    ])('accepts public IPv6 from global regional registries: %s', async (_, url, expectedIp) => {
      const result = await service.validate(url);
      expect(result.resolvedIps).toEqual([expectedIp]);
      expect(result.isIpLiteral).toBe(true);
    });

    it('accepts IPv4-mapped public IPv4 literal and normalizes it to canonical IPv4', async () => {
      const result = await service.validate('https://[::ffff:93.184.216.34]/');

      expect(mockResolver.lookup).not.toHaveBeenCalled();
      expect(result.resolvedIps).toEqual(['93.184.216.34']);
      expect(result.isIpLiteral).toBe(true);
    });

    it('accepts hostname resolving to IPv4-mapped public IPv4 and normalizes it to canonical IPv4', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: '::ffff:93.184.216.34', family: 6 },
      ]);

      const result = await service.validate('https://mapped-public.example.com');

      expect(result.resolvedIps).toEqual(['93.184.216.34']);
      expect(result.isIpLiteral).toBe(false);
    });

    it('accepts hostname resolving to multiple valid public IPv4 and IPv6 records', async () => {
      const records: DnsLookupRecord[] = [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
        { address: '93.184.216.34', family: 4 }, // duplicate address deduplication
      ];
      mockResolver.lookup.mockResolvedValueOnce(records);

      const result = await service.validate('https://dual-stack.example.com');

      expect(result.resolvedIps).toEqual([
        '93.184.216.34',
        '2606:2800:220:1:248:1893:25c8:1946',
      ]);
      expect(result.isIpLiteral).toBe(false);
    });

    it('normalizes single trailing dot on valid hostname', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
      ]);

      const result = await service.validate('https://example.com./page');

      expect(mockResolver.lookup).toHaveBeenCalledWith('example.com');
      expect(result.hostname).toBe('example.com');
    });

    it('returns validation result safely using check() helper', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
      ]);

      const result = await service.check('https://example.com');

      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.destination.hostname).toBe('example.com');
        expect(result.destination.resolvedIps).toEqual(['93.184.216.34']);
      }
    });
  });

  describe('Syntactic and scheme validation (INVALID_TARGET)', () => {
    it.each([
      ['empty string', ''],
      ['whitespace string', '   '],
      ['non-string type (null)', null as unknown as string],
      ['non-string type (undefined)', undefined as unknown as string],
      ['non-string type (number)', 12345 as unknown as string],
    ])('rejects non-string or empty input: %s', async (_, input) => {
      await expect(service.validate(input)).rejects.toThrow(DestinationGuardError);
      await expect(service.validate(input)).rejects.toMatchObject({
        code: DestinationErrorCode.INVALID_TARGET,
      });
    });

    it('rejects URLs exceeding 2048 characters', async () => {
      const longUrl = `https://example.com/${'a'.repeat(2050)}`;
      await expect(service.validate(longUrl)).rejects.toMatchObject({
        code: DestinationErrorCode.INVALID_TARGET,
      });
    });

    it.each([
      ['space inside URL', 'https://exam ple.com'],
      ['newline inside URL', 'https://example.com\n/path'],
      ['carriage return inside URL', 'https://example.com\r/path'],
      ['tab inside URL', 'https://example.com\t/path'],
      ['null byte inside URL', 'https://example.com\x00/path'],
    ])('rejects whitespace and control characters: %s', async (_, url) => {
      await expect(service.validate(url)).rejects.toMatchObject({
        code: DestinationErrorCode.INVALID_TARGET,
      });
    });

    it.each([
      ['file scheme', 'file:///etc/passwd'],
      ['ftp scheme', 'ftp://ftp.example.com'],
      ['data scheme', 'data:text/html,<html></html>'],
      ['javascript scheme', 'javascript:alert(1)'],
      ['gopher scheme', 'gopher://gopher.example.com'],
      ['ws scheme', 'ws://example.com/socket'],
      ['wss scheme', 'wss://example.com/socket'],
      ['ssh scheme', 'ssh://git@example.com'],
    ])('rejects unsupported scheme: %s', async (_, url) => {
      await expect(service.validate(url)).rejects.toMatchObject({
        code: DestinationErrorCode.INVALID_TARGET,
      });
    });

    it.each([
      ['username and password', 'https://user:pass@example.com'],
      ['username only', 'https://admin@example.com'],
      ['password only', 'https://:secret@example.com'],
    ])('rejects embedded credentials: %s', async (_, url) => {
      await expect(service.validate(url)).rejects.toMatchObject({
        code: DestinationErrorCode.INVALID_TARGET,
      });
    });

    it.each([
      ['port 0', 'https://example.com:0/'],
      ['negative port', 'https://example.com:-80/'],
      ['port out of range', 'https://example.com:65536/'],
    ])('rejects invalid explicit port: %s', async (_, url) => {
      await expect(service.validate(url)).rejects.toMatchObject({
        code: DestinationErrorCode.INVALID_TARGET,
      });
    });

    it.each([
      ['missing scheme and host', 'not-a-valid-url'],
      ['scheme only without host', 'http://'],
      ['scheme with triple slash no host', 'http:///'],
      ['scheme with query only', 'http://?query=1'],
      ['consecutive dots in hostname', 'http://example..com/'],
      ['IPv6 with zone identifier in URL', 'http://[fe80::1%eth0]/'],
      ['IPv6 with percent-encoded zone identifier in URL', 'http://[fe80::1%25eth0]/'],
    ])('rejects malformed or incomplete URL: %s', async (_, url) => {
      await expect(service.validate(url)).rejects.toMatchObject({
        code: DestinationErrorCode.INVALID_TARGET,
      });
    });

    it('returns error result safely via check() without throwing on invalid target', async () => {
      const result = await service.check('file:///etc/passwd');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(DestinationErrorCode.INVALID_TARGET);
      }
    });
  });

  describe('Prohibited IPv4 destinations (BLOCKED_DESTINATION)', () => {
    it.each([
      ['IPv4 loopback (127.0.0.1)', 'http://127.0.0.1'],
      ['IPv4 loopback (127.0.0.2)', 'http://127.0.0.2:8080'],
      ['IPv4 loopback end of range (127.255.255.254)', 'http://127.255.255.254'],
      ['RFC1918 10.0.0.0/8 (10.0.0.1)', 'http://10.0.0.1'],
      ['RFC1918 10.0.0.0/8 (10.255.255.254)', 'http://10.255.255.254'],
      ['RFC1918 172.16.0.0/12 (172.16.0.1)', 'http://172.16.0.1'],
      ['RFC1918 172.16.0.0/12 (172.31.255.254)', 'http://172.31.255.254'],
      ['RFC1918 192.168.0.0/16 (192.168.1.1)', 'http://192.168.1.1'],
      ['Link-local metadata (169.254.169.254)', 'http://169.254.169.254'],
      ['Link-local generic (169.254.1.1)', 'http://169.254.1.1'],
      ['Unspecified (0.0.0.0)', 'http://0.0.0.0'],
      ['Broadcast (255.255.255.255)', 'http://255.255.255.255'],
      ['Multicast (224.0.0.1)', 'http://224.0.0.1'],
      ['Multicast (239.255.255.250)', 'http://239.255.255.250'],
      ['Carrier-grade NAT RFC6598 (100.64.0.1)', 'http://100.64.0.1'],
      ['Alibaba cloud metadata via CG-NAT (100.100.100.200)', 'http://100.100.100.200'],
      ['Reserved documentation RFC5737 (192.0.2.1)', 'http://192.0.2.1'],
      ['Reserved documentation RFC5737 (198.51.100.1)', 'http://198.51.100.1'],
      ['Reserved documentation RFC5737 (203.0.113.1)', 'http://203.0.113.1'],
      ['Reserved Class E (240.0.0.1)', 'http://240.0.0.1'],
      ['Benchmarking RFC 2544 (198.18.0.1)', 'http://198.18.0.1'],
      ['Benchmarking RFC 2544 upper (198.19.255.254)', 'http://198.19.255.254'],
      ['AS112 RFC 7535 (192.175.48.1)', 'http://192.175.48.1'],
      ['AS112-v4 RFC 7535 (192.31.196.1)', 'http://192.31.196.1'],
      ['IETF Protocol Assignments (192.0.0.1)', 'http://192.0.0.1'],
      ['6to4 Relay Anycast (192.88.99.1)', 'http://192.88.99.1'],
      ['AMT RFC 7450 (192.52.193.1)', 'http://192.52.193.1'],
      ['Non-canonical octal loopback (0177.0.0.1)', 'http://0177.0.0.1'],
      ['Non-canonical hex shorthand (0x7f.1)', 'http://0x7f.1'],
      ['Non-canonical hex dword (0x7f000001)', 'http://0x7f000001'],
      ['Non-canonical integer dword loopback (2130706433)', 'http://2130706433'],
      ['Non-canonical integer dword metadata (2852039166)', 'http://2852039166'],
      ['Non-canonical single number zero (0)', 'http://0'],
      ['Non-canonical two-part private (10.1)', 'http://10.1'],
    ])('rejects prohibited IPv4 literal: %s', async (_, url) => {
      await expect(service.validate(url)).rejects.toMatchObject({
        code: DestinationErrorCode.BLOCKED_DESTINATION,
      });
      expect(mockResolver.lookup).not.toHaveBeenCalled();
    });
  });

  describe('Prohibited IPv6 destinations (BLOCKED_DESTINATION)', () => {
    it.each([
      ['IPv6 loopback (::1)', 'http://[::1]'],
      ['IPv6 link-local (fe80::1)', 'http://[fe80::1]'],
      ['IPv6 unique-local fc00 (fc00::1)', 'http://[fc00::1]'],
      ['IPv6 unique-local fd00 (fd00::1)', 'http://[fd00::1]'],
      ['IPv6 unspecified (::)', 'http://[::]'],
      ['IPv6 multicast (ff02::1)', 'http://[ff02::1]'],
      ['IPv6 documentation (2001:db8::1)', 'http://[2001:db8::1]'],
      ['IPv6 transition 6to4 (2002:c000:0201::)', 'http://[2002:c000:0201::]'],
      ['IPv6 transition Teredo (2001:0000:4136:e378:8000:63bf:3fff:fdd2)', 'http://[2001:0000:4136:e378:8000:63bf:3fff:fdd2]'],
      ['IPv6 PCP Anycast RFC 7723 (2001:1::1)', 'http://[2001:1::1]'],
      ['IPv6 TURN Anycast RFC 8155 (2001:1::2)', 'http://[2001:1::2]'],
      ['IPv6 benchmarking RFC 5180 (2001:2::1)', 'http://[2001:2::1]'],
      ['IPv6 AMT RFC 7450 (2001:3::1)', 'http://[2001:3::1]'],
      ['IPv6 AS112-v6 RFC 7535 (2001:4:112::1)', 'http://[2001:4:112::1]'],
      ['IPv6 Direct Delegation AS112 RFC 7534 (2620:4f:8000::1)', 'http://[2620:4f:8000::1]'],
      ['IPv6 ORCHID RFC 4843 (2001:10::1)', 'http://[2001:10::1]'],
      ['IPv6 ORCHIDv2 RFC 7343 (2001:20::1)', 'http://[2001:20::1]'],
      ['IPv6 Drone Remote ID RFC 9153 (2001:30::1)', 'http://[2001:30::1]'],
      ['IPv6 Discard prefix RFC 6666 (100::1)', 'http://[100::1]'],
      ['IPv6 Segment Routing RFC 8669 (5f00::1)', 'http://[5f00::1]'],
      ['IPv6 IPv4-translated RFC 6145 (::ffff:0:0)', 'http://[::ffff:0:0]'],
      ['IPv6 NAT64 prefix RFC 6052 (64:ff9b::1)', 'http://[64:ff9b::1]'],
      ['IPv6 NAT64 local prefix RFC 6052 (64:ff9b:1::1)', 'http://[64:ff9b:1::1]'],
      ['IPv6 unassigned outside 2000::/3 (4000::1)', 'http://[4000::1]'],
      ['IPv6 unassigned outside 2000::/3 (8000::1)', 'http://[8000::1]'],
      ['IPv6 unassigned outside 2000::/3 (a000::1)', 'http://[a000::1]'],
      ['IPv6 unassigned outside 2000::/3 (c000::1)', 'http://[c000::1]'],
      ['IPv6 unassigned outside 2000::/3 (e000::1)', 'http://[e000::1]'],
      ['IPv6 unassigned outside 2000::/3 (f000::1)', 'http://[f000::1]'],
      ['IPv6 unassigned outside 2000::/3 (1000::1)', 'http://[1000::1]'],
      ['IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)', 'http://[::ffff:127.0.0.1]'],
      ['IPv4-mapped IPv6 metadata (::ffff:169.254.169.254)', 'http://[::ffff:169.254.169.254]'],
      ['IPv4-mapped IPv6 private (::ffff:10.0.0.1)', 'http://[::ffff:10.0.0.1]'],
      ['IPv4-mapped IPv6 CG-NAT (::ffff:100.64.0.1)', 'http://[::ffff:100.64.0.1]'],
      ['IPv4-mapped IPv6 benchmarking (::ffff:198.18.0.1)', 'http://[::ffff:198.18.0.1]'],
    ])('rejects prohibited IPv6 literal: %s', async (_, url) => {
      await expect(service.validate(url)).rejects.toMatchObject({
        code: DestinationErrorCode.BLOCKED_DESTINATION,
      });
      expect(mockResolver.lookup).not.toHaveBeenCalled();
    });
  });

  describe('Prohibited metadata and local hostnames (BLOCKED_DESTINATION)', () => {
    it.each([
      ['AWS/OpenStack metadata hostname', 'http://instance-data'],
      ['AWS/OpenStack metadata uppercase', 'http://INSTANCE-DATA'],
      ['AWS internal metadata hostname', 'http://instance-data.ec2.internal'],
      ['GCP metadata hostname', 'http://metadata.google.internal'],
      ['GCP metadata with trailing dot', 'http://metadata.google.internal.'],
      ['GCP metadata mixed case', 'http://Metadata.Google.Internal'],
      ['GCP metadata subdomain', 'http://compute.metadata.google.internal'],
      ['Generic metadata hostname', 'http://metadata'],
      ['Localhost hostname', 'http://localhost'],
      ['Localhost with port', 'http://localhost:3000'],
      ['Subdomain of localhost', 'http://app.localhost'],
      ['Trailing dot localhost', 'http://localhost.'],
      ['mDNS local suffix', 'http://printer.local'],
      ['Internal domain suffix', 'http://database.internal'],
      ['Single label local', 'http://local'],
      ['Single label internal', 'http://internal'],
    ])('rejects prohibited hostname without DNS query: %s', async (_, url) => {
      await expect(service.validate(url)).rejects.toMatchObject({
        code: DestinationErrorCode.BLOCKED_DESTINATION,
      });
      expect(mockResolver.lookup).not.toHaveBeenCalled();
    });
  });

  describe('DNS resolution behavior and IP classification', () => {
    it('rejects public hostname that resolves to loopback IP', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: '127.0.0.1', family: 4 },
      ]);

      await expect(service.validate('https://malicious.example.com')).rejects.toMatchObject({
        code: DestinationErrorCode.BLOCKED_DESTINATION,
      });
    });

    it('rejects public hostname that resolves to cloud metadata IP', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: '169.254.169.254', family: 4 },
      ]);

      await expect(service.validate('https://metadata-spoof.example.com')).rejects.toMatchObject({
        code: DestinationErrorCode.BLOCKED_DESTINATION,
      });
    });

    it('rejects hostname when DNS returns mixed public and private addresses', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.1', family: 4 }, // private IP in answers
      ]);

      await expect(service.validate('https://mixed-pool.example.com')).rejects.toMatchObject({
        code: DestinationErrorCode.BLOCKED_DESTINATION,
      });
    });

    it('rejects hostname when DNS returns mixed public IPv4 and prohibited IPv6 address', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
        { address: '::1', family: 6 }, // IPv6 loopback in answers
      ]);

      await expect(service.validate('https://mixed-v6.example.com')).rejects.toMatchObject({
        code: DestinationErrorCode.BLOCKED_DESTINATION,
      });
    });

    it('rejects hostname when DNS returns IPv4-mapped IPv6 private address', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: '::ffff:192.168.1.1', family: 6 },
      ]);

      await expect(service.validate('https://v6-mapped-private.example.com')).rejects.toMatchObject({
        code: DestinationErrorCode.BLOCKED_DESTINATION,
      });
    });

    it('rejects hostname when DNS returns IPv6 outside IANA 2000::/3 global unicast allocation', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: '4000::1', family: 6 },
      ]);

      await expect(service.validate('https://unassigned-v6.example.com')).rejects.toMatchObject({
        code: DestinationErrorCode.BLOCKED_DESTINATION,
      });
    });

    it('rejects hostname when DNS returns IP address with zone identifier', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: 'fe80::1%eth0', family: 6 },
      ]);

      await expect(service.validate('https://zoned.example.com')).rejects.toMatchObject({
        code: DestinationErrorCode.BLOCKED_DESTINATION,
      });
    });

    it('rejects when DNS lookup throws an exception (e.g. ENOTFOUND)', async () => {
      mockResolver.lookup.mockRejectedValueOnce(
        new Error('getaddrinfo ENOTFOUND non-existent.example.com'),
      );

      await expect(service.validate('https://non-existent.example.com')).rejects.toMatchObject({
        code: DestinationErrorCode.DNS_RESOLUTION_FAILED,
      });
    });

    it('rejects when DNS lookup returns an empty address array', async () => {
      mockResolver.lookup.mockResolvedValueOnce([]);

      await expect(service.validate('https://empty-dns.example.com')).rejects.toMatchObject({
        code: DestinationErrorCode.DNS_RESOLUTION_FAILED,
      });
    });

    it('rejects when DNS lookup returns a malformed IP address string', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: 'not-an-ip-address', family: 4 },
      ]);

      await expect(service.validate('https://malformed-record.example.com')).rejects.toMatchObject({
        code: DestinationErrorCode.DNS_RESOLUTION_FAILED,
      });
    });
  });

  describe('Error taxonomy and safe error sanitization', () => {
    it('does not expose internal IPs, raw credentials, or sensitive hostnames in error message', async () => {
      mockResolver.lookup.mockResolvedValueOnce([
        { address: '10.250.1.99', family: 4 },
      ]);

      try {
        await service.validate('https://internal-db.example.com');
        fail('Expected validate to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(DestinationGuardError);
        const guardErr = err as DestinationGuardError;
        expect(guardErr.code).toBe(DestinationErrorCode.BLOCKED_DESTINATION);
        // Error message must not contain the sensitive IP or hostname
        expect(guardErr.message).not.toContain('10.250.1.99');
        expect(guardErr.message).not.toContain('internal-db');
        expect(guardErr.safeReason).toBe(
          'Destination IP address is non-globally routable or reserved',
        );
      }
    });

    it('does not leak submitted credentials in INVALID_TARGET error', async () => {
      try {
        await service.validate('https://super_secret_user:super_secret_password@example.com');
        fail('Expected validate to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(DestinationGuardError);
        const guardErr = err as DestinationGuardError;
        expect(guardErr.code).toBe(DestinationErrorCode.INVALID_TARGET);
        expect(guardErr.message).not.toContain('super_secret_user');
        expect(guardErr.message).not.toContain('super_secret_password');
      }
    });
  });
});
