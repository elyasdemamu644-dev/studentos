// ──────────────────────────────────────────────────────────────────────────────
// SSRF guard — outbound endpoint validation for user-configurable URLs
// ──────────────────────────────────────────────────────────────────────────────
//
// AI provider connections let an authenticated user name an arbitrary base URL
// (`endpoint`) that the server then calls. Without validation that is a
// server-side request forgery primitive: the API could be pointed at the cloud
// metadata service, an internal admin panel, or a loopback-only port, and any
// response text is echoed back to the caller through provider errors.
//
// This module provides the single, reusable check used by schema validation
// (structural, synchronous) and by the outbound request path (structural plus
// DNS resolution against the private/reserved address policy).
//
// Threat model and limits:
//  * Scheme, embedded credentials, and host syntax are rejected structurally.
//  * The WHATWG `URL` parser is used first because it normalises alternate IPv4
//    spellings (`2130706433`, `0x7f000001`, `0177.0.0.1`) to dotted-quad form,
//    so obfuscated loopback hosts don't slip past the literal-IP check.
//  * Hostnames are resolved and *every* returned address must be public. A host
//    that resolves to a mix of public and private answers is rejected.
//  * Operators can explicitly opt in to private destinations with
//    `AI_ALLOW_PRIVATE_ENDPOINTS=true` (self-hosted Ollama, LAN gateways, …);
//    ordinary users can never opt in through the API.
//  * Public (non-operator) endpoints must use HTTPS. Plain HTTP is only allowed
//    when the operator opts into private destinations.
//  * DNS rebinding: {@link resolveSafeOutboundUrl} returns the exact addresses it
//    validated, and the transport (`utils/safe-fetch.ts`) pins the connection's
//    `lookup` to those addresses. The socket therefore connects to the address
//    that was checked — there is no second, independent resolution that a
//    rebinding resolver could swap underneath us. Automatic redirects are
//    rejected at the request boundary, removing the other common bypass.
//  * Residual risk: a *pooled/reused* connection is safe (it already points at a
//    validated address), and network-level egress policy is the operator's
//    responsibility; application checks alone are not a substitute.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Thrown when an outbound endpoint fails the SSRF policy. Message is safe to
 * surface to clients and never contains the resolved address. */
export class SsrfBlockedError extends Error {
  readonly code = "SSRF_BLOCKED";
  constructor(message = "The configured endpoint is not allowed") {
    super(message);
    this.name = "SsrfBlockedError";
    Object.setPrototypeOf(this, SsrfBlockedError.prototype);
  }
}

/** Resolves a hostname to the addresses the request could connect to. Injectable
 * so tests never touch a live resolver. */
export type AddressResolver = (hostname: string) => Promise<string[]>;

export interface SsrfPolicy {
  /** Permit loopback/private/link-local destinations. Operators only. */
  allowPrivate?: boolean;
  /** Exact operator-approved DNS names. Tenant-supplied endpoints cannot add to this list. */
  allowedHosts?: readonly string[];
  /** Override DNS resolution (tests). */
  resolver?: AddressResolver;
}

const defaultResolver: AddressResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

// ── Parsing helpers ─────────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inIpv4Range(value: number, base: string, bits: number): boolean {
  const baseValue = ipv4ToInt(base);
  if (baseValue === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function isDisallowedIpv4(value: number): boolean {
  return (
    inIpv4Range(value, "0.0.0.0", 8) || // "this network" / unspecified
    inIpv4Range(value, "10.0.0.0", 8) || // RFC 1918 private
    inIpv4Range(value, "100.64.0.0", 10) || // CGNAT / shared address space
    inIpv4Range(value, "127.0.0.0", 8) || // loopback
    inIpv4Range(value, "169.254.0.0", 16) || // link-local (incl. 169.254.169.254 metadata)
    inIpv4Range(value, "172.16.0.0", 12) || // RFC 1918 private
    inIpv4Range(value, "192.0.0.0", 24) || // IETF protocol assignments
    inIpv4Range(value, "192.0.2.0", 24) || // TEST-NET-1
    inIpv4Range(value, "192.88.99.0", 24) || // 6to4 relay anycast
    inIpv4Range(value, "192.168.0.0", 16) || // RFC 1918 private
    inIpv4Range(value, "198.18.0.0", 15) || // benchmarking
    inIpv4Range(value, "198.51.100.0", 24) || // TEST-NET-2
    inIpv4Range(value, "203.0.113.0", 24) || // TEST-NET-3
    inIpv4Range(value, "224.0.0.0", 4) || // multicast
    inIpv4Range(value, "240.0.0.0", 4) // reserved (incl. 255.255.255.255)
  );
}

/** Expand an IPv6 address (possibly with `::` and/or a trailing dotted-quad)
 * into eight 16-bit groups. Returns null when the input is not parseable. */
function expandIpv6(ip: string): number[] | null {
  let text = ip;
  if (text.includes("%")) text = text.slice(0, text.indexOf("%")); // zone id
  if (text.includes(".")) {
    const lastColon = text.lastIndexOf(":");
    const v4 = ipv4ToInt(text.slice(lastColon + 1));
    if (v4 === null) return null;
    const high = (v4 >>> 16).toString(16);
    const low = (v4 & 0xffff).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const doubleColon = text.indexOf("::");
  let head: string[];
  let tail: string[];
  if (doubleColon === -1) {
    head = text.split(":");
    tail = [];
  } else {
    head = text.slice(0, doubleColon).split(":").filter(Boolean);
    tail = text.slice(doubleColon + 2).split(":").filter(Boolean);
  }
  if (doubleColon === -1 && head.length !== 8) return null;
  if (doubleColon !== -1 && head.length + tail.length > 7) return null;

  const groups = doubleColon === -1
    ? head
    : [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  if (groups.length !== 8) return null;

  const parsed: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    parsed.push(parseInt(group, 16));
  }
  return parsed;
}

function ipv4FromGroups(groups: number[], hi: number, lo: number): number {
  return ((groups[hi] << 16) | groups[lo]) >>> 0;
}

function isDisallowedIpv6(ip: string): boolean {
  const groups = expandIpv6(ip);
  if (!groups) return true;
  const [g0, g1] = groups;

  const allZero = groups.every((g) => g === 0);
  if (allZero) return true; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1

  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation

  // IPv4-mapped ::ffff:a.b.c.d
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return isDisallowedIpv4(ipv4FromGroups(groups, 6, 7));
  }
  // IPv4-compatible ::a.b.c.d (excluding :: and ::1 already handled)
  if (groups.slice(0, 6).every((g) => g === 0)) {
    return isDisallowedIpv4(ipv4FromGroups(groups, 6, 7));
  }
  // 6to4 2002:AABB:CCDD::/48 embeds the IPv4 address in groups 1 and 2.
  if (g0 === 0x2002) return isDisallowedIpv4(ipv4FromGroups(groups, 1, 2));
  // NAT64 64:ff9b::/96 embeds the IPv4 address in groups 6 and 7.
  if (g0 === 0x0064 && g1 === 0xff9b) return isDisallowedIpv4(ipv4FromGroups(groups, 6, 7));

  return false;
}

/** True when an IP literal points at loopback, a private/link-local range, a
 * reserved block, or is otherwise not a normal public destination. Unknown or
 * unparseable input is treated as disallowed. */
export function isDisallowedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4ToInt(address);
    return value === null ? true : isDisallowedIpv4(value);
  }
  if (family === 6) return isDisallowedIpv6(address);
  return true;
}

