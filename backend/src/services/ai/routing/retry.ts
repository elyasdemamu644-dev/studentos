import {
  AiProviderCancelledError,
  AiProviderError,
  AiProviderTimeoutError,
  type AiProvider,
} from "@/services/ai/provider";
import type { RoutingDecision } from "./engine";

// ─────────────────────────────────────────────────────────────────────────────
// Bounded retry + fallback with side-effect safety
// ─────────────────────────────────────────────────────────────────────────────
//
// Retrying an AI call is only safe when the failed attempt left nothing behind.
// A pure model completion is side-effect-free and may be retried; a turn that
// already executed a write tool (created a task, saved a memory) must NOT be
// retried from scratch, or the write would happen twice.
//
// So the caller declares, up front, whether the operation has side effects
// (`hasSideEffects`). When it does, this helper performs a single attempt: it
// will still *report* a failure honestly rather than risk a duplicate write.
// Retries and cross-provider fallback are bounded and only ever swap to a
// candidate the routing engine already authorised — never to an unauthorised
// paid model.

export const DEFAULT_MAX_ATTEMPTS = 2;

/** Errors that indicate a transient fault worth one more try. */
function isRetryable(error: unknown): boolean {
  // A student cancelling must never trigger a retry.
  if (error instanceof AiProviderCancelledError) return false;
  if (error instanceof AiProviderTimeoutError) return true;
  if (error instanceof AiProviderError) {
    // 5xx / 429 are transient; 4xx schema/validation faults are not.
    return error.statusCode >= 500 || error.statusCode === 429;
  }
  return false;
}

export interface RetryOptions {
  /**
   * When true, the operation may have written data — retries are disabled so a
   * duplicate side effect can never occur. Callers set this once they know the
   * turn mutates state (e.g. autonomous tools are in play).
   */
  hasSideEffects: boolean;
  maxAttempts?: number;
  /** Called before each retry with the 1-based attempt number and the error. */
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Run `operation` with bounded retries. The operation must be idempotent (a pure
 * provider call) when `hasSideEffects` is false; when it is true only one
 * attempt runs.
 */
export async function withBoundedRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxAttempts = options.hasSideEffects ? 1 : Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryable(error)) throw error;
      options.onRetry?.(attempt, error);
    }
  }
  // Unreachable: the loop either returns or throws.
  throw lastError;
}

// ── Fallback across authorised candidates ───────────────────────────────────

export interface FallbackAttempt<T> {
  /** The authorised candidate to try. */
  provider: AiProvider;
  /** A short label for telemetry and the UI (e.g. "gpt-4o"). */
  label: string;
  run: (provider: AiProvider) => Promise<T>;
}

export interface FallbackResult<T> {
  value: T;
  /** How many candidates were tried before one succeeded. */
  attempts: number;
  /** The label of the candidate that succeeded. */
  usedLabel: string;
  /** The candidate that succeeded — the one usage and health belong to. */
  usedProvider: AiProvider;
  /** The candidates that failed, in order, with their (sanitized) reasons. */
  failures: Array<{ label: string; message: string }>;
}

/**
 * Try each authorised candidate in order until one succeeds.
 *
 * Hard rule: when `hasSideEffects` is true a candidate is only attempted once
 * and, crucially, fallback stops after the *first* candidate that could have
 * written anything — because a later candidate re-running the same request
 * would duplicate the side effect. In that case this behaves like a single
 * attempt and rethrows.
 *
 * `candidates` must already be filtered by the routing engine: this never
 * invents a provider, so privacy, spend and allow/deny rules cannot be escaped
 * by falling back.
 */
export async function withAuthorizedFallback<T>(
  candidates: FallbackAttempt<T>[],
  options: {
    hasSideEffects: boolean;
    onFallback?: (from: string, to: string, error: unknown) => void;
    /** Called before a same-model retry, with the 1-based attempt number. */
    onRetry?: (attempt: number, error: unknown) => void;
  },
): Promise<FallbackResult<T>> {
  const failures: Array<{ label: string; message: string }> = [];
  const usable = options.hasSideEffects ? candidates.slice(0, 1) : candidates;
  if (usable.length === 0) {
    throw new AiProviderError("No authorised AI model is available for this request.");
  }

  for (let index = 0; index < usable.length; index += 1) {
    const candidate = usable[index];
    try {
      // A transient fault (timeout, 429, 5xx) is worth one more try on the same
      // model before another model is tried at all. `withBoundedRetry` runs a
      // single attempt when the operation has side effects, so a turn that may
      // have written something is never replayed.
      const value = await withBoundedRetry(() => candidate.run(candidate.provider), {
        hasSideEffects: options.hasSideEffects,
        onRetry: (attempt, error) => options.onRetry?.(attempt, error),
      });
      return { value, attempts: index + 1, usedLabel: candidate.label, usedProvider: candidate.provider, failures };
    } catch (error) {
      // A cancellation is the student's decision, not a fault to route around.
      if (error instanceof AiProviderCancelledError) throw error;
      const message =
        error instanceof Error && error.message
          ? error.message
          : "The provider request failed.";
      failures.push({ label: candidate.label, message });
      if (index === usable.length - 1) {
        // Last candidate failed: surface the final error, not a synthetic one.
        throw error;
      }
      options.onFallback?.(candidate.label, usable[index + 1]?.label ?? "next", error);
    }
  }
  // Unreachable.
  throw new AiProviderError("All authorised AI models failed this request.");
}

/** A one-line, user-safe summary of a fallback run for the UI. */
export function describeFallback(result: FallbackResult<unknown>): string {
  if (result.attempts <= 1) return "";
  return `Tried ${result.attempts} models before ${result.usedLabel} answered.`;
}

export type { RoutingDecision };
