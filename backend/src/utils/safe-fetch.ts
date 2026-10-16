// ──────────────────────────────────────────────────────────────────────────────
// Safe outbound fetch — connection-level (pinned) SSRF enforcement
// ──────────────────────────────────────────────────────────────────────────────
//
// `utils/ssrf-guard.ts` resolves and classifies an outbound host, but Node's
// global `fetch` performs its *own*, independent DNS lookup when it connects.
// A resolver that answers "public" to the guard and "private" to the connection
// (classic DNS rebinding) therefore slips through. To close that window this
// module issues the request directly on Node's `http`/`https` stack with a
// custom `lookup` that returns *only* the addresses the guard already validated.
// The socket is pinned to a checked address — there is no second resolution.
//
// Design notes:
//  * TLS keeps the hostname for SNI and certificate verification (`servername`
//    is the hostname, never the pinned IP); only the dialed address is pinned.
//  * Requests are never redirected: a 3xx is rejected with `SsrfBlockedError`.
//  * The response body is streamed into memory with a hard byte ceiling, so a
//    hostile endpoint cannot exhaust memory even without a truthful
//    `Content-Length`.
//  * `agent: false` guarantees a fresh connection (and therefore a fresh,
//    validated lookup) per request rather than reusing a stale socket.
//  * `outboundFetch` is the injectable seam: production uses `safeFetch`; tests
//    may install a fetch-backed transport so adapter tests can stub `fetch`.

import http from "node:http";
import https from "node:https";
import type { LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";

import { config } from "@/config";
import { proxyFetch } from "@/utils/outbound-client";
import {
  resolveSafeOutboundUrl,
  SsrfBlockedError,
  type SsrfPolicy,
} from "./ssrf-guard";

/** Default response ceiling, mirroring `config.aiMaxResponseBytes`. */
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** Thrown when a provider response exceeds the byte ceiling while streaming. */
export class OutboundResponseTooLargeError extends Error {
  readonly code = "RESPONSE_TOO_LARGE";
  constructor(message = "The AI provider response was too large to process") {
    super(message);
    this.name = "OutboundResponseTooLargeError";
    Object.setPrototypeOf(this, OutboundResponseTooLargeError.prototype);
  }
}

/** Thrown for connect/read failures so callers can distinguish a transient
 * network error (retryable) from a policy block or an oversized body. */
export class OutboundNetworkError extends Error {
  readonly code = "NETWORK_ERROR";
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "OutboundNetworkError";
    Object.setPrototypeOf(this, OutboundNetworkError.prototype);
  }
}

export interface OutboundFetchOptions {
  /** Resolved SSRF policy. Defaults to strict (no private destinations). */
  policy?: SsrfPolicy;
  /** Hard ceiling on the response body size. */
  maxBytes?: number;
  /**
   * Idle-socket timeout in milliseconds for standalone callers. The AI provider
   * drives its own absolute deadline through `init.signal`, so it does not pass
   * this.
   */
  timeoutMs?: number;
}

export type OutboundTransport = (
  url: string,
  init: RequestInit,
  options?: OutboundFetchOptions,
) => Promise<Response>;

// The override lives on a well-known global symbol rather than a module-local
// binding: tests that call `vi.resetModules()` (to re-read env-derived config)
// import a *fresh* copy of this module, and a module-local override would be
// lost — silently letting the real network transport run in a unit test.
const TRANSPORT_OVERRIDE_KEY = Symbol.for("studentos.outboundTransportOverride");

type GlobalWithTransport = typeof globalThis & {
  [TRANSPORT_OVERRIDE_KEY]?: OutboundTransport;
};

/** Test seam: install a transport (e.g. one backed by a stubbed `fetch`). */
export function setOutboundTransportForTests(transport: OutboundTransport | undefined): void {
  (globalThis as GlobalWithTransport)[TRANSPORT_OVERRIDE_KEY] = transport;
}