// ── Endpoint validation ─────────────────────────────────────────────────────

/** Structural validation shared by the Zod schemas and the request path.
 * Synchronous and DNS-free, so it is cheap enough for every parse. */
export function parseHttpEndpoint(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError("Endpoint must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError("Endpoint must use the http or https scheme");
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError("Endpoint must not contain embedded credentials");
  }
  if (!url.hostname) {
    throw new SsrfBlockedError("Endpoint must include a host");
  }
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new SsrfBlockedError("Endpoint port is not allowed");
    }
  }
  return url;
}

/** Boolean form of {@link parseHttpEndpoint} for schema `.refine` callbacks. */
export function isStructurallyValidEndpoint(raw: string): boolean {
  try {
    parseHttpEndpoint(raw);
    return true;
  } catch {
    return false;
  }
}

/** Return the host with IPv6 brackets and any trailing dot removed, lowercased. */
function normalizeHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

/** The outcome of an SSRF validation: the parsed URL plus the exact addresses
 * the outbound transport must connect to. `addresses` is empty only when the
 * operator has opted into private destinations and no resolver was supplied, in
 * which case the OS resolver is trusted and no pinning is performed. */
export interface ResolvedOutboundEndpoint {
  url: URL;
  addresses: string[];
}

/**
 * Validate an outbound endpoint against the SSRF policy and return the concrete
 * addresses to pin the connection to.
 *
 * With `allowPrivate` unset/false:
 *  * plain HTTP is rejected (public endpoints must use TLS),
 *  * a literal IP is checked directly,
 *  * a hostname is resolved and *every* answer must be a public address.
 *
 * With `allowPrivate` true the address classification is skipped (operators
 * opting in to self-hosted/private providers). Resolution still happens — so the
 * returned address can be pinned — only when an explicit `resolver` is supplied.
 */
export async function resolveSafeOutboundUrl(
  raw: string,
  policy: SsrfPolicy = {}
): Promise<ResolvedOutboundEndpoint> {
  const url = parseHttpEndpoint(raw);
  if (!policy.allowPrivate && url.protocol === "http:") {
    throw new SsrfBlockedError("Endpoint must use https");
  }

  const host = normalizeHost(url);
  if (policy.allowedHosts) {
    const approved = new Set(policy.allowedHosts.map((entry) => entry.toLowerCase().replace(/\.$/, "")));
    if (!approved.has(host)) {
      throw new SsrfBlockedError("Endpoint host is not approved by the operator");
    }
  }
  if (policy.allowPrivate && !policy.resolver) {
    // Operator-trusted destination: let the OS resolver run at connect time.
    return { url, addresses: [] };
  }

  if (isIP(host)) {
    if (!policy.allowPrivate && isDisallowedAddress(host)) {
      throw new SsrfBlockedError("Endpoint host is not a public address");
    }
    return { url, addresses: [host] };
  }

  const resolver = policy.resolver ?? defaultResolver;
  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    throw new SsrfBlockedError("Endpoint host could not be resolved");
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError("Endpoint host could not be resolved");
  }
  if (!policy.allowPrivate) {
    for (const address of addresses) {
      if (isDisallowedAddress(address)) {
        throw new SsrfBlockedError("Endpoint host is not a public address");
      }
    }
  }
  return { url, addresses };
}

/**
 * Validate an outbound endpoint against the SSRF policy.
 *
 * Thin wrapper over {@link resolveSafeOutboundUrl} for callers that only need
 * the parsed URL (schema-level and fail-fast checks).
 */
export async function assertSafeOutboundUrl(
  raw: string,
  policy: SsrfPolicy = {}
): Promise<URL> {
  return (await resolveSafeOutboundUrl(raw, policy)).url;
}

/** Redact an endpoint for logs/errors: keeps scheme+host, drops path/query so
 * provider URLs (which can carry tokens) never leak. */
export function redactEndpoint(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "[invalid endpoint]";
  }
}
