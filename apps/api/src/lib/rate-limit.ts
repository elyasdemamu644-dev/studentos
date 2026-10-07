import type { Request, RequestHandler, Response, NextFunction } from "express";

import { config } from "@/config";
import { rateLimitError } from "@/config/errors";

// ─────────────────────────────────────────────
// Fixed-window per-IP rate limiter
// ─────────────────────────────────────────────
//
// Dependency-free: `express-rate-limit` is not installed, and a handful of
// lines is easier to audit than pulling in a transitive tree for one counter.
//
// Semantics:
//   - one fixed window of `rateLimitWindowSeconds` per client IP
//   - `rateLimitMaxRequests` requests may be served per window
//   - the response always carries X-RateLimit-* headers; rejections carry
//     Retry-After and are surfaced through the standard error envelope
//     (429 / RATE_LIMITED)
//
// Safety:
//   - the bucket map is bounded; when it is exceeded the whole map is reset
//     rather than growing without limit
//   - expired buckets are swept on an interval
//   - disabled entirely when config.isTest, so test suites never trip it
//
// Scope: `ip` by default. A caller can pass a `keyOf` function to bucket on
// something else (e.g. authenticated user id) once a route is behind auth.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Hard ceiling on tracked clients — beyond this the map is dropped. */
const MAX_BUCKETS = 10_000;

/** Eviction interval; one window is enough to let every bucket expire. */
const SWEEP_INTERVAL_MS = 60_000;

let sweepTimer: NodeJS.Timeout | null = null;

function ensureSweeping(windowMs: number): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    if (buckets.size === 0) {
      clearInterval(sweepTimer!);
      sweepTimer = null;
    }
  }, Math.max(SWEEP_INTERVAL_MS, windowMs));
  sweepTimer.unref?.();
}

/** Test seam: drop all counters and stop the sweeper. */
export function resetRateLimiter(): void {
  buckets.clear();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

function clientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export interface RateLimiterOptions {
  /** Window length in seconds. Defaults to config.rateLimitWindowSeconds. */
  windowSeconds?: number;
  /** Requests allowed per window per key. Defaults to config.rateLimitMaxRequests. */
  max?: number;
  /** Bucket key extractor. Defaults to the client IP. */
  keyOf?: (req: Request) => string;
  /**
   * Master switch. Defaults to `!config.isTest` — tests must never be
   * throttled, so pass `enabled: true` explicitly to exercise the limiter.
   */
  enabled?: boolean;
}

/**
 * Express middleware limiting requests per client.
 *
 * Mount it on the API router only — `/health` must stay reachable so
 * orchestrators can probe a throttled service.
 */
export function rateLimiter(options: RateLimiterOptions = {}): RequestHandler {
  const windowSeconds = options.windowSeconds ?? config.rateLimitWindowSeconds;
  const max = options.max ?? config.rateLimitMaxRequests;
  const keyOf = options.keyOf ?? clientKey;
  const enabled = options.enabled ?? !config.isTest;
  const windowMs = windowSeconds * 1000;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Test mode: never throttle — test files issue far more than the default
    // 100 requests per minute against a single IP.
    if (!enabled) {
      next();
      return;
    }

    ensureSweeping(windowMs);

    const key = keyOf(req);
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
      if (buckets.size > MAX_BUCKETS) {
        // Pathological key space (spoofed/unbounded IPs): drop everything
        // rather than let memory grow. The next request starts a fresh bucket.
        buckets.clear();
        buckets.set(key, bucket);
      }
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(retryAfter));
      // A throttled client is an operational signal worth seeing.
      console.warn(`[rate-limit] 429 ${req.method} ${req.originalUrl} ip=${key} retry-after=${retryAfter}s`);
      next(
        rateLimitError(
          `Too many requests. Please try again in ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`,
        ),
      );
      return;
    }

    next();
  };
}

/** The limiter mounted in front of `/api/v1`. */
export const apiRateLimiter = rateLimiter();