/** Enforce the operator's exact destination policy when no gateway is present. */
export function assertDirectEgressDestination(
  target: URL,
  approvedDestinations: readonly string[],
): void {
  if (target.protocol !== "https:") {
    throw new SsrfBlockedError("Production outbound requests require HTTPS");
  }
  const hostname = target.hostname.toLowerCase().replace(/\.$/, "");
  const port = Number(target.port || 443);
  if (!approvedDestinations.includes(`${hostname}:${port}`)) {
    throw new SsrfBlockedError("The outbound destination is not approved");
  }
}

/** Perform an outbound request through the active transport. Production uses the
 * pinned {@link safeFetch}; tests may override it. */
export function outboundFetch(
  url: string,
  init: RequestInit,
  options?: OutboundFetchOptions,
): Promise<Response> {
  const override = (globalThis as GlobalWithTransport)[TRANSPORT_OVERRIDE_KEY];
  return (override ?? safeFetch)(url, init, options);
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function toNodeHeaders(headers?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value;
  } else {
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) out[key] = String(value);
    }
  }
  return out;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function toBuffer(body: RequestInit["body"]): Buffer | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  // The AI adapters only ever send strings; anything else (streams, forms) is
  // unsupported on this path.
  return undefined;
}

function makeAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Build a `net`-style lookup that returns *only* the pre-validated addresses.
 * Supporting `options.all` (Happy Eyeballs / `autoSelectFamily`) matters: when
 * Node asks for every address it must receive the pinned set, not a fresh DNS
 * answer.
 */
function pinnedLookup(addresses: readonly string[]): LookupFunction {
  const entries: LookupAddress[] = addresses.map((address) => ({
    address,
    family: isIP(address),
  }));

  const lookup = (
    _hostname: string,
    options: { all?: boolean; family?: number },
    callback: (
      error: NodeJS.ErrnoException | null,
      address?: string | LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    const wanted = options?.family
      ? entries.filter((entry) => entry.family === options.family)
      : entries;
    if (wanted.length === 0) {
      const error = new Error("No pinned address available") as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error);
      return;
    }
    if (options?.all) {
      callback(null, wanted);
      return;
    }
    callback(null, wanted[0].address, wanted[0].family);
  };

  return lookup as unknown as LookupFunction;
}

