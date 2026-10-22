import { Injectable } from '@nestjs/common';
import * as dns from 'node:dns/promises';

export interface DnsLookupRecord {
  address: string;
  family: 4 | 6;
}

export interface DnsResolver {
  /**
   * Resolves all A and AAAA records for a given hostname.
   */
  lookup(hostname: string): Promise<DnsLookupRecord[]>;
}

export const DNS_RESOLVER_TOKEN = Symbol('DNS_RESOLVER_TOKEN');

@Injectable()
export class SystemDnsResolver implements DnsResolver {
  async lookup(hostname: string): Promise<DnsLookupRecord[]> {
    const results = await dns.lookup(hostname, { all: true, verbatim: true });
    return results.map((r) => ({
      address: r.address,
      family: r.family as 4 | 6,
    }));
  }
}
