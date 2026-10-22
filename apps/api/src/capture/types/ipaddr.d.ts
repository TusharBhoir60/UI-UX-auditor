declare module 'ipaddr.js' {
  export interface IPv4 {
    kind(): 'ipv4';
    range(): string;
    toString(): string;
    toByteArray(): number[];
    match(cidr: [IPAddress, number] | IPAddress, prefix?: number): boolean;
  }

  export interface IPv6 {
    kind(): 'ipv6';
    range(): string;
    toString(): string;
    toByteArray(): number[];
    isIPv4MappedAddress(): boolean;
    toIPv4Address(): IPv4;
    match(cidr: [IPAddress, number] | IPAddress, prefix?: number): boolean;
  }

  export type IPAddress = IPv4 | IPv6;

  export function isValid(string: string): boolean;
  export function parse(string: string): IPAddress;
  export function process(string: string): IPAddress;
  export function parseCIDR(string: string): [IPAddress, number];
}