/**
 * Perform an outbound HTTP(S) request with connection-level SSRF enforcement.
 *
 * The host is resolved and validated once; the connection is then pinned to
 * those exact addresses. Redirects are rejected, the body is capped, and the
 * caller's abort signal is honored.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: OutboundFetchOptions = {},
): Promise<Response> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const { url: target, addresses } = await resolveSafeOutboundUrl(
    rawUrl,
    options.policy ?? {},
  );

  // Proxy mode sends traffic only through the gateway. Render's direct mode
  // still applies the exact host/port policy and pinned DNS before connecting.
  if (config.isProduction) {
    if (config.egressMode === "proxy") {
      return fetchThroughMandatoryProxy(target, init, maxBytes);
    }
    assertDirectEgressDestination(target, config.egressAllowedDestinations);
  }

  const isHttps = target.protocol === "https:";
  const requestFn = (isHttps ? https.request : http.request) as typeof https.request;
  const hostname = stripBrackets(target.hostname);
  const port = target.port ? Number(target.port) : isHttps ? 443 : 80;

  const headers = toNodeHeaders(init.headers);
  if (!hasHeader(headers, "host")) headers.Host = target.host;
  const body = toBuffer(init.body);
  if (body && !hasHeader(headers, "content-length")) {
    headers["Content-Length"] = String(body.length);
  }

  const requestOptions: https.RequestOptions = {
    protocol: target.protocol,
    hostname,
    port,
    path: `${target.pathname}${target.search}`,
    method: (init.method ?? "GET").toUpperCase(),
    headers,
    // A fresh socket per request guarantees the pinned lookup is applied each
    // time rather than a pooled socket being reused.
    agent: false,
  };
  if (addresses.length > 0) requestOptions.lookup = pinnedLookup(addresses);
  if (isHttps) {
    // Bind SNI and certificate verification to the hostname, never the IP we
    // actually dial.
    requestOptions.servername = hostname;
  }

  return await performRequest(requestFn, requestOptions, body, init, maxBytes, options.timeoutMs);
}

async function fetchThroughMandatoryProxy(
  target: URL,
  init: RequestInit,
  maxBytes: number,
): Promise<Response> {
  if (!config.egressProxyUrl) {
    throw new OutboundNetworkError("The required outbound proxy is unavailable");
  }
  if (target.protocol !== "https:") {
    throw new SsrfBlockedError("Production outbound requests require HTTPS");
  }

  let response: Response;
  try {
    response = await proxyFetch(target, { ...init, redirect: "manual" });
  } catch (error) {
    // Do not include the URL, request headers, or underlying proxy message:
    // provider endpoints may contain credentials and proxy errors can echo it.
    throw new OutboundNetworkError("The approved outbound proxy request failed", error);
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new SsrfBlockedError("The outbound proxy response redirected the request");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new OutboundResponseTooLargeError();
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new OutboundResponseTooLargeError();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const body = received === 0 ? null : Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function performRequest(
  requestFn: typeof https.request,
  requestOptions: https.RequestOptions,
  body: Buffer | undefined,
  init: RequestInit,
  maxBytes: number,
  timeoutMs: number | undefined,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const externalSignal = init.signal ?? undefined;
    let abortListener: (() => void) | undefined;

    const cleanup = (): void => {
      if (abortListener && externalSignal) {
        externalSignal.removeEventListener("abort", abortListener);
      }
      abortListener = undefined;
    };
    const succeed = (response: Response): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const req = requestFn(requestOptions, (res) => {
      const status = res.statusCode ?? 0;

      const declaredHeader = res.headers["content-length"];
      const declared = Number(Array.isArray(declaredHeader) ? declaredHeader[0] : declaredHeader ?? "");
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy();
        req.destroy();
        fail(new OutboundResponseTooLargeError());
        return;
      }

      const chunks: Buffer[] = [];
      let received = 0;
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > maxBytes) {
          res.destroy();
          req.destroy();
          fail(new OutboundResponseTooLargeError());
          return;
        }
        chunks.push(chunk);
      });
      res.on("error", (error: Error) => {
        fail(new OutboundNetworkError("The AI provider connection failed", error));
      });
      res.on("end", () => {
        if (settled) return;
        if (status >= 300 && status < 400) {
          fail(
            new SsrfBlockedError(
              "The AI provider endpoint returned a redirect, which is not allowed",
            ),
          );
          return;
        }
        try {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const item of value) headers.append(key, item);
            } else {
              headers.append(key, value);
            }
          }
          const buffer = Buffer.concat(chunks);
          const bodyless = status === 204 || status === 205 || status === 304;
          const response = new Response(bodyless || buffer.length === 0 ? null : buffer, {
            status: status >= 200 && status <= 599 ? status : 502,
            statusText: res.statusMessage ?? "",
            headers,
          });
          succeed(response);
        } catch (error) {
          fail(new OutboundNetworkError("The AI provider returned an unreadable response", error));
        }
      });
    });

    req.on("error", (error: Error) => {
      fail(new OutboundNetworkError("The AI provider connection failed", error));
    });

    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        fail(new OutboundNetworkError("The AI provider request timed out"));
      });
    }

    if (externalSignal) {
      abortListener = (): void => {
        req.destroy();
        fail(makeAbortError());
      };
      if (externalSignal.aborted) {
        abortListener();
        return;
      }
      externalSignal.addEventListener("abort", abortListener, { once: true });
    }

    if (body) req.write(body);
    req.end();
  });
}
